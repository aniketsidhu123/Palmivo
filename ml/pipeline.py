"""Fit a local ST-GCN/CTC model and evaluate sessions held out from training."""

import argparse
import copy
import hashlib
import json
from pathlib import Path

import numpy as np
import onnx
import torch
from torch import nn
from torch.nn import functional as F
from torch.utils.data import DataLoader

from data import FEATURE_SETS, Clip, collate, load_sessions, require_vocabulary
from model import FEATURE_COUNT, INPUT_NAMES, MODEL_FILENAME, NODE_COUNT, OUTPUT_NAMES, ExportStep, GestureModel
from recognition import (
    ATOL, RTOL, DesktopONNX, assert_parity, evaluate_logits, full_logits_for_clip,
    greedy_decode, label_names, timing_summary,
)

CHECKPOINT = "gesture.pt"
MANIFEST = "manifest.json"


def write_json(path: Path, value: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, allow_nan=False, separators=(",", ":")), encoding="utf-8")
    temporary.replace(path)


def fingerprint(clip: Clip) -> str:
    return hashlib.sha256(clip.frames.numpy().tobytes()).hexdigest()


def check_disjoint(earlier: list[Clip], later: list[Clip]) -> None:
    sessions = {clip.session_id for clip in earlier}
    clip_hashes = {fingerprint(clip) for clip in earlier}
    for clip in later:
        if clip.session_id in sessions or fingerprint(clip) in clip_hashes:
            raise ValueError(f"{clip.session_id}/{clip.identifier}: overlaps an earlier split")


def end_targets(clips: list[Clip], length: int) -> torch.Tensor:
    """Optional end-of-gesture anchors encourage multi-frame confidence for live input."""
    targets = torch.full((len(clips), length), -100, dtype=torch.long)
    for index, clip in enumerate(clips):
        if not clip.gesture_ends_ms:
            continue
        previous = float("-inf")
        for label, end in zip(clip.target, clip.gesture_ends_ms, strict=True):
            for row, time_ms in enumerate(clip.timestamps_ms):
                if max(previous + 45, end - 180) <= time_ms <= end:
                    targets[index, row] = label
            previous = end
    return targets


def training_batch(clips: list[Clip]) -> tuple[torch.Tensor, ...]:
    frames, labels, lengths, target_lengths = collate(clips)
    return frames, labels, lengths, target_lengths, end_targets(clips, frames.shape[1])


@torch.inference_mode()
def predict(model: GestureModel, clips: list[Clip]) -> list[tuple[Clip, np.ndarray]]:
    device = next(model.parameters()).device
    model.eval()
    return [(clip, full_logits_for_clip(model, clip, device).numpy()) for clip in clips]


def score(report: dict) -> tuple[float, float, float]:
    positives = report["positiveSequences"]
    negatives = report["negativeSequences"]
    return (
        (3 * report["exactPositive"] / positives + report["exactNegative"] / negatives) / 4,
        report["stableExactPositive"] / positives - report["falseDraftNegativeClips"] / negatives,
        -report["tokenErrorRate"],
    )


def export_onnx(model: GestureModel, path: Path) -> None:
    model.cpu().eval()
    frame = torch.zeros((1, NODE_COUNT, FEATURE_COUNT), dtype=torch.float32)
    # Pinned PyTorch 2.7 uses the TorchScript exporter for this small static model.
    torch.onnx.export(
        ExportStep(model), (frame, *model.empty_state()), str(path),
        input_names=list(INPUT_NAMES), output_names=list(OUTPUT_NAMES),
        opset_version=17, dynamo=False, external_data=False,
    )
    onnx.checker.check_model(str(path))


def fit(args: argparse.Namespace) -> dict:
    torch.manual_seed(args.seed)
    dataset = load_sessions(args.sessions, args.features)
    if dataset["test"]:
        raise ValueError("leave the held-out test file for the evaluate command")
    train_clips = dataset["train"]
    validation = dataset["validation"]
    require_vocabulary(train_clips, "train")
    require_vocabulary(validation, "validation")
    check_disjoint(train_clips, validation)
    args.output.mkdir(parents=True, exist_ok=True)
    if (args.output / MANIFEST).exists():
        raise ValueError("output already contains a model; use a fresh output directory")

    device = torch.device(args.device)
    model = GestureModel().to(device)
    loader = DataLoader(train_clips, batch_size=args.batch_size, shuffle=True, collate_fn=training_batch)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate)
    ctc_loss = nn.CTCLoss(blank=0, reduction="none", zero_infinity=False)
    best_report = best_score = weights = None
    best_epoch = 0
    for epoch in range(1, args.epochs + 1):
        model.train()
        losses = []
        for frames, targets, lengths, target_lengths, anchors in loader:
            optimizer.zero_grad(set_to_none=True)
            logits = model(frames.to(device))
            log_probs = logits.log_softmax(dim=-1).transpose(0, 1)
            loss = (30.0 * ctc_loss(log_probs, targets.to(device), lengths, target_lengths) / lengths.to(device)).mean()
            if torch.any(anchors != -100):
                loss = loss + 0.25 * F.cross_entropy(logits.transpose(1, 2), anchors.to(device))
            if not bool(torch.isfinite(loss)):
                raise ValueError("training produced a non-finite loss; inspect the input features")
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            losses.append(float(loss.detach().cpu()))
        report = evaluate_logits(predict(model, validation))
        rank = score(report)
        if best_score is None or rank > best_score:
            best_report, best_score = report, rank
            best_epoch = epoch
            weights = copy.deepcopy(model.state_dict())
        if epoch == 1 or epoch % 5 == 0 or epoch == args.epochs:
            print(
                f"Epoch {epoch:>3}/{args.epochs}  Loss {np.mean(losses):.3f}  "
                f"Validation exact {report['exactPositive']}/{report['positiveSequences']}  "
                f"Stable {report['stableExactPositive']}/{report['positiveSequences']}",
                flush=True,
            )

    model.load_state_dict(weights)
    model_path = args.output / MODEL_FILENAME
    export_onnx(model, model_path)
    desktop = DesktopONNX(model_path)
    positive = max((clip for clip in validation if clip.target), key=lambda clip: len(clip.frames))
    negative = max((clip for clip in validation if not clip.target), key=lambda clip: len(clip.frames))
    parity_max = max(assert_parity(model, desktop, clip)[2] for clip in (positive, negative))
    model_hash = hashlib.sha256(model_path.read_bytes()).hexdigest()
    used_clips = train_clips + validation
    checkpoint = {
        "weights": model.state_dict(),
        "sessionIds": sorted({clip.session_id for clip in used_clips}),
        "clipHashes": sorted({fingerprint(clip) for clip in used_clips}),
        "modelSha256": model_hash,
        "featureSet": args.features,
    }
    torch.save(checkpoint, args.output / CHECKPOINT)
    manifest = {
        "version": 1,
        "source": "presenter",
        "nodeCount": NODE_COUNT,
        "featureCount": FEATURE_COUNT,
        "featureSet": args.features,
        "pose": args.features == "hands+shoulders",
        "modelSha256": model_hash,
        "modelBytes": model_path.stat().st_size,
    }
    fit_report = {
        "version": 1,
        "featureSet": args.features,
        "modelSha256": model_hash,
        "trainingClips": len(train_clips),
        "validationClips": len(validation),
        "chosenEpoch": best_epoch,
        "device": args.device,
        "seed": args.seed,
        "validation": best_report,
        "desktopParity": {"clips": 2, "maxAbsoluteError": parity_max, "atol": ATOL, "rtol": RTOL},
    }
    write_json(args.output / "fit-report.json", fit_report)
    write_json(args.output / MANIFEST, manifest)
    return {"output": str(args.output), "chosenEpoch": best_epoch, "validation": {k: v for k, v in best_report.items() if k != "details"}}


def evaluate(args: argparse.Namespace) -> dict:
    checkpoint = torch.load(args.model / CHECKPOINT, weights_only=True, map_location="cpu")
    feature_set = checkpoint["featureSet"]
    dataset = load_sessions(args.sessions, feature_set)
    if dataset["train"] or dataset["validation"]:
        raise ValueError("the evaluate command accepts held-out test sessions only")
    tests = dataset["test"]
    require_vocabulary(tests, "test")
    used_sessions = set(checkpoint["sessionIds"])
    used_clips = set(checkpoint["clipHashes"])
    for clip in tests:
        if clip.session_id in used_sessions or fingerprint(clip) in used_clips:
            raise ValueError(f"{clip.session_id}/{clip.identifier}: held-out session overlaps training or validation")
    model_path = args.model / MODEL_FILENAME
    model_hash = hashlib.sha256(model_path.read_bytes()).hexdigest()
    if model_hash != checkpoint["modelSha256"]:
        raise ValueError("exported ONNX file no longer matches the frozen checkpoint")
    model = GestureModel()
    model.load_state_dict(checkpoint["weights"])
    desktop = DesktopONNX(model_path)
    results = []
    timings = []
    maximum_error = 0.0
    for clip in tests:
        logits, elapsed, parity_error = assert_parity(model, desktop, clip)
        timings.extend(elapsed[3:])  # Exclude initial calls after a fresh sequence reset.
        maximum_error = max(maximum_error, parity_error)
        results.append((clip, logits))
    report = evaluate_logits(results)
    report.update({
        "version": 1,
        "partition": "held-out presenter session",
        "featureSet": feature_set,
        "modelSha256": model_hash,
        "desktopParity": {"clips": len(results), "maxAbsoluteError": maximum_error, "atol": ATOL, "rtol": RTOL},
        "desktopInference": timing_summary(timings),
        "exactTranscriptGate": report["positiveSequences"] >= 20 and report["exactPositive"] / report["positiveSequences"] >= 0.90,
    })
    write_json(args.model / "test-report.json", report)
    if args.parity_clip:
        candidates = [(clip, logits) for clip, logits in results if clip.identifier == args.parity_clip]
        if len(candidates) != 1:
            raise ValueError("the parity clip ID should identify exactly one held-out clip")
        clip, logits = candidates[0]
        fixture = {
            "version": 1,
            "source": "presenter",
            "featureSet": feature_set,
            "modelSha256": model_hash,
            "clipId": clip.identifier,
            "timestamps": clip.timestamps_ms,
            "frames": clip.frames.reshape(len(clip.frames), -1).tolist(),
            "logits": logits.tolist(),
            "transcript": label_names(greedy_decode(logits, clip.timestamps_ms)),
            "groundTruth": label_names(clip.target),
        }
        if clip.gesture_ends_ms is not None:
            fixture["gestureEndsMs"] = clip.gesture_ends_ms
        write_json(args.model / "browser-parity.json", fixture)
    return {k: v for k, v in report.items() if k != "details"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)
    train = subcommands.add_parser("fit", help="fit on train and validation sessions and export FP32 ONNX")
    train.add_argument("--sessions", nargs="+", type=Path, required=True)
    train.add_argument("--features", choices=FEATURE_SETS, default="hands")
    train.add_argument("--output", type=Path, default=Path("ml/artifacts/hands"))
    train.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    train.add_argument("--epochs", type=int, default=40)
    train.add_argument("--batch-size", type=int, default=4)
    train.add_argument("--learning-rate", type=float, default=0.002)
    train.add_argument("--seed", type=int, default=71)
    test = subcommands.add_parser("evaluate", help="evaluate the frozen checkpoint on new sessions")
    test.add_argument("--model", type=Path, required=True)
    test.add_argument("--sessions", nargs="+", type=Path, required=True)
    test.add_argument("--parity-clip", help="export an opted-in held-out clip and its reference logits for browser parity")
    args = parser.parse_args()
    torch.set_num_threads(4)
    try:
        if args.command == "fit":
            if args.epochs < 1 or args.batch_size < 1 or args.learning_rate <= 0:
                raise ValueError("epochs, batch size and learning rate should be positive")
            if args.device == "cuda" and not torch.cuda.is_available():
                raise ValueError("CUDA is unavailable; run with --device cpu")
            report = fit(args)
        else:
            report = evaluate(args)
    except (ValueError, FileNotFoundError, AssertionError) as error:
        parser.exit(1, f"Error: {error}\n")
    print(json.dumps(report, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
