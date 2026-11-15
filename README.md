# SignToAST

A local spatial CAD prototype: point and pinch to choose commands, move and scale solids with your hands, and compile each committed edit into a typed abstract syntax tree (AST).

The recognition backend is **MediaPipe + temporal gesture rules**. The app implements real solid subtraction using Manifold WASM. ST-GCN, CTC, natural sign-language translation, facial grammar, and quantized ONNX inference are future work; they are not used by this release.

## Run the portable Windows release

1. Extract the entire `SignToAST` release folder. Keep `dist`, `scripts`, and `runtime` beside `start-demo.cmd`.
2. Double-click `start-demo.cmd`. Keep its console window open.
3. Open the printed address, normally **http://127.0.0.1:4173**, in a current Chrome or Edge browser.
4. Wait for the local-asset check to complete. You can model immediately with mouse and keyboard.
5. Choose **Enable camera**, allow camera access, and complete the calibration instructions for gesture control.

The packaged release includes a Node runtime. It does not install packages, contact a CDN, or download a model when launched. A localhost server remains necessary: opening `index.html` directly with `file://` will not work correctly with browser workers and camera permissions.

To stop the server, press **Ctrl+C** in the launcher console. If port 4173 is already occupied, close the earlier instance or set `SIGNTOAST_PORT` before starting. Browser storage belongs to the exact origin, so changing the port creates a separate local workspace.

## Build from source

Use Node **20.19+ or 22.12+** and pnpm. Internet access is needed for the first dependency and model preparation; subsequent runtime operation is local.

```powershell
pnpm install --frozen-lockfile
pnpm assets
pnpm test
pnpm build
pnpm start
```

`pnpm assets` bundles the tracking worker, copies the pinned MediaPipe WASM files, downloads the hand model if it is absent, and writes a SHA-256 asset manifest. Rerun it after changing tracking worker code or tracking dependencies. Do not mix WASM files from different MediaPipe versions.

For development, run `pnpm assets` once, then `pnpm dev`. The dev server address differs from the production server address; use the production build for the final offline test.

Create the offline Windows release after a successful build:

```powershell
pnpm package
```

This creates `release/SignToAST`, including the production build, launcher, documentation, and the Node executable/runtime DLLs used to run the packaging script. It also creates `release/SignToAST-Source` with source code, lockfile, documentation, and prepared model assets, excluding dependency caches and build output. Build/package on Windows to produce the Windows launcher package. Ship the entire runtime output folder.

## Controls

Every edit is a preview until **Commit**. Releasing a pinch freezes the preview; it never commits it.

| Action | Gesture | Mouse / keyboard |
| --- | --- | --- |
| Choose a tool | Open the other hand; hover the pointer over a tool, then freshly pinch | Click tool; shortcuts below |
| Box | Choose Box | **B** |
| Cylinder | Choose Cylinder | **C** |
| Select | Pinch over a solid or an entry in the scene list | Click a solid/list entry; **V** selects the tool |
| Move | Choose Move, pinch and drag in the viewport | **M**, then drag |
| Scale | Choose Scale, pinch both hands, then change their separation | **S**, then wheel or **+ / −** |
| Subtract | Choose target, choose Subtract, then select a different cutter | **D**, then click cutter |
| Commit | Open other hand, hover Commit, then fresh pinch | **Enter** |
| Cancel draft | Open other hand, hover Cancel, then fresh pinch | **Escape** |
| Undo | Choose Undo | **Ctrl+Z** |
| Pause / resume edits | Choose Pause / Resume | **Space** |
| Reset scene | Use the reset control twice within three seconds | Two clicks on Reset workspace |

Keyboard shortcuts are inactive while a form field has focus. Scale is limited to **0.5–2.0×**. Move is snapped to **1 mm** on the object's fixed-depth XY plane. Scene dimensions are illustrative CAD values; the webcam does not measure physical millimetres.

Default primitives are a centered **20 × 20 × 20 mm box** and a centered **radius 5 mm, height 60 mm cylinder along Z**. The scene supports ten visible solids and twenty Undo snapshots. Undo snapshots are session-only; the committed project and command log are autosaved locally.

## Calibration and presenter setup

- Use a fixed frontal camera, good diffuse lighting, and both hands fully visible.
- Select Right or Left as the pointer hand. The camera preview is mirrored.
- Sweep your pointer hand over a comfortable area, perform three pinch/release cycles, and open your other hand to arm the toolbar.
- Toolbar activation requires a stable open other hand, a short hover, and a fresh pinch. Dragging a held pinch onto Commit does not activate it.
- If tracking is lost, the movement freezes. Show both hands, release pinches, and wait for stable tracking before continuing.

Calibration is saved to local browser storage. Recalibration cancels an unfinished draft. It does not calibrate depth or create camera-angle invariance.

## Tune unreliable button clicks

Start with **Pinch sensitivity → Easier**, **Button activation → Pinch**, and **Hover stability → Relaxed (350 ms)** in Gesture controls. Open your other palm, aim at **Test click**, wait for the progress bar to fill, then pinch and hold briefly (about 0.2 seconds). Fully release before repeating. Three successful test clicks are a useful check before editing.

The live display shows which hands are detected, the pointer's pinch ratio, the close/release thresholds, the current target, and the reason a button is not ready. The viewport also shows a compact copy of this feedback. If the cursor follows the wrong hand, change Pointer hand. If the other hand is blocking activation, straighten at least three fingers and spread its thumb from its index finger.

Button targets are captured when the pinch begins, before temporal debouncing, so small closing movements do not discard the intended click. A held pinch still cannot activate a button entered later. Slight open-palm pose jitter has a short grace period; missing tracking never executes a click.

For a demo fallback, choose **Dwell assist**. With both hands visible, keep the other palm open and the pointer thumb/index separated. Hold over a button for **0.9 seconds** (**1.2 seconds for Commit**). After activation, move off all buttons before choosing the next one. Two-hand pinching still controls Scale, and a pointer pinch still drags Move inside the viewport. Settings are saved locally.

If guided calibration is preventing practice, **Use current mapping** exits the guide explicitly. You can test or recalibrate that mapping afterward. Dwell assist can also use the current mapping without requiring three pinch cycles.

## Save and measure

**Export project** downloads versioned project JSON with solid recipes, transforms, and committed AST history. IndexedDB also autosaves the current committed scene. Reloading rebuilds its meshes from those recipes. There is no arbitrary project/mesh import in this release.

**Record demo** captures the CAD canvas and AST as a local WebM video. Click again to download it. It excludes webcam pixels and microphone audio. **Snapshot** saves a PNG of the current CAD view. An actual mouse/keyboard walkthrough is included at [docs/media/pointer-demo.webm](docs/media/pointer-demo.webm); use it as an interaction reference, not evidence of live gesture accuracy.

The diagnostics export downloads measured sample counts and p50/p95 timings, camera/tracking counters, and the active tracking backend. Values are browser timings, not physical motion-to-display measurements. Rendering, hand inference, rules-to-draft work, and Boolean geometry are measured separately. See [validation status](docs/VALIDATION.md) before making performance claims.

Raw camera video is not recorded or uploaded. Camera access starts only when enabled. Source assets and inference run locally; no account or cloud service is required.

## Troubleshooting

| Symptom | Recovery |
| --- | --- |
| Local assets unavailable | Ensure the release is fully extracted; for source builds run `pnpm assets` and rebuild |
| Camera permission denied | Allow the localhost site's camera permission in the browser, then enable the camera again |
| Camera already in use | Close other camera applications and retry |
| Tracking is slow | Improve lighting; close GPU-heavy apps; inspect actual tracking FPS and backend |
| Cursor cannot reach controls | Recalibrate with a wider comfortable sweep; check pointer-hand setting |
| Tool does not activate | Keep the other hand open; hover first; fully release, then pinch again |
| Cutter is hard to select | Choose it in the scene list; the nearest viewport hit can obscure a smaller solid |
| Subtraction returns an empty solid | Cancel or move/scale the cutter so some target material remains |
| Geometry times out | The previous scene is preserved; retry after the worker restarts |
| Autosave unavailable | Export the project before closing the tab |
| Launcher reports Node missing | Use the complete packaged release with its `runtime` folder |

## Project guide

- [Architecture and interfaces](docs/ARCHITECTURE.md)
- [Presenter rehearsal and demo script](docs/DEMO_GUIDE.md)
- [Validation status and acceptance procedure](docs/VALIDATION.md)
- [ST-GCN + CTC roadmap](docs/ROADMAP.md)
- [Example project](examples/through-hole-project.json) and [example AST request](examples/subtract-command.json)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

