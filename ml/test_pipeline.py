"""Isolated smoke checks. These fixtures have no recognition or release value."""

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import torch

from data import FRAME_WIDTH, Clip, load_sessions
from model import FEATURE_COUNT, NODE_COUNT, GestureModel
from pipeline import check_disjoint, export_onnx, training_batch
from recognition import DesktopONNX, assert_parity, greedy_decode, stable_decode


def smoke_clip() -> Clip:
    generator = torch.Generator().manual_seed(93)
    frames = torch.randn((24, NODE_COUNT, FEATURE_COUNT), generator=generator)
    frames[..., 9] = 1
    frames[..., 12] = 1
    frames[3:5, :21, 9] = 0
    return Clip("fixture", "smoke-only", "train", frames, list(range(0, 1200, 50)), [1, 2, 2, 3], [300, 500, 700, 900])


class ModelChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(2)
        torch.manual_seed(81)

    def test_single_training_step_and_stateful_desktop_export(self):
        model = GestureModel()
        clip = smoke_clip()
        frames, targets, lengths, target_lengths, anchors = training_batch([clip])
        optimizer = torch.optim.SGD(model.parameters(), lr=0.01)
        initial = model.classify.weight.detach().clone()
        scores = model(frames)
        loss = torch.nn.CTCLoss()(scores.log_softmax(-1).transpose(0, 1), targets, lengths, target_lengths)
        loss += 0.25 * torch.nn.functional.cross_entropy(scores.transpose(1, 2), anchors)
        self.assertTrue(torch.isfinite(loss))
        loss.backward()
        optimizer.step()
        self.assertFalse(torch.equal(model.classify.weight, initial))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "smoke.onnx"
            export_onnx(model, path)
            desktop = DesktopONNX(path)
            logits, timings, max_delta = assert_parity(model, desktop, clip)
        self.assertEqual(logits.shape, (len(clip.frames), 4))
        self.assertEqual(len(timings), len(clip.frames))
        self.assertLessEqual(max_delta, 1e-4)

    def test_ctc_repeated_tokens_are_released_by_blank(self):
        ids = [1, 1, 1, 0, 1, 1, 1, 2, 2, 2]
        logits = 10 * np.eye(4, dtype=np.float32)[ids]
        self.assertEqual(greedy_decode(logits), [1, 1, 2])
        self.assertEqual(stable_decode(logits, list(range(0, 50 * len(ids), 50))), [(1, 100), (1, 300), (2, 450)])
        held = 10 * np.eye(4, dtype=np.float32)[[1] * 6]
        timestamps_with_gap = [0, 50, 100, 400, 450, 500]
        self.assertEqual(greedy_decode(held, timestamps_with_gap), [1, 1])
        self.assertEqual(stable_decode(held, timestamps_with_gap), [(1, 100), (1, 500)])

    def test_session_isolation_and_synthetic_rejection(self):
        basic = {
            "schemaVersion": 1, "featureVersion": 1, "source": "synthetic-test-only",
            "sessionId": "smoke", "split": "train", "featureSet": "hands",
            "clips": [{"id": "rest", "timestampsMs": [0], "transcript": [], "frames": [[0] * FRAME_WIDTH]}],
        }
        with tempfile.TemporaryDirectory() as directory:
            train_path = Path(directory) / "train.json"
            test_path = Path(directory) / "test.json"
            train_path.write_text(json.dumps(basic), encoding="utf-8")
            test_path.write_text(json.dumps(dict(basic, split="test")), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "source 'presenter'"):
                load_sessions([train_path], "hands")
            with self.assertRaisesRegex(ValueError, "appears in multiple splits"):
                load_sessions([train_path, test_path], "hands", synthetic=True)
            test_path.write_text(json.dumps(dict(basic, split="test", sessionId="smoke2")), encoding="utf-8")
            split = load_sessions([train_path, test_path], "hands", synthetic=True)
            with self.assertRaisesRegex(ValueError, "overlaps an earlier split"):
                check_disjoint(split["train"], split["test"])


if __name__ == "__main__":
    unittest.main()
