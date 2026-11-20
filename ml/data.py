"""Read recorded Palmivo sessions and enforce independent data splits."""

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from torch import Tensor
from torch.nn.utils.rnn import pad_sequence

from model import FEATURE_COUNT, HAND_VALID_INDEX, LABELS, NODE_COUNT

FEATURE_SETS = ("hands", "hands+shoulders")
SPLITS = ("train", "validation", "test")
FRAME_WIDTH = NODE_COUNT * FEATURE_COUNT
MAX_SESSION_BYTES = 160 * 1024 * 1024
MAX_CLIP_FRAMES = 1_200
LABEL_IDS = {label: index for index, label in enumerate(LABELS) if index > 0}


@dataclass
class Clip:
    identifier: str
    session_id: str
    split: str
    frames: Tensor
    timestamps_ms: list[float]
    target: list[int]
    gesture_ends_ms: list[float] | None


def timestamps(value: object, count: int, field: str) -> list[float]:
    if not isinstance(value, list) or len(value) != count:
        raise ValueError(f"{field} should contain {count} numeric timestamps")
    if any(type(item) not in (float, int) or not math.isfinite(item) or item < 0 for item in value):
        raise ValueError(f"{field} should contain finite, nonnegative timestamps")
    if any(first >= second for first, second in zip(value, value[1:])):
        raise ValueError(f"{field} should be strictly increasing")
    return value


def identifier(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > 100:
        raise ValueError(f"{field} must be a string of 1–100 characters")
    return value


def load_clip(record: dict, session_id: str, split: str, feature_set: str) -> Clip:
    if not isinstance(record, dict):
        raise ValueError("each clip must be an object")
    clip_id = identifier(record.get("id"), "clip id")
    rows = record.get("frames")
    if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_CLIP_FRAMES:
        raise ValueError(f"{clip_id}: expected 1–{MAX_CLIP_FRAMES} feature frames")
    if any(not isinstance(row, list) or len(row) != FRAME_WIDTH for row in rows):
        raise ValueError(f"{clip_id}: every feature frame must have {FRAME_WIDTH} values")
    if any(type(value) not in (float, int) for row in rows for value in row):
        raise ValueError(f"{clip_id}: features must be numeric")
    values = np.asarray(rows, dtype=np.float32).reshape((-1, NODE_COUNT, FEATURE_COUNT))
    if not np.isfinite(values).all():
        raise ValueError(f"{clip_id}: all features must be finite")
    masks = values[..., [HAND_VALID_INDEX, 12]]
    if not np.isin(masks, [0, 1]).all():
        raise ValueError(f"{clip_id}: validity masks must be zero or one")
    if feature_set == "hands":
        values[..., 10:13] = 0
    timeline = timestamps(record.get("timestampsMs"), len(rows), f"{clip_id} timestampsMs")
    transcript = record.get("transcript")
    if not isinstance(transcript, list) or any(type(label) is not str or label not in LABEL_IDS for label in transcript):
        raise ValueError(f"{clip_id}: expected a list of Box, Cylinder, or Union tokens")
    target = [LABEL_IDS[label] for label in transcript]
    required_frames = len(target) + sum(left == right for left, right in zip(target, target[1:]))
    if len(rows) < required_frames:
        raise ValueError(f"{clip_id}: too few frames for CTC alignment")
    ends = record.get("gestureEndMs")
    if ends is not None:
        ends = timestamps(ends, len(target), f"{clip_id} gestureEndMs")
        if ends and (ends[0] < timeline[0] or ends[-1] > timeline[-1]):
            raise ValueError(f"{clip_id}: gesture end timestamps must be inside the clip")
    return Clip(clip_id, session_id, split, torch.from_numpy(values), timeline, target, ends)


def load_sessions(
    paths: list[Path], feature_set: str, *, synthetic: bool = False,
) -> dict[str, list[Clip]]:
    clips_by_split = {split: [] for split in SPLITS}
    session_splits = {}
    clip_keys = set()
    source = "synthetic-test-only" if synthetic else "presenter"
    for path in paths:
        if path.stat().st_size > MAX_SESSION_BYTES:
            raise ValueError(f"{path}: session larger than {MAX_SESSION_BYTES // (1024 * 1024)} MiB")
        try:
            record = json.loads(path.read_text(encoding="utf-8-sig"))
            if not isinstance(record, dict) or record.get("schemaVersion") != 1 or record.get("featureVersion") != 1:
                raise ValueError("expected session schema and feature versions 1")
            if record.get("source") != source:
                raise ValueError(f"expected recordings with source {source!r}")
            capture_features = record.get("featureSet")
            if capture_features not in FEATURE_SETS:
                raise ValueError("invalid feature set")
            if feature_set == "hands+shoulders" and capture_features != feature_set:
                raise ValueError("selected feature set requires a shoulder-enabled recording")
            session_id = identifier(record.get("sessionId"), "sessionId")
            split = record.get("split")
            if split not in SPLITS:
                raise ValueError(f"invalid split {split!r}")
            if session_splits.setdefault(session_id, split) != split:
                raise ValueError(f"session {session_id!r} appears in multiple splits")
            clips = record.get("clips")
            if not isinstance(clips, list) or not clips:
                raise ValueError("session contains no clips")
            for clip_record in clips:
                clip = load_clip(clip_record, session_id, split, feature_set)
                key = (session_id, clip.identifier)
                if key in clip_keys:
                    raise ValueError(f"repeated clip {clip.identifier!r} in session {session_id!r}")
                clip_keys.add(key)
                clips_by_split[split].append(clip)
        except (ValueError, TypeError, OverflowError) as error:
            raise ValueError(f"{path}: {error}") from error
    return clips_by_split


def require_vocabulary(clips: list[Clip], split: str) -> None:
    observed = {label for clip in clips for label in clip.target}
    missing = set(LABEL_IDS.values()) - observed
    if missing:
        names = ", ".join(LABELS[index] for index in sorted(missing))
        raise ValueError(f"{split}: record clips containing {names}")
    if all(clip.target for clip in clips):
        raise ValueError(f"{split}: include a negative clip with an empty transcript")


def collate(clips: list[Clip]) -> tuple[Tensor, Tensor, Tensor, Tensor]:
    return (
        pad_sequence([clip.frames for clip in clips], batch_first=True),
        torch.tensor([label for clip in clips for label in clip.target], dtype=torch.long),
        torch.tensor([len(clip.frames) for clip in clips], dtype=torch.long),
        torch.tensor([len(clip.target) for clip in clips], dtype=torch.long),
    )
