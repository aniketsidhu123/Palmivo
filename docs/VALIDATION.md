# Validation record

This file distinguishes verified automated behavior from hardware/presenter checks that require the actual live setup. Targets are not measured results.

## Automated verification

The current project passes **283 tests across 21 source files**, plus TypeScript, production bundling, and local-asset verification. The historical release sections below retain the conditions and counts of their original runs.

| Check | Status / result |
| --- | --- |
| Complete TypeScript check | Passed |
| Complete automated test suite | 283 tests passed across 21 source files |
| Production build and asset verification | Passed; six tracking assets SHA-256 verified, geometry WASM emitted and initialized |
| Production browser smoke test | Ten consecutive pointer/keyboard CAD sequences passed; no browser errors |
| Portable launcher smoke test | Included Node v24.22.1 launched the packaged server; packaged app passed Create/Subtract/Undo and reload restoration on port 4180 |

Run `pnpm test` and `pnpm build` to reproduce the automated checks. Core tests verify preview isolation, Cancel, transformed subtraction recipes, exact scene restoration on Undo, geometry failure preservation, duplicate commit blocking, stale reset results, revision/ID validation, scale bounds, pause, scene limits, and saved-project restoration.

The geometry tests execute the actual Manifold WASM module. They verify box volume/extents, centered cylinder dimensions, a transformed box-minus-cylinder through-hole, disjoint cutters, rejection of empty results, independent output buffers, and validation/rebuilding of the distributed example project. Worker lifecycle tests verify ID matching, timeout/restart, stale responses, and disposal.

## Performance targets

The table below records earlier measurement sessions. Current source caps CAD rendering at a 60 FPS budget. The preserved camera pipeline baseline in `benchmarks/performance-before.json` reports 15.08 FPS delivered/processed, landmark p50/p95 12.440/18.560 ms, and rules-to-draft p50/p95 0.110/0.175 ms across 1,201 observations. Hand presence was uncontrolled in that baseline. The fixed-window benchmark implementation now records presence and control-ready coverage separately.

| Metric | Target | Measured result |
| --- | --- | --- |
| Rendering | Average at least 55 FPS in the fixed demo | Browser frame intervals: p50 6.07 ms, p95 6.59 ms in pointer run; instantaneous display approximately 165 FPS |
| Processed tracking | At least 25 frames/second | Approximately 13–15 FPS delivered/processed in this camera session; target not met |
| Rules-to-draft work | Warm p95 below 15 ms | p50 0.105 ms, p95 0.165 ms over 442 missing-hands camera frames; no validated hands-on command timing |
| MediaPipe GPU hand inference | Measured separately | p50 12.70 ms, p95 25.02 ms over 442 frames |
| Simple Boolean subtraction | Warm p95 below 500 ms | p50 11.08 ms, p95 12.33 ms over 12 browser samples |
| Long-run stability | Ten minutes without queue growth or progressive slowdown | Not recorded |

Use the diagnostics export after warm-up to retain sample counts and p50/p95 results. Record browser version, camera settings, laptop/GPU, power mode, lighting, scene size, and active tracking backend with the exported file.

`rules_to_draft_ms` measures the rule recognizer and synchronous interaction handling. It is not a trained ST-GCN inference measurement. Camera exposure, capture transport, intentional gesture holds, display refresh, and user movement duration are outside that metric. This release makes no validated physical sub-15 ms motion-to-action claim.

## Live acceptance checklist

Mark each item only after running it on the actual presenter setup.

- [ ] Ten consecutive complete gesture demonstrations without restarting the app.
- [ ] Production app reloads after Wi-Fi is disabled.
- [ ] Offline camera startup, Create, Move, Scale, Subtract, Undo, Cancel, and JSON export work.
- [ ] Both-hand tracking and pointer handedness match the presenter.
- [ ] A hand leaving frame freezes manipulation without unintended execution.
- [ ] Hand crossing and accidental pinches do not trigger unintended commands.
- [ ] A held pinch dragged onto Commit does not execute.
- [ ] Camera denial/unavailability shows a useful recovery message.
- [ ] Ten-minute soak shows no accumulating frame backlog or progressive slowdown.
- [ ] Reload restores the committed project.
- [ ] No required external requests occur during the production offline run.
- [ ] Final screen recording shows the actual backend, AST, geometry result, and recovery.

## Release QA notes

Verified on November 14, 2026, in the Codex in-app Chromium browser on the Windows laptop. The source environment reports an NVIDIA RTX 4050 Laptop GPU. Browser GPU choice and monitor refresh rate were not independently profiled. Exact exported sample counts/timings are retained in [browser measurements](benchmarks/browser-measurements.json) and [camera measurements](benchmarks/camera-measurements.json).

The ten pointer/keyboard sequences each exercised Box creation, 1.4× scaling, Cylinder creation, explicit target/cutter selection, real Subtract, Undo, Move draft, and Cancel. Reload reconstructed the committed project. Both 1440×1000 desktop and approximately 474 px compact layouts were visually checked. An initially incorrect grid placement and smoothed Boolean surface shading were fixed during QA.

MediaPipe initialized successfully using its GPU worker and processed 640×480 camera frames. Camera stop/restart and the missing-hands paused state were observed. No hands-on calibration or gesture command was verified. Camera rejection, worker stalls, generation cancellation, and bitmap cleanup have mocked lifecycle tests.

The portable package was separately launched from its own folder using its included Node executable, on port 4180. Local-asset checks, Create, real Subtract, Undo, and post-reload restoration passed without a browser error. The batch launcher was inspected; the smoke test invoked its underlying Node/server command directly.

[Recorded pointer demo](media/pointer-demo.webm) shows actual CAD geometry and AST output, with no webcam imagery or audio. [CAD preview](media/cad-preview.png) shows the actual subtraction result.

Wi-Fi-disconnected proof, ten consecutive physical gesture demonstrations, physical motion-to-display latency, and an uninterrupted ten-minute soak remain presenter acceptance checks. No claim of ST-GCN/CTC execution, natural sign-language translation, arbitrary viewpoint invariance, 60 FPS tracking, or sub-15 ms physical response is made.

## Button-selection reliability update — November 15, 2026

User-reported symptoms were missed pinches on stationary buttons and small pointer movements while closing the pinch. The update captures a stable target on the raw closing observation, before the two-observation pinch latch, and tolerates up to 64 CSS pixels of closing drift. It does not permit dragging an already-held pinch onto another control to execute it. Every repeated pinch still needs release and a fresh hover.

Default practice settings are Easier sensitivity (0.40 close / 0.62 release), Pinch activation, and 350 ms hover. Cursor smoothing is 90 ms. Offhand readiness accepts three extended fingers with short pose hysteresis. Invalid samples immediately block controls; a 225 ms tracking gap triggers full neutral reacquisition. A held pinch recovered after missing input cannot become a new click.

New UI includes a nonmutating Test click counter, hand/ratio/readiness/target feedback, in-viewport feedback HUD, persistent tuning settings, and optional dwell assist. Dwell requires 900 ms on buttons and 1200 ms on Commit, then movement off all targets to rearm. It keeps spatial pinching available for Move and Scale. Guided calibration can be exited explicitly with Use current mapping.

The 80-test suite includes 20 activation-state tests and eight real GestureRecognizer-to-TargetActivation integration tests at 13/15/30 FPS. These cover 20–50 px closing movements across button edges, repeated clicks, held-drag rejection, offhand poses, missing tracking, and two-hand scaling. New regression coverage also checks a single-frame dropout at 13 FPS. Release source copies are excluded from test discovery.

Browser checks verified tuning controls, practice-counter wiring, persistence of activation mode across reload, and Create/Scale/Subtract/Undo recovery. An initial startup click timing issue was corrected by disabling tools until restoration finishes. The final built files and SHA-256 tracking assets passed verification. [Updated controls screenshot](media/gesture-tuning.jpg) is a camera-off UI test, not evidence of physical gesture success. Presenter retesting has been requested; its outcome is not recorded yet.

## Prototype 03 polish validation — November 15, 2026

Implemented the five improvements from the recorded-demo review: operation-aware instructions, a compact reserved HUD strip, persistent accepted-action feedback, filtered scaling, and lighter preview updates.

- All 132 automated tests passed across 14 source files; TypeScript, production bundling, and local-asset verification passed.
- Three full gesture-pipeline integration tests at simulated 13/30/60 FPS use real 21-landmark inputs, recognition, stable target activation, smoothed scaling, the transaction controller, and actual Manifold geometry. Each completes Create Box → Scale → Create Cylinder → Subtract → Undo → Move draft → Cancel. Geometry volume is checked against the expected through-hole.
- Tests found and fixed a release-frame issue: the first raw opening sample could previously change scale before the two-observation release latch. Scale now freezes exactly on that first opening and requires a confirmed release before re-gripping.
- Ten consecutive production-browser pointer/keyboard demo runs completed with exact 1.40× scale commits, correct Boolean results, Undo, Cancel, and no console errors. A desktop Reset hit-area overlap and AST/Commit overlap found during QA were fixed and the ten-run check repeated successfully.
- A developer-only browser fixture verified active Scale instructions, held-state Commit guidance, confirmation priority over new tracking context, stable object buttons and render resources through 100 updates, and no HUD/canvas overlap. The HUD occupied a reserved 50 px strip in desktop testing and 48 px at 768 px width, with no horizontal overflow. [Fixture screenshot](media/polish-ui-fixture.jpg) explicitly identifies its simulated input and does not claim a live-hand test.
- Preview scheduling tests verify immediate transform updates, coalesced inspector work, no preview persistence, and cancellation of stale queued text on commit/cancel. Real Three.js object tests verify no geometry/material/outline replacement during 100 preview updates.
- Startup recovery tests protect the original saved project when restoration fails. Camera stop/error clears transient manipulation guidance.

[Polish browser measurements](benchmarks/polish-measurements.json) retain the actual samples and update/allocation counters. In that camera-off ten-run session, 40 preview transforms produced 9 coalesced inspector updates. Boolean p95 was 5.98 ms over ten samples; frame-interval p50/p95 was 6.07/6.82 ms. These are observations from this run, not a controlled before/after speedup comparison or a physical gesture-latency measurement.

The presenter's supplied recording confirms the pre-polish gesture workflow succeeds. Prototype 03 was tested through automated landmark sequences and browser interaction; a fresh physical gesture rehearsal of this polished build remains a presenter check.

## Prototype 04 features — November 15, 2026

Release scope for the November 16 evening submission: precise creation presets and reopening exported version 1 projects.

- All 200 tests passed across 16 source test files. TypeScript, production bundling, and local-asset verification passed.
- Box X/Y/Z independently accept 20, 30, or 40 mm. Cylinder radius accepts 3, 5, or 8 mm and height accepts 20, 40, or 60 mm. Tests check exact Create AST values, immutable preview replacement, Cancel, Commit, Undo, disabled states, and actual Manifold volumes/extents.
- Six full landmark-pipeline scenarios cover the default and precise demo at simulated 13/30/60 FPS. The precise demo uses a 20 × 30 × 40 mm box scaled approximately 1.4× and a radius 3 mm, height 60 mm cutter. Tests verify the expected through-hole volume, one activation per held pinch, explicit Commit, export/parse/rebuild equality, preserved AST history, and continued editing after reopening.
- Project parsing tests cover the existing distributed export, complete saved command shapes, malformed/unsupported/oversized files, invalid numeric values, duplicate IDs, and bounded recipe depth/complexity. A failed rebuild preserves the previous scene, meshes, selection, draft, and session Undo history.
- Ten consecutive production-browser pointer/keyboard demos passed with precise presets, 1.40× scaling, real subtraction, Undo, and Move/Cancel. No browser errors were recorded. This is a browser interaction test; the synthetic landmark scenarios above provide the gesture logic coverage.
- Browser checks exercised all nine Box preset buttons, draft cancellation, Cylinder radius/height controls, the project review, Cancel and Escape, invalid-file rejection, successful reopening, re-export equality, and reload restoration without camera access. Opening a file blocks editing while the picker and review are active. Cancel of the native OS file picker remains a presenter check; review cancellation was verified.
- Larger presets revealed that the decorative floor could obscure a solid. It now follows the lowest visible bound, including manipulation previews, without allocating new geometry. Opened and restored scenes are fitted to the same oblique camera direction.
- At 1264 × 740, all nine Box presets and Commit passed center-point hit tests with no horizontal overflow. The 768 × 900 layout also retained usable preset controls without horizontal overflow.
- The refreshed portable folder was launched with its bundled Node runtime on port 4184. An additional complete precise demo, opening the packaged example, Move/Cancel, and reload restoration passed with no browser errors. The running portable server on port 4173 serves the refreshed Prototype 04 build.

[Prototype 04 browser measurements](benchmarks/prototype04-measurements.json) retain the ten-run samples: Boolean p50/p95 3.58/7.00 ms over ten operations; frame-interval p50/p95 6.07/6.17 ms. Tracking was off during that browser run. These figures do not measure physical gesture latency or guarantee performance on another display.

The [precise example project](../examples/precise-through-hole-project.json) was exported by the tested browser and reopened without changing any scene or command data. The command log survives reopening; Undo snapshots start with edits made in the new session. [Project review screenshot](media/project-open-review.jpg), [precise controls screenshot](media/precise-size-presets.jpg), and [reopened portable model](media/prototype04-reopened.jpg) show the actual camera-off application.

A fresh physical gesture rehearsal, Wi-Fi-disabled reload, and ten-minute soak on the presenter's final setup remain the final hardware checks. The recognizer remains MediaPipe + temporal gesture rules.

## Prototype 05 STL export and dimensions — November 15–16, 2026

- All **231 tests across 18 source files** passed, including 31 new measurement/export tests. TypeScript, production bundling, and local-asset verification passed.
- The inspector derives selected-solid X/Y/Z bounds from authoritative geometry, including committed uniform scale. Scale and Move drafts show Preview size, subtraction shows Target size, and Cancel restores committed dimensions. Measurements stay cached during continuous previews.
- Export writes one selected committed solid as binary STL. It applies the solid's outer transform once, recomputes normals from stored float32 vertices, sanitizes the filename, and excludes previews, grid, outlines, and removed operands. Export is blocked during drafts, busy/pause states, project opening, and missing selection. It does not add an AST command or change scene history.
- All six default/precise landmark-pipeline scenarios at simulated 13/30/60 FPS now include STL export activation. They check one download result per fresh pinch, draft/pause rejection, independent Three.js STLLoader bounds and signed-volume checks, ray tests through the open bore and adjacent material, and byte-identical export after JSON reopening.
- Three complete production-browser pointer/keyboard demos passed Create Box, precise dimensions, 1.4× Scale, Create Cylinder, Subtract, Undo, Move/Cancel. Additional browser checks passed preview dimensions/Cancel, paused/draft export rejection, keyboard Enter and Space export, project reopening, reload restoration, unchanged AST/revision, and no console errors.
- On November 16, the refreshed portable folder passed an additional complete demo using its bundled Node runtime on port 4184, including real STL download, Undo, Move/Cancel, repeated subtraction, and reload restoration. Both the final dimensions and exported bytes match the independently verified example. No browser errors were recorded. This brings Prototype 05 browser demo coverage to four complete runs, separate from the six simulated gesture scenarios.
- The desktop Export and subtract Commit controls passed center-point hit checks. At 768 × 900, the page has no horizontal overflow, Export has a 44 px target, and the inspector retains the 28 × 42 × 56 mm dimensions.
- Actual browser downloads are distributed as [scaled box STL](../examples/scaled-box-mm.stl) and [through-hole STL](../examples/through-hole-mm.stl). A separate Python standard-library reader checked binary length/count, finite vertices, unit normals, winding, welded-edge closure, bounds, signed volume, Euler characteristic, and rays through the bore. It imports no Palmivo export code.

| Downloaded file | Final X/Y/Z in mm | Triangles | Signed volume in mm³ | Surface audit |
| --- | --- | --- | --- | --- |
| Scaled box | 28 × 42 × 56 | 12 | 65,856.000 | Closed, consistent winding, Euler 2 |
| Through-hole result | 28 × 42 × 56 | 144 | 64,282.792 | Closed, consistent winding, Euler 0; center ray 0 hits, adjacent stock ray 2 hits |

The exported through-hole also loaded in the [separate STLLoader viewer](media/stl-independent-viewer.jpg), which has no application controller or exporter dependency. The actual [inspector and export controls](media/stl-dimensions-inspector.jpg) show the final measurements. The [independent byte/geometry audit](benchmarks/stl-verification.json) records both downloaded STL files. This verifies an exchange mesh; no slicer run or physical print was performed. STL stores surface coordinates without encoded units, so import these numeric coordinates as millimetres. Keep project JSON for recipes and AST history.

Current tests include no new physical gesture latency, camera-throughput, or live-hand claim. A final presenter rehearsal, Wi-Fi-disabled reload, and controlled ten-minute soak remain hardware checks before submission.

## Prototype 06 frontend release — November 16, 2026

The dark workbench refresh supports recording and submission this afternoon. It uses local/system fonts, stronger section labels, mint interaction feedback, and amber Commit controls. The recognition backend remains **MediaPipe + temporal gesture rules**. Controller logic, public UI APIs, DOM identifiers, palette ordering, and gesture-target identifiers remain unchanged.

- The final rerun passed **231 tests across 18 files**, TypeScript, production bundling, and verification of the six local tracking assets plus geometry WASM. The six default/precise landmark-pipeline scenarios cover simulated 13/30/60 FPS. No new performance or physical tracking result is inferred from the visual refresh.
- Two production-browser sequences passed: the precise Box 20 × 30 × 40 mm → 1.4× Scale → Cylinder radius 3 mm, height 60 mm → Subtract → Undo → Move/Cancel, and the default Box/Scale/Cylinder/Subtract sequence. Additional checks passed Scale/Cancel, Pause, STL and project JSON downloads, confirmed project reopening, and reload restoration. Dwell-mode persistence, the Test click counter, Record demo, and Snapshot were exercised without camera access.
- The downloaded through-hole STL remained byte-identical to the independently verified example: 144 triangles, 28 × 42 × 56 mm bounds, signed volume 64,282.791638 mm³, closed surface with Euler characteristic 0, no center-ray hits, and two adjacent-stock-ray hits.
- A development-only appearance fixture used real geometry and explicitly simulated tracking to inspect active/held scaling, tracking loss, busy state, palette hover/click confirmation, and project-review cancellation. One hundred preview updates reused rendering resources. These are simulated state checks, not a live-hand rehearsal; the fixture is excluded from the production application.
- Click confirmation initially shifted the instruction area by 6.8 px. Reserving its text area removed that shift; the Export control retained the same rectangle before and after confirmation. The HUD and canvas do not overlap.
- Responsive checks at 768 px and 474 px widths found no horizontal overflow and retained 44 px primary interaction targets. Desktop controls remain visible without moving the gesture targets during feedback.

- The refreshed portable folder ran with its included Node runtime on port 4184. A third full browser demo passed precise creation, Scale, Subtract, STL download, Undo, Move/Cancel, repeated subtraction, and reload restoration with no console errors. Its downloaded STL is byte-identical to the verified example. The normal port 4173 serves the same Build 06 assets and reports local assets ready.

The [final workbench screenshot](media/workbench-final.jpg) shows the actual camera-off application. The [recorded browser sequence](media/workbench-browser-demo.webm) contains the real CAD canvas and AST, without webcam imagery or audio. Fresh physical-hand rehearsal, Wi-Fi-disabled reload, and the ten-minute hardware soak remain presenter checks. This release makes no new latency, camera-rate, or tracking-throughput claim.

## Current source and packaged workspace

- All **283 tests in 21 files** and TypeScript pass. The production build and six-asset SHA-256 check pass. Current full landmark-driven geometry coverage includes six default/precise two-hand sequences and three one-hand sequences at simulated 13/30/60 FPS, plus safety and recovery scenarios.
- One-hand dwell requires a stable detected pointer hand, without pinching or an offhand. Range-only calibration, deliberate dwell, target-exit rearming, and missing-input recovery have automated coverage. Precise Move/Scale buttons use the same draft controller and require explicit Commit.
- Tracking prefers a supported capture-rate constraint at the existing resolution and processes the newest waiting metadata immediately after worker completion. Capture, worker round trip, callback-to-handler, rules, and geometry measurements remain separate. The raw camera probes show approximately 15 FPS delivery on the tested camera despite its advertised 30 FPS mode.
- The renderer uses a drift-corrected 60 FPS budget and static shadow reuse. Tests verify refresh-rate scheduling, shadow invalidation, and preview resource reuse. The 23-second benchmark excludes its first three seconds and measures a fixed twenty-second window. Tests cover warm-up exclusion, timing order, sample accounting, percentile calculation, and repeated sessions.
- The packaged camera-off browser flow passed precise Box creation, four 0.1× scale steps to 1.4×, keyboard activation of a 1 mm X move, Cancel restoring its position, Cylinder creation, and real subtraction with 28 × 42 × 56 mm dimensions. Undo and input-mode changes preserved the committed scene. No browser console errors were recorded. These are pointer/keyboard browser checks, separate from the synthetic landmark tests.
- [One-hand controls](media/one-hand-precision.jpg), [inspector detail](media/one-hand-inspector.jpg), and [current CAD workspace](media/workspace-mvp.jpg) show the actual packaged application with camera off. The final eight-slide presentation uses these current controls and distinguishes implemented recognition from future ST-GCN/CTC research.

The README and presentation use preserved stage measurements with their original conditions. No 30–60 FPS camera achievement, controlled before/after speedup, or physical gesture-latency result is inferred from the source changes.

## Expanded shape and mesh workflow

- 371 application tests, six hosted API tests and eight inspection workflow tests passed. The production build verified the pinned ONNX model, local runtime assets and Manifold WASM.
- In Chrome with non-loopback traffic blocked, the palette and simulated TSM predictions both built the original **20 × 20 × 40 mm** bushing. The actual bundled TSM worker separately returned finite logits for 14 synthetic frames and reproduced first-frame output after a reset.
- Browser checks covered Sphere and Square Pyramid creation, a version 3 Union reopening, STL import with source-unit review and Cancel, and a committed **1.1×** scale. The scaled bushing reopened from OBJ, project JSON and IndexedDB autosave at **22 × 22 × 44 mm**. An independent STL audit confirmed a closed 400-triangle surface and open centre passage.
- A separate polygonal OBJ stock part accepted a conical subtraction. Undo restored both operands. Reapplying the cut, reopening the project and exporting binary STL yielded a closed 78-triangle part at **40 × 40 × 40 mm** with **63,739.88 mm³** volume.
- Gesture tests exercise adjacent-button suppression, fresh activation and rejection of in-flight predictions across pointer-hand loss. The physical first-attempt and gesture-end-to-draft gates require a presenter rehearsal. Runtime settings include an opt-in labelled trace for measuring those gates.

