# Third-party notices

Palmivo uses the following third-party components. Project dependencies are pinned in the package manifest and lockfile. License information here identifies bundled components; upstream copyright and license notices remain applicable.

| Component | Pinned version / source | License |
| --- | --- | --- |
| MediaPipe Tasks Vision | `@mediapipe/tasks-vision` 0.10.32, Google | Apache-2.0 |
| MediaPipe Hand Landmarker model | Official float16 Hand Landmarker model, version 1 | MediaPipe model terms; see official model documentation |
| MediaPipe Pose Landmarker Lite model | Official float16 Pose Landmarker Lite model, version 1 | MediaPipe model terms; see official model documentation |
| ONNX Runtime Web | `onnxruntime-web` 1.24.1, Microsoft | MIT |
| MIT HAN Lab Online TSM | MobileNetV2 Jester checkpoint, converted to FP32 ONNX opset 17 | MIT (upstream implementation) |
| Manifold | `manifold-3d` 3.3.2, The Manifold Authors | Apache-2.0 |
| Three.js | `three` 0.181.1, three.js authors | MIT |
| Node.js | Runtime copied by the packaging script; inspect `runtime/node.exe --version` | MIT with additional third-party notices |

Development tools include TypeScript (Apache-2.0), Vite (MIT), Vitest (MIT), and esbuild (MIT). Their complete dependencies and versions are recorded in `pnpm-lock.yaml`; they are not required to install or build anything when running the portable release.

## Bundled license texts

- [Apache License 2.0](docs/licenses/Apache-2.0.txt), copied from the installed Manifold package.
- [Three.js MIT license](docs/licenses/Three.js-MIT.txt), copied from the installed Three.js package.
- [ONNX Runtime MIT license](docs/licenses/ONNX-Runtime-LICENSE.txt), from the pinned release.
- [MIT HAN Lab TSM license](docs/licenses/MIT-HAN-Lab-TSM-LICENSE.txt), from the upstream repository.
- [Node.js license and dependency notices](docs/licenses/Node.js-LICENSE.txt), when included with the portable runtime.

Official sources:

- [MediaPipe repository and license](https://github.com/google-ai-edge/mediapipe)
- [Hand Landmarker model documentation](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)
- [Pose Landmarker model documentation](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)
- [ONNX Runtime license](https://github.com/microsoft/onnxruntime/blob/v1.24.1/LICENSE)
- [MIT HAN Lab Online TSM reference and checkpoint loader](https://github.com/mit-han-lab/temporal-shift-module/tree/master/online_demo)
- [Manifold repository](https://github.com/elalish/manifold)
- [Three.js repository](https://github.com/mrdoob/three.js)
- [Node.js license](https://github.com/nodejs/node/blob/main/LICENSE)

The bundled TSM model is an ONNX export of the official Jester weights. See [model provenance](docs/MODELS.md#mit-online-tsm-provenance) for the upstream checkpoint and export checksums. Presenter datasets and frozen evaluation clips stay in the local training workspace.

