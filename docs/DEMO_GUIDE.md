# Presenter guide

## Before the session

1. Extract the complete portable release on the demonstration laptop.
2. Launch `start-demo.cmd`; open the localhost URL in Chrome or Edge.
3. Connect power, close other GPU-heavy applications, and position a fixed frontal webcam.
4. Use diffuse light with the hands fully visible. Avoid backlighting and hands leaving the frame.
5. Wait for local assets to verify. Enable the camera and complete calibration.
6. Confirm the selected pointer hand and mirrored cursor direction.
   Use Easier sensitivity and 350 ms hover. Register three fresh pinches on Test click before starting. If pinch selection is still difficult, select Dwell assist and rehearse its deliberate holds instead.
7. Reset twice within three seconds for an empty workspace.
8. Complete a rehearsal with the exact laptop, camera, browser, lighting, and display arrangement.

Browser camera permission needs an ordinary click during setup. It does not have to be part of the hands-free demonstration.

This Prototype 05 release targets submission on **November 16, 2026 evening**. It adds STL export and final mesh dimensions. Rehearse the fixed sequence below first; use the precise-size variation only after the default sequence is reliable. Frontend polish remains the next session's focus.

## Fixed demonstration sequence

Aim for two to three minutes. Use slow, deliberate gestures and release pinches fully between tool activations.

| Step | Action | What to show |
| --- | --- | --- |
| 1 | State the current backend | “This prototype uses local MediaPipe hand tracking and temporal gesture rules.” |
| 2 | Show local assets ready, then disconnect Wi-Fi | The app continues operating from localhost |
| 3 | Choose Box, then Commit | A real 20 mm solid and a Create AST |
| 4 | Choose Scale, pinch both hands, spread to approximately 1.4×, release, Commit | Continuous two-hand spatial control and a numeric Scale AST |
| 5 | Choose Cylinder, then Commit | A second solid centered through the box |
| 6 | Select the box in the scene list, then choose Subtract | The box is explicitly the Target |
| 7 | Select the cylinder as Cutter | A readable Target − Cutter draft |
| 8 | Choose Commit | Real Boolean geometry, visible through-hole, committed Subtract AST |
| 9 | Choose Undo | Both source solids return |
| 10 | Select the box, choose Move, drag, then Cancel | Reversible previews preserve the committed state |

When the cylinder is occluded by the box, select its scene-list entry rather than trying to reach an obscured surface. During a draft, finish or cancel it before choosing another operation.

Optionally insert an export after step 8 and before Undo: show the selected result's **FINAL SIZE**, activate **Export STL**, and open the downloaded file in the prepared viewer or slicer. This demonstrates a reusable surface model created through the gesture workflow. Keep the stage sequence short by preparing the viewer before presenting.

## Precise-size variation

The default demo above is unchanged. To show the new presets in a second pass:

1. Choose **Box**. In **Precise size**, keep **X 20**, choose **Y 30**, and choose **Z 40**. Use the normal open-other-hand, hover, fresh-pinch gesture, or click the buttons. Dwell assist also works on these controls.
2. Verify **20 × 30 × 40 mm** and the exact `[20, 30, 40]` dimensions in the draft Create AST. Commit the box.
3. Choose **Scale**, use both hands to reach approximately **1.4×**, release to freeze, then Commit. At exactly 1.4×, the inspector's **FINAL SIZE** is **28 × 42 × 56 mm**. The **PREVIEW SIZE** label distinguishes unfinished Move/Scale changes from committed dimensions.
4. Choose **Cylinder**, choose **Radius 3**, and leave **Height 60**. Confirm **R 3 × H 60 mm** and `[3, 60]` in its draft AST, then Commit.
5. Select the box as Target, choose Subtract, choose the cylinder as Cutter, and Commit. The centered 60 mm cylinder extends through the box's 56 mm Z depth at exactly 1.4×.
6. Show the subtraction AST and the resulting **FINAL SIZE**. Optionally activate **Export STL** before Undo. While choosing operands, **TARGET SIZE** refers to the existing target, not a guessed Boolean result.
7. Choose Undo. Try a different preset during another creation draft, then Cancel to show that a size change remains a preview until committed.

Box X, Y, and Z can each be set independently to **20, 30, or 40 mm**. Cylinder radius supports **3, 5, or 8 mm** and height supports **20, 40, or 60 mm**. Presets set base dimensions; uniform scaling multiplies them afterward. These are illustrative CAD units, not dimensions measured from the webcam.

## Export a usable surface model

Select a committed solid and verify its name and **FINAL SIZE** in the inspector. Activate **Export STL** with the existing open-other-hand, hover, fresh-pinch action, Dwell assist, or a normal mouse click. A focused Export STL button also supports **Enter** or **Space**. Export is disabled with no selection, during drafts or geometry jobs, and while editing is paused.

The binary STL includes the selected solid's committed position and scale. It omits the scene grid, outlines, previews, and removed cutters. The export does not modify the scene or consume Undo history.

STL stores unitless surface coordinates. SignToAST writes millimetre values, so choose **mm** in the receiving tool and confirm the expected dimensions. Prepare print settings in the slicer. Keep the SignToAST **project JSON** for editable recipes, transforms, and AST history, because STL stores the surface without that information or colors.

The included `examples/scaled-box-mm.stl` is **28 × 42 × 56 mm**. `examples/through-hole-mm.stl` retains the centered radius 3 mm through-hole after subtraction. Both come from actual browser downloads and pass the separate binary-file checks. The source-only **http://127.0.0.1:5173/qa/stl.html** viewer uses STLLoader to inspect a chosen STL independently of the app's scene. `qa/verify_stl.py` checks dimensions, normals, surface closure/winding, and the centered bore using Python's standard library.

## Reopen an exported project

This is a setup and recovery workflow using an ordinary mouse click and the system file picker. It works with the camera off and with Wi-Fi disabled.

1. Export the current committed project if you want to keep it separately. Commit or Cancel any active preview before opening another file.
2. Click **Open project** and choose a locally exported **version 1 SignToAST JSON** file, no larger than **8 MiB**. The supplied example project can also be used.
3. Review the filename and the solid/command counts. **Keep current scene** or **Escape** cancels. **Open saved project** replaces the current workspace after the geometry rebuild succeeds.
4. Inspect the restored solids, transforms, and committed AST. Camera calibration stays the same. The opened project is autosaved locally and can be exported again.
5. Make a new edit and use Undo to verify it. The prior exported command log remains visible in the file, while Undo snapshots start with edits made after opening; pre-open Undo history is not restored.

Gesture editing is suspended while the picker and replacement review are open. Cancelling, rejecting an invalid file, or a failed geometry rebuild leaves the current committed scene intact. Finish a draft or wait for geometry execution if **Open project** is disabled. Arbitrary meshes, CAD scripts, and other file formats are outside this workflow.

## Gesture reminders

- Open the other hand to arm toolbar controls.
- Hover over the desired button before pinching.
- A fresh pinch edge activates the button. A held pinch dragged onto it does nothing.
- Wait for the hover progress bar to fill. Target capture tolerates small cursor shifts while closing the pinch.
- In optional Dwell assist, hold the pointer steady with thumb/index separated for 0.9 seconds (Commit: 1.2 seconds), then move off all buttons to rearm.
- Releasing a manipulation freezes its preview.
- Commit and Cancel are explicit controls.
- Both hands must remain tracked for gesture editing.
- When tracking pauses, release both pinches and show both hands until tracking stabilizes.

## Keyboard recovery

| Key | Action |
| --- | --- |
| B / C | Box / Cylinder |
| V | Select |
| M | Move, then mouse drag |
| S | Scale, then mouse wheel or + / − |
| D | Subtract, then choose cutter |
| Enter | Commit |
| Escape | Cancel draft |
| Space | Pause / resume |
| Ctrl+Z | Undo |
| Enter / Space on focused Export STL | Download the selected committed surface |

Use recovery controls openly if needed. They invoke the same controller and AST pipeline.

## Offline proof

Before stage time, disable Wi-Fi and reload the production URL. Confirm that the app verifies assets, restores its scene, enables the camera, performs subtraction, and exports JSON and STL. Reopen the exported project JSON, confirm its saved dimensions and transforms, and export its selected solid as STL again. Reload once more to verify local autosave. A page that merely keeps running after disconnection is weaker evidence than a successful fresh reload.

Local-asset readiness means the packaged files passed checks. It is not a network monitor. Do not describe that badge alone as proof that Wi-Fi is disabled.

## Recording and submission

Record the actual app with the hand preview, AST panel, and diagnostics visible. Capture a complete successful sequence, including the subtraction result and Undo. Keep a backup recording available if the venue's camera or projection setup changes.

Include the runnable folder, source/lockfile, example project and STL files, README, and measured performance export with the recording. Record demo captures the CAD canvas and AST locally, excluding webcam pixels and microphone audio. Use your normal screen recorder when you want the entire interface and hand preview in the final presenter demonstration.

State the implemented scope accurately: a constrained gesture-operated spatial compiler with real CAD execution. ST-GCN + CTC, general sign-language translation, and arbitrary viewpoint invariance are planned extensions. Any latency claim must name the measured stage and hardware.

