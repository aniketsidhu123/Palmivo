"""CTC decoding and parity checks for the single-frame FP32 model."""

import time

import numpy as np
import onnxruntime as ort
import torch

from data import Clip
from model import GestureModel, INPUT_NAMES, LABELS, OUTPUT_NAMES

ATOL = 1e-4
RTOL = 1e-3
MAX_GAP_MS = 250


def greedy_decode(logits: np.ndarray, timestamps_ms: list[float] | None = None) -> list[int]:
    result = []
    previous = 0
    for index, token in enumerate(np.argmax(logits, axis=1).tolist()):
        if timestamps_ms and index > 0 and timestamps_ms[index] - timestamps_ms[index - 1] > MAX_GAP_MS:
            previous = 0
        if token and token != previous:
            result.append(token)
        previous = token
    return result


def stable_decode(logits: np.ndarray, timestamps_ms: list[float]) -> list[tuple[int, float]]:
    """Mirror the browser's release rule of three confident frames spanning 90 ms."""
    result = []
    previous = 0
    count = 0
    start = 0.0
    emitted = False
    for index, (row, time_ms) in enumerate(zip(logits, timestamps_ms, strict=True)):
        if index > 0 and time_ms - timestamps_ms[index - 1] > MAX_GAP_MS:
            previous = count = 0
            emitted = False
        token = int(np.argmax(row))
        probability = 1.0 / np.exp(row - row[token]).sum()
        if token != previous:
            previous = token
            count = 0
            emitted = False
        if token == 0 or probability < 0.70:
            count = 0
            continue
        if count == 0:
            start = time_ms
        count += 1
        if not emitted and count >= 3 and time_ms - start >= 90:
            result.append((token, time_ms))
            emitted = True
    return result


def edit_distance(expected: list[int], actual: list[int]) -> int:
    previous = list(range(len(actual) + 1))
    for index, label in enumerate(expected, start=1):
        current = [index]
        for column, token in enumerate(actual, start=1):
            current.append(min(previous[column] + 1, current[-1] + 1, previous[column - 1] + (label != token)))
        previous = current
    return previous[-1]


def label_names(tokens: list[int]) -> list[str]:
    return [LABELS[token] for token in tokens]


def timing_summary(samples: list[float]) -> dict:
    if not samples:
        return {"samples": 0, "p50Ms": None, "p95Ms": None}
    return {
        "samples": len(samples),
        "p50Ms": float(np.percentile(samples, 50)),
        "p95Ms": float(np.percentile(samples, 95)),
    }


def evaluate_logits(clips_and_logits: list[tuple[Clip, np.ndarray]]) -> dict:
    exact_positive = exact_negative = positive_count = negative_count = 0
    token_errors = token_count = stable_exact = stable_positive = false_drafts = 0
    details = []
    delays = []
    for clip, logits in clips_and_logits:
        expected = clip.target
        predicted = greedy_decode(logits, clip.timestamps_ms)
        stable = stable_decode(logits, clip.timestamps_ms)
        stable_labels = [label for label, _ in stable]
        if expected:
            positive_count += 1
            exact_positive += int(expected == predicted)
            stable_positive += int(expected == stable_labels)
        else:
            negative_count += 1
            exact_negative += int(not predicted)
            false_drafts += int(bool(stable_labels))
        token_errors += edit_distance(expected, predicted)
        token_count += len(expected)
        stable_exact += int(expected == stable_labels)
        if expected == stable_labels and clip.gesture_ends_ms:
            delays.extend(time_ms - end for (_, time_ms), end in zip(stable, clip.gesture_ends_ms, strict=True))
        details.append({
            "clipId": clip.identifier,
            "sessionId": clip.session_id,
            "groundTruth": label_names(expected),
            "transcript": label_names(predicted),
            "stableTranscript": label_names(stable_labels),
            "stableTimesMs": [time_ms for _, time_ms in stable],
        })
    return {
        "exactPositive": exact_positive,
        "positiveSequences": positive_count,
        "exactNegative": exact_negative,
        "negativeSequences": negative_count,
        "tokenErrors": token_errors,
        "targetTokens": token_count,
        "tokenErrorRate": token_errors / token_count if token_count else None,
        "stableExact": stable_exact,
        "stableExactPositive": stable_positive,
        "falseDraftNegativeClips": false_drafts,
        "gestureEndToStableReplayMs": timing_summary(delays),
        "details": details,
    }


class DesktopONNX:
    def __init__(self, model_path):
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        self.session = ort.InferenceSession(str(model_path), options, providers=["CPUExecutionProvider"])

    def step(self, frame: np.ndarray, states: tuple[np.ndarray, ...]) -> list[np.ndarray]:
        inputs = dict(zip(INPUT_NAMES, (frame, *states), strict=True))
        return self.session.run(list(OUTPUT_NAMES), inputs)


def reset_indices(timestamps_ms: list[float]) -> list[int]:
    return [0, *(index for index in range(1, len(timestamps_ms))
                 if timestamps_ms[index] - timestamps_ms[index - 1] > MAX_GAP_MS)]


def full_logits_for_clip(model: GestureModel, clip: Clip, device: torch.device) -> torch.Tensor:
    offsets = reset_indices(clip.timestamps_ms) + [len(clip.frames)]
    return torch.cat([
        model(clip.frames[start:end].unsqueeze(0).to(device))[0].cpu()
        for start, end in zip(offsets, offsets[1:])
    ])


@torch.inference_mode()
def assert_parity(
    model: GestureModel, desktop: DesktopONNX, clip: Clip,
) -> tuple[np.ndarray, list[float], float]:
    """Check both logits and every next state over a complete recording."""
    model = model.cpu().eval()
    full_logits = full_logits_for_clip(model, clip, torch.device("cpu")).numpy()
    reset = set(reset_indices(clip.timestamps_ms))
    outputs = []
    timings = []
    maximum_error = 0.0
    for index, frame in enumerate(clip.frames):
        if index in reset:
            torch_states = model.empty_state()
            onnx_states = tuple(state.numpy() for state in torch_states)
        batched = frame.unsqueeze(0)
        torch_logits, *torch_states = model.step(batched, tuple(torch_states))
        start = time.perf_counter()
        onnx_logits, *onnx_states = desktop.step(batched.numpy(), tuple(onnx_states))
        timings.append((time.perf_counter() - start) * 1000)
        np.testing.assert_allclose(onnx_logits, torch_logits.numpy(), atol=ATOL, rtol=RTOL)
        for expected, actual in zip(torch_states, onnx_states, strict=True):
            np.testing.assert_allclose(actual, expected.numpy(), atol=ATOL, rtol=RTOL)
            maximum_error = max(maximum_error, float(np.max(np.abs(actual - expected.numpy()))))
        outputs.append(onnx_logits[0])
    replay_logits = np.stack(outputs)
    np.testing.assert_allclose(replay_logits, full_logits, atol=ATOL, rtol=RTOL)
    if greedy_decode(replay_logits, clip.timestamps_ms) != greedy_decode(full_logits, clip.timestamps_ms):
        raise AssertionError(f"{clip.identifier}: CTC transcript changed between full and online inference")
    maximum_error = max(maximum_error, float(np.max(np.abs(replay_logits - full_logits))))
    return replay_logits, timings, maximum_error
