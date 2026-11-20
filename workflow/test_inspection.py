import base64
from dataclasses import replace
import json
import os
from pathlib import Path
import struct
import unittest
from unittest.mock import Mock, create_autospec, patch

from render.workflows._models.task import InputResponse
from render.workflows.client import UDSClient
from render.workflows.durable_context import DurableFlowContext

from workflow.inspection import MAX_AUDIO_BYTES, MAX_STL_BYTES, inspect_upload, speak_caption
from workflow.main import inspect_part


EXAMPLES = Path(__file__).resolve().parents[1] / "examples"
BUSHING = (EXAMPLES / "flanged-guide-bushing-mm.stl").read_bytes()


def payload(raw, revision=5):
    return {"revision": revision, "stlBase64": base64.b64encode(raw).decode("ascii")}


def scaled_stl(raw, factor):
    scaled = bytearray(raw)
    # A positive uniform scale preserves the stored unit normals.
    for offset in range(84, len(raw), 50):
        vertices = struct.unpack_from("<9f", raw, offset + 12)
        struct.pack_into("<9f", scaled, offset + 12, *(v * factor for v in vertices))
    return scaled


class InspectionTests(unittest.TestCase):
    def test_bushing_and_modified_revision_use_measured_stl(self):
        original = inspect_upload(payload(BUSHING))
        self.assertEqual(original["revision"], 5)
        self.assertEqual(original["dimensionsMm"], [20, 20, 40])
        self.assertEqual(original["triangles"], 400)
        self.assertTrue(original["closed"])
        self.assertTrue(original["centerPassage"])
        self.assertEqual(original["caption"], "Twenty by twenty by forty millimetres. The mesh is closed, and the centre passage is open.")
        scaled = inspect_upload(payload(scaled_stl(BUSHING, 1.1), revision=6))
        self.assertEqual(scaled["revision"], 6)
        self.assertEqual(scaled["dimensionsMm"], [22, 22, 44])
        self.assertIn("Twenty-two by twenty-two by forty-four", scaled["caption"])
        self.assertTrue(scaled["centerPassage"])

    def test_solid_box_has_no_centre_passage(self):
        box = (EXAMPLES / "scaled-box-mm.stl").read_bytes()
        report = inspect_upload(payload(box))
        self.assertTrue(report["closed"])
        self.assertFalse(report["centerPassage"])
        self.assertNotIn("passage", report["caption"])

    def test_open_surface_reports_problem_without_claiming_closed(self):
        open_mesh = bytearray(BUSHING[:-50])
        struct.pack_into("<I", open_mesh, 80, 399)
        report = inspect_upload(payload(open_mesh))
        self.assertFalse(report["closed"])
        self.assertFalse(report["centerPassage"])
        self.assertIn("open", report["caption"])

    def test_invalid_uploads_rejected_before_speech(self):
        bad_data = (
            {"revision": True, "stlBase64": ""}, {"revision": -1, "stlBase64": ""},
            {**payload(BUSHING), "projectHistory": []}, {"revision": 5, "stlBase64": "***"},
            payload(BUSHING[:-1]), payload(b""), payload(bytes(MAX_STL_BYTES + 1)),
        )
        for index, data in enumerate(bad_data):
            with self.subTest(case=index), self.assertRaises(ValueError):
                inspect_upload(data)
        nonfinite = bytearray(BUSHING)
        struct.pack_into("<f", nonfinite, 84 + 12, float("nan"))
        with self.assertRaisesRegex(ValueError, "Nonfinite"):
            inspect_upload(payload(nonfinite))

    @patch.dict(os.environ, {"ELEVENLABS_API_KEY": "test-key", "ELEVENLABS_VOICE_ID": "demo_voice"})
    @patch("workflow.inspection.HTTPSConnection")
    def test_voice_request_contains_only_caption_and_model(self, connection_cls):
        conn = connection_cls.return_value
        response = conn.getresponse.return_value
        response.status = 200
        response.read.return_value = b"ID3" + bytes(12)
        caption = inspect_upload(payload(BUSHING))["caption"]
        result = speak_caption(caption)
        connection_cls.assert_called_once_with("api.elevenlabs.io", timeout=12)
        method, path, body, headers = conn.request.call_args.args
        self.assertEqual((method, path), ("POST", "/v1/text-to-speech/demo_voice?output_format=mp3_22050_32"))
        self.assertEqual(json.loads(body), {"text": caption, "model_id": "eleven_flash_v2_5"})
        self.assertEqual(headers["xi-api-key"], "test-key")
        self.assertEqual(base64.b64decode(result["audioBase64"]), response.read.return_value)
        self.assertEqual(result["audioStatus"], "ready")
        conn.close.assert_called_once()

    @patch.dict(os.environ, {"ELEVENLABS_API_KEY": "test-key", "ELEVENLABS_VOICE_ID": "demo_voice"})
    @patch("workflow.inspection.HTTPSConnection")
    def test_voice_failure_preserves_checkpointed_geometry(self, connection_cls):
        ctx = Mock()
        ctx.step.side_effect = lambda _name, function, args: function(args)
        self.assertEqual(inspect_part.name, "inspect_part")
        conn = connection_cls.return_value
        response = conn.getresponse.return_value
        for status, data in ((429, b""), (500, b""), (200, b"html"), (200, b"ID3" + bytes(MAX_AUDIO_BYTES))):
            response.status = status
            response.read.return_value = data
            result = inspect_part.func(ctx, payload(BUSHING))
            self.assertEqual(result["audioStatus"], "unavailable")
            self.assertIsNone(result["audioBase64"])
            self.assertEqual(result["dimensionsMm"], [20, 20, 40])
        conn.request.side_effect = TimeoutError()
        result = inspect_part.func(ctx, payload(BUSHING))
        self.assertEqual(result["audioStatus"], "unavailable")
        self.assertTrue(result["centerPassage"])
        self.assertEqual([call.args[0] for call in ctx.step.call_args_list[-2:]], ["inspect-exported-mesh", "speak-measurements"])

    @patch.dict(os.environ, {"ELEVENLABS_API_KEY": "", "ELEVENLABS_VOICE_ID": ""})
    @patch("workflow.inspection.HTTPSConnection")
    def test_missing_credentials_preserve_text_and_make_no_request(self, connection_cls):
        self.assertEqual(speak_caption("The mesh is closed."), {"audioStatus": "unavailable", "audioBase64": None})
        connection_cls.assert_not_called()

    @patch.dict(os.environ, {"ELEVENLABS_API_KEY": "test-key", "ELEVENLABS_VOICE_ID": "demo_voice"})
    @patch("workflow.inspection.HTTPSConnection")
    def test_render_replays_completed_audio_without_a_second_voice_call(self, connection_cls):
        # Execute the pinned SDK's actual checkpoint and replay logic with local transports.
        conn = connection_cls.return_value
        conn.getresponse.return_value.status = 200
        conn.getresponse.return_value.read.return_value = b"ID3" + bytes(12)
        transport = create_autospec(UDSClient, instance=True)
        event = InputResponse(task_name="inspect_part", input_="", task_run_id="frn-local",
                              root_task_run_id="frn-local", is_workflow=True, attempt=0)
        data = payload(BUSHING)
        with DurableFlowContext(transport, event) as ctx:
            receipt = inspect_part.func(ctx, data)
        self.assertEqual([s.task_name for s in event.history.steps], ["inspect-exported-mesh", "speak-measurements"])
        with DurableFlowContext(transport, replace(event, attempt=1)) as replay:
            self.assertEqual(inspect_part.func(replay, data), receipt)
        conn.request.assert_called_once()


if __name__ == "__main__":
    unittest.main()
