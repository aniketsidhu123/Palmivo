# Architecture

Palmivo separates sensing, interaction, command compilation, and geometry execution. Gesture hypotheses do not directly mutate CAD meshes.

```mermaid
flowchart LR
  Camera[Local webcam] --> Tracking[MediaPipe tracking worker]
  Tracking --> Rules[Temporal gesture rules]
  Rules --> Controller[Draft controller and validator]
  Pointer[Mouse and keyboard] --> Controller
  Controller --> Preview[Reversible render preview]
  Controller --> AST[Committed typed AST]
  AST --> Geometry[Manifold geometry worker]
  Geometry --> Scene[Committed scene and Undo history]
  Scene --> View[Three.js viewport]
  Preview --> View
  Scene --> Storage[IndexedDB and JSON export]
```

## Module responsibilities

| Module | Responsibility |
| --- | --- |
| `src/main.ts` | Input routing, calibration, worker wiring, autosave, diagnostics |
| `src/tracking` | Camera scheduling, MediaPipe worker, hand features, temporal recognition |
| `src/core/controller.ts` | Authoritative scene state, drafts, Commit, Cancel, Undo |
| `src/core/validation.ts` | AST, scene, bounds, reference, and revision validation |
| `src/core/transformSteps.ts` | Exact XY and uniform-scale preview adjustments through the same controller |
| `src/core/benchmark.ts` | Fixed measurement windows, warm-up exclusion, bounded samples, and percentile accounting |
| `src/geometry` | Manifold WASM kernel, worker transport, timeout/restart |
| `src/ui` | DOM workspace, Three.js scene, picking and plane projection |
| `src/ui/performancePanel.ts` | Negotiated camera mode, measured rates, benchmark controls, and result summaries |
| `src/storage.ts` | Local project persistence |
| `src/metrics.ts` | Bounded timing samples and JSON downloads |
| `src/shared/types.ts` | Shared data contracts |

## Threading and backpressure

The main thread renders independently and owns the interaction state. The tracking worker processes one transferred image bitmap at a time. While inference runs, the client retains only the newest waiting frame's timestamp/media metadata. Worker completion immediately submits that newest frame, avoiding a wait for another camera callback. Superseded metadata is discarded, so neither image resources nor inference jobs accumulate. The geometry worker handles committed solid generation and Boolean work.

Tracking initializes its model once. Geometry initializes its WASM module once. Transferred image bitmaps are closed after processing. Geometry results contain independent typed arrays, so deleting Manifold handles cannot invalidate the rendered mesh.

Camera startup requests the preferred capture rate and, where supported, attempts a minimum 30 FPS mode at the exact negotiated resolution. A rejected preference restores the prior constraints. Diagnostics expose negotiated dimensions, rate, and supported rate ranges separately from delivered frame counts. Frame conversion and inference both have timeout and generation guards.

The renderer retains `requestAnimationFrame` scheduling with a drift-corrected 60 FPS work budget. It reports intervals and counts for actual rendered frames. Static shadow maps are reused; committed geometry and changed preview transforms invalidate them. Rendering, tracking, and geometry remain separate schedules.

## Input modes and accessible command access

Pinch mode uses a dominant pointer hand and an open other palm to arm toolbar controls. Two-hand Dwell assist keeps the same tracking roles and replaces the pinch click with a timed hover. Both retain continuous pinch-drag movement and two-hand scaling.

One-hand dwell tracks the selected pointer-hand identity alone. It accepts a relaxed hand without pinch or extended-finger pose requirements. It requires 300 ms of stable valid tracking and repeats that neutral reacquisition after a missing observation. Single-hand outputs never create pinch edges or a two-hand scaling state.

The shared target activator uses 900 ms dwell for ordinary controls and 1,200 ms for Commit. After activation, the cursor must leave all controls with deliberate movement before another dwell can activate. Missing tracking clears candidates immediately. Switching input mode cancels an unfinished draft and resets temporal arming.

Precise adjustment buttons provide 1 mm steps along X/Y and 0.1× changes in uniform scale. They update controller drafts and require the same explicit Commit or Cancel as continuous manipulation. Object-list selection, creation presets, Boolean operands, Undo, and STL export use the same target resolution path. Focused HTML buttons retain their normal Enter/Space activation; workspace shortcuts remain available outside focused controls.

Default calibration checks both hands, comfortable cursor range, pinch cycles, and toolbar arming. One-hand calibration records the pointer's comfortable range without pinch cycles or an offhand check. Profiles and input settings persist in local storage.

The geometry client assigns increasing job IDs. A three-second timeout terminates the worker and rejects pending work. Old worker responses are ignored after restart. The controller also uses a generation guard, preventing an in-flight result from restoring geometry after a reset.

## Commands and scene data

`CommandAST` is a discriminated union of `Create`, `Move`, `Scale`, and `Subtract`. A command request also contains a unique command ID, base scene revision, and input source. Object references are concrete IDs before execution.

Validation rejects incomplete arguments, nonfinite positions/scales, unsupported bounds, missing objects, identical subtraction operands, duplicate command IDs, and stale scene revisions. The controller permits one draft and one commit transaction at a time.

Selection, pause, Commit, Cancel, and Undo are controller events, not geometry AST variants. The rule recognizer can later be replaced without rewriting the AST executor.

`SceneDocument` version 1 contains:

- `schemaVersion: 1`, `units: "mm"`, and a scene revision.
- Visible solids with IDs, names, colors, positions, uniform scales, and geometry recipes.
- The committed command log for the current scene lineage.

Recipes are centered boxes, Z-axis cylinders, or subtraction trees capturing both source solids. Subtraction applies each source's scale and position before evaluating the Boolean. The resulting solid has its own identity transform; its recipe preserves operand geometry and transforms.

## Preview, Commit, Cancel, and Undo

A draft lives separately from the committed document. Move and Scale previews change render transforms without rebuilding geometry every frame. Commit first validates a typed AST, then waits for required geometry. Success swaps the scene atomically; failure preserves the old scene and leaves the draft available for correction.

Subtraction removes the two operands from the visible scene only after success. Undo restores a previous scene snapshot containing them. Twenty snapshots are retained in memory. Undo advances the revision while restoring the prior geometry state. Reload restores the saved scene and command history, but not the session's Undo stack.

## Coordinate spaces

Camera coordinates, hand-local features, screen coordinates, and CAD coordinates are distinct. Cursor mapping handles the mirrored camera once. Pinch is normalized by palm size. Move uses ray intersection with an explicit plane at the object's current Z; it does not treat inferred hand depth as measured CAD depth.

CAD units are illustrative millimetres. Box defaults are 20 mm per axis. Cylinder defaults are radius 5 mm and height 60 mm along Z. Uniform scale is clamped to 0.5–2.0 and XY translation is snapped to 1 mm.

## Offline deployment

`pnpm assets` emits a locally bundled tracking worker, copies the matching MediaPipe WASM files, and prepares the local `.task` model. It writes a SHA-256 manifest. Startup checks the manifest and initializes the geometry engine before marking local assets ready.

Vite emits local application and geometry-worker assets. The static server binds to `127.0.0.1:4173`; it serves production files with JavaScript/WASM MIME types, local camera permission policy, and cross-origin isolation headers. No service worker, remote inference server, login, or cloud storage is required.

## Measurement boundaries

Camera delivery FPS and processed tracking FPS are separate. Inference timings cover the tracking call; rules-to-draft timing covers recognition and synchronous interaction handling; geometry timings cover the asynchronous geometry request. Render-frame intervals and command completion times are separate samples.

The collector keeps a bounded rolling sample window per metric. Its export includes p50, p95, and sample counts. These values do not establish physical motion-to-display latency. No trained ST-GCN/CTC inference is included in the current timing path.

The fixed benchmark is separate from rolling diagnostics. It snapshots input/camera metadata at Start, excludes a three-second warm-up, and accepts observations only during the following twenty seconds. Exact completed tracking and rendering counts determine their average FPS. Camera-rate observations retain the client-reported interval-rate definition. Percentiles use nearest rank over bounded retained samples; counts and means use all accepted observations.

The export includes hand-presence and control-ready proportions. Video-callback-to-handler timing ends after synchronous main-thread interaction handling; exposure, deliberate dwell, display scanout, and asynchronous geometry have separate boundaries. Camera stop, input configuration changes, recalibration, or backgrounding the tab interrupt an active benchmark rather than combine incompatible samples. Measurement exports live in `docs/benchmarks/`.

