# Third-party notices

Palmivo uses the following third-party components. Project dependencies are pinned in the package manifest and lockfile. License information here identifies bundled components; upstream copyright and license notices remain applicable.

| Component | Pinned version / source | License |
| --- | --- | --- |
| MediaPipe Tasks Vision | `@mediapipe/tasks-vision` 0.10.32, Google | Apache-2.0 |
| MediaPipe Hand Landmarker model | Official float16 Hand Landmarker model, version 1 | MediaPipe model terms; see official model documentation |
| Manifold | `manifold-3d` 3.3.2, The Manifold Authors | Apache-2.0 |
| Three.js | `three` 0.181.1, three.js authors | MIT |
| Node.js | Runtime copied by the packaging script; inspect `runtime/node.exe --version` | MIT with additional third-party notices |

Development tools include TypeScript (Apache-2.0), Vite (MIT), Vitest (MIT), and esbuild (MIT). Their complete dependencies and versions are recorded in `pnpm-lock.yaml`; they are not required to install or build anything when running the portable release.

## Bundled license texts

- [Apache License 2.0](docs/licenses/Apache-2.0.txt), copied from the installed Manifold package.
- [Three.js MIT license](docs/licenses/Three.js-MIT.txt), copied from the installed Three.js package.
- [Node.js license and dependency notices](docs/licenses/Node.js-LICENSE.txt), when included with the portable runtime.

Official sources:

- [MediaPipe repository and license](https://github.com/google-ai-edge/mediapipe)
- [Hand Landmarker model documentation](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)
- [Manifold repository](https://github.com/elalish/manifold)
- [Three.js repository](https://github.com/mrdoob/three.js)
- [Node.js license](https://github.com/nodejs/node/blob/main/LICENSE)

This project does not bundle training datasets, a trained ST-GCN/CTC model, paid APIs, remote inference services, or external fonts.

