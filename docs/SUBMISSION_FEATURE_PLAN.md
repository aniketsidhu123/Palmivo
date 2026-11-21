# Palmivo submission feature plan

**Release objective.** A presenter can select adjacent tools reliably, open the intended draft with one shortcut, and modify a part supplied by another CAD application. The proof is a physical gesture rehearsal and an independently verified STL/OBJ round trip. The numbers below are proposed acceptance targets unless identified as recorded measurements.

| Priority | Deliverable | Evidence required to promote it |
| --- | --- | --- |
| 1 | More precise pointer, pinch and MIT TSM shortcuts | Labelled attempts on the demo laptop, including misses, wrong tools, false activations and latency |
| 2 | Sphere, Cone and Square Pyramid in the toolbar | Each shape previews at the correct size, commits, participates in a Boolean, survives Undo and reopens |
| 3 | Local STL and OBJ import, selected-solid STL and OBJ export | An external part can be modified, saved, reopened offline and measured in a second application |

## 1. Improve accuracy before expanding the palette

The current pointer uses timestamp-based smoothing, captures the intended button as the pinch closes and requires neutral rearming after tracking loss. The default toolbar hover is 350 ms. Cursor smoothing is 90 ms. MIT TSM has separate swipe and thumbs-up acceptance rules. A recorded Wi-Fi-off trial measured 29.43 camera FPS, 28.85 tracking FPS and 59.82 render FPS while listening. Its 40.06 ms p95 inference time covers individual frames across 74 predictions. First-attempt accuracy and physical gesture-end-to-draft time still need a baseline. [Rehearsal measurements](OFFLINE_ROUND.md)

1. **Measure where attempts fail.** Fix camera position, lighting, browser zoom, layout and calibration. In a local opt-in trace, record intended target, hovered target, pinch onset, activation, neutral-ready time, timestamped TSM scores and draft outcome. Track stationary jitter in CSS pixels and intentional movement lag separately. Mark physical gesture ends from a consented local recording or observer annotation. Keep time waiting for the model to load separate from time waiting for it to recognize a gesture.
2. **Tune the pointer against the observed fault.** If a closing pinch displaces the cursor, keep the last eligible hover target through that close, using target bounds and adjacent-button spacing. If a stationary hand jitters, trial stronger smoothing at low speed and lighter smoothing during a reach. If hand crossings switch roles, match hand identity across frames and suspend an ambiguous sample. Test each change independently. Preserve fresh activation, deliberate Commit, pause on loss, and dwell, mouse and keyboard controls.
3. **Tune the three shortcuts independently.** Swipe left opens Box, swipe right opens Cylinder and thumbs up opens Union when eligible. Classify a failed attempt as an arming delay, missed movement, competing label, unavailable tool or timeout. Replay timestamped scores to compare confidence, competing-class margin and evidence duration. Test a wrist-direction consistency check only if wrong-direction swipes recur. Test thumbs-up evidence across variable frame intervals if sustained poses are missed. Retain one frame in flight, one draft per arm and neutral reacquisition.
4. **Freeze the settings and test on fresh attempts.** Use practice takes for tuning and a separate held-out session for the final tally. Randomize the order for baseline and candidate. Include centre and edge buttons, adjacent targets, reaching, hands crossing, a held pinch moved onto Commit, hand loss and ordinary toolbar activity. Repeat pointer selection on the final expanded palette.

| Presenter test | Proposed release target |
| --- | --- |
| 60 intended pointer selections | At least 57 correct on the first attempt, zero unintended Commits and zero duplicate activations. Report stationary jitter p95 and target-acquisition p95 alongside the baseline. |
| 20 eligible attempts per TSM shortcut | At least 18/20 correct first attempts **for each gesture** and zero wrong-tool drafts across the 60 attempts. Record misses separately. Exercise thumbs up with Union unavailable as a separate negative test. |
| Holds and false activations | Five accumulated minutes of armed negative activity with zero unintended drafts. Compare p50/p95 gesture-end-to-draft times and time to arm. Promote timing changes only when the measured problem improves without increasing wrong activations or worsening p95 response time. |
| Sustained use | Three consecutive physical bushing demos. Three matched 3 s warm-up + 20 s measured runs per mode, with nonzero TSM samples while listening. Aim for at least 55 render FPS and at least 90% of matched rules-only tracking FPS. |

## 2. Add useful shapes without shrinking the gesture targets

Keep Box and Cylinder directly accessible. Add one **More shapes** button with full-size Sphere, Cone and Square Pyramid targets and a Back action. Each choice opens a normal Create draft with millimetre presets and explicit Commit. Opening the chooser must consume the activating pinch or dwell so it cannot also select a shape.

| Primitive | Proposed first preset | Practical use and verification |
| --- | --- | --- |
| Sphere | Radius 10 mm | Ball joint or rounded end. Check 20 mm bounds on all three axes and positive enclosed volume. |
| Cone | Base radius 10 mm, height 20 mm | Tapered boss or countersink cutter. Check 20 × 20 × 20 mm bounds and taper toward +Z. |
| Square Pyramid | Base side 20 mm, height 20 mm | Tapered square guide. Check an axis-aligned 20 × 20 mm base, one apex and its orientation. |

Extend the shared primitive types, dimensions, presets, AST validation, controller, viewport previews, Manifold worker and project reader together. Use the same Z-up centring and tessellation for preview and committed geometry. Test bounds, volume within an explicit tessellation tolerance, transformed Booleans, Undo, export and reopen for each primitive. Version 3 can identify the new recipes while the reader continues to accept versions 1 and 2. [Geometry kernel](../src/geometry/kernel.ts) · [Manifold geometry API](https://manifoldcad.org/docs/jsapi/classes/manifold.Manifold.html)

After the three gates pass, the first optional addition is a hexagonal prism sized **across flats**, useful for spacers and nut pockets. A hollow tube preset is another candidate if presenter trials show that repeating a cylinder subtraction consumes substantial demo time.

## 3. Import a mesh that can actually be edited

| File selected in Open Project | User-visible result |
| --- | --- |
| Palmivo JSON | Reopen the complete scene with its recipes, transforms and committed command log. |
| STL or OBJ | Preview one local mesh, show source units and resulting dimensions, then Commit to add and select it in the current scene. Cancel discards the preview. |

**Input.** Accept binary and ASCII STL. Support polygonal OBJ faces with positive and relative indices, including texture/normal index syntax. Triangulate planar polygons correctly or reject unsupported faces with a specific reason. Combine object groups into one imported part and disclose that choice in the preview. Use local file bytes, default to millimetres and offer a source-unit correction before Commit. Preserve source placement and offer a preview that fits the part on screen. Include a fixture made in an external CAD application. [STL parser](https://threejs.org/docs/pages/STLLoader.html) · [Wavefront OBJ format](https://www.loc.gov/preservation/digital/formats/fdd/fdd000507.shtml)

**Editing.** Build a canonical indexed mesh in a worker. Validate finite coordinates, face indices, orientation, closure and positive volume before enabling Commit. On an open or invalid mesh, explain the repair needed and preserve the scene. Accepted parts support Select, planar Move, uniform Scale, Union, Subtract and Undo. The original CAD sketches and feature history are absent from mesh files. Subsequent Palmivo edits belong to the reopened project's recipe history.

**Persistence and resources.** Add an import AST node and a version 3 mesh recipe referencing a content ID. Store vertex/index data once per asset, share immutable buffers across Undo snapshots, keep assets needed by nested Booleans, and register them again after a geometry-worker restart. Embed reachable assets once in portable JSON. Enforce the existing 8 MiB project budget against the encoded file and propose initial import caps of 8 MiB input and 50,000 triangles per part. Validate those caps on the laptop, including cumulative project size and decoder memory. A failed, cancelled or stale import must leave selection, history and autosave usable. Inspect aloud has a separate 1 MiB STL upload ceiling.

**Output.** Offer STL and OBJ for the selected committed solid. Both writers use the same indexed geometry with world transforms applied exactly once. Write binary millimetre STL and triangle-based OBJ with one-based indices and a millimetre comment. JSON remains the scene exchange format. Imports and exports work with Wi-Fi off. [Current STL writer](../src/core/stlExport.ts) · [Project reader](../src/core/projectFile.ts)

## Release sequence and proof

1. Capture the gesture baseline on the current release. Tune on practice attempts, freeze the candidate and run the held-out session. Keep the last passing gesture settings available for the stage laptop.
2. Agree on version 3 once for both new recipes and imported assets. Implement the three shapes, then the shared export geometry and OBJ writer. Validate one exported file immediately in an independent viewer.
3. Implement STL import first and polygonal OBJ second. Exercise malformed, open, oversized and multi-group inputs, Cancel, worker failure, autosave reload, Undo and old project files. Check the new limits with a near-limit part as well as the small demo fixtures.
4. Rehearse a single engineering task in both directions. Import the **20 × 20 × 40 mm** flanged bushing from STL, scale to **1.1×**, export OBJ and reopen it in a clean local workspace. Confirm **22 × 22 × 44 mm** bounds and an open centre passage independently. Then import a closed external OBJ, subtract a conical recess, Undo and redo the edit through a new draft, save and reopen JSON, and audit the final STL. Check offline interaction and one hosted Inspect aloud on an eligible part using available credits.
5. Record per-class attempt counts, observed p95 timings, geometry checks and the tested commit. Package the portable build and promote the same tested commit on Render. Where a gate fails, retain the last verified release and record the specific outstanding case.
