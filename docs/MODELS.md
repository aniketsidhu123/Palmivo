# Gesture models

Palmivo uses MediaPipe Hand Landmarker for its pointer and gesture rules. The separate **Listen for tool** control runs pretrained MIT Online TSM in the browser for three tool shortcuts. The ST-GCN and streaming CTC pilot has its own capture and training pipeline.

## Bundled models and generated assets

| Path | Purpose |
| --- | --- |
| `public/tracking/hand_landmarker.task` | Pinned MediaPipe Hand Landmarker model. Asset preparation also supports retrieving the versioned Google model if the file is missing. |
| `public/tsm/mit-tsm-jester-streaming.onnx` | Pinned pretrained MIT Online TSM export. |
| `public/tracking/worker.js` and `public/tracking/wasm/` | Generated landmark worker and WASM from the locked MediaPipe package. |
| `public/learned/wasm/` | Generated ONNX Runtime Web files shared by the TSM worker and research pilot. |
| `public/tsm/manifest.json` and `public/asset-manifest.json` | Generated metadata and integrity checks, including file sizes and SHA-256 hashes. |

From the repository root, run:

```sh
pnpm install --frozen-lockfile
pnpm run assets
pnpm dev
```

Use `pnpm run build:hosted` to create and validate `dist/`. The hosted build requires the pinned TSM model and manifest. A fresh clone or the portable source archive supplies the ONNX model. If you intentionally stage the same verified export out of tree, the asset script also accepts `ml/artifacts/pretrained-evaluation/mit-tsm-jester-streaming.onnx`.

For a manual SHA-256 check on Windows:

```powershell
Get-FileHash public/tsm/mit-tsm-jester-streaming.onnx -Algorithm SHA256
```

The production and portable servers serve the browser models and WASM from the application origin. No model service or Python environment is required for camera tracking or TSM inference. The portable release supports a fresh offline reload.

## MIT Online TSM provenance

Palmivo uses the upstream **MobileNetV2 Online TSM** checkpoint trained on Jester, exported to streaming FP32 ONNX at opset 17. The export has **2,258,459 parameters** and is **9,012,233 bytes**. The graph takes one `1 × 3 × 224 × 224` frame and ten temporal state tensors. Outputs are 27 logits and the next values of those ten state tensors.

| Asset | SHA-256 |
| --- | --- |
| Palmivo ONNX export | `e4142cece680362eec7b5ce2571bc7b763b841830942b30c51cb9b21ccfd1ebb` |
| [Upstream Jester weights](https://hanlab18.mit.edu/projects/tsm/models/mobilenetv2_jester_online.pth.tar) | `da56d12597699a34c51834d059669679049cd9d530876279259a1eed8bb34688` |
| [Upstream reference implementation](https://github.com/mit-han-lab/temporal-shift-module/blob/master/online_demo/mobilenet_v2_tsm.py) | `c0ddbc356368e69b8048653fdbf86a9f393f58905d5e1b3013db963506f7e35` |

The browser worker runs ONNX Runtime Web's WASM backend and keeps at most one inference active. Palmivo requires stable shortcut predictions and resets temporal state between listening attempts. Model or worker errors leave the rule-based palette available. [Third-party notices](../THIRD_PARTY_NOTICES.md)

### Verify shortcuts

1. Enable the camera and calibrate. Choose **Listen for tool** above the viewport and briefly relax the pointer hand.
2. When **Make a shortcut** appears, swipe left for **Box**, swipe right for **Cylinder**, or briefly hold **thumbs up** for **Union**. Swipe directions follow the mirrored preview. Union requires a selected solid and a second solid in the scene.
3. Verify the opened draft, adjust parameters or choose operands through the regular controls, then **Commit** or **Cancel**. Rearm listening for the next shortcut.

The ONNX export matched reference PyTorch logits and caches across 12 streaming steps. The packaged worker produced finite logits for all 27 classes on synthetic frames and reproduced its first result after a state reset. [Camera and inference benchmark](benchmarks/README.md#local-mit-tsm-sample)

## Optional ST-GCN and CTC pilot

Use **Learned gesture pilot → Open gesture capture**, or open `/collect.html`, to record landmark features for the separate research model. Store recordings in `ml/data/` and checkpoints, exports, and evaluation clips in `ml/artifacts/`. Keep private data in those ignored paths. The [training guide](../ml/README.md) covers the Python environment, data splits, training, ONNX export, and held-out evaluation.

Copy a validated presenter export and its manifest to `public/learned/gesture.onnx` and `public/learned/manifest.json` before building to test it in the browser. Compare the expected, desktop, and browser transcripts with **Replay parity clip**. With **Measure learned model**, the runtime times predictions alongside the gesture rules without authorizing drafts. Both model files stay local to that checkout.

To use optional shoulder features, save the official [Pose Landmarker Lite asset](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task) as `public/tracking/pose_landmarker_lite.task` and rerun `pnpm run assets`. Asset preparation checks the pose model checksum. Enable shoulder capture when preparing those datasets.
