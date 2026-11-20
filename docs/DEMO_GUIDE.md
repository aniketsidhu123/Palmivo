# Palmivo workbench guide

Open the [hosted app](https://palmivo.onrender.com/) or start the local build. **Try the bushing** opens the example with the camera off. Example edits stay in the workspace until you export them. Your existing autosave stays available on reload.

## Camera and gesture controls

Choose **Use my camera**, allow browser camera access, and select the pointer hand. Calibrate your comfortable range. In Pinch mode, complete the pinch-release cycles and check that opening your other hand arms the toolbar. Practice on **Test click**. Use steady frontal lighting and keep the hands in view.

| Mode | Activate controls | Move and scale |
| --- | --- | --- |
| Pinch | Open the other palm, hover until ready, then make a fresh pinch | Pinch-drag along XY or pinch both hands and change their separation |
| Dwell assist | Keep the other palm open and hold the pointer over the control | Use continuous gestures or precise adjustment buttons |
| One-hand dwell | Hold the pointer over the control | Use 1 mm XY steps and 0.1× scale steps |

Dwell takes 900 ms for ordinary controls and 1,200 ms for Commit. Move off the controls to rearm. Releasing a pinch holds the preview. Choose **Commit** to apply it or **Cancel** to discard it. For the three optional pretrained shortcuts, see [model setup](MODELS.md#verify-shortcuts).

| Action | Keyboard |
| --- | --- |
| Box / Cylinder | `B` / `C` |
| Select, Move, Scale | `V`, `M`, `S` |
| Union / Subtract | `U` / `D`, then select the second solid |
| Adjust scale | `+` / `-` during a Scale draft |
| Commit / Cancel | `Enter` / `Escape` in the workspace |
| Undo | `Ctrl+Z` |
| Pause / Resume | `Space` in the workspace |

## Build a flanged guide bushing

1. Create the default **20 × 20 × 20 mm** Box at the origin and Commit.
2. Create a centered Cylinder with **radius 8 mm** and **height 40 mm**. Commit it.
3. Select the box, choose **Union**, and select the cylinder as the second operand. Review the AST and Commit.
4. Create and commit a centered Cylinder with **radius 3 mm** and **height 60 mm**. Select the joined solid as the target, choose **Subtract**, select the new cylinder as the cutter, and Commit.
5. Check the **20 × 20 × 40 mm** final size and the open centre passage. Select solids from the scene list when one obscures another.

Choose **Scale → +0.1× → Commit** to create a **22 × 22 × 44 mm** version. In the hosted app, **Inspect aloud** shows verified mesh findings and reads them using ElevenLabs. [Hosted verification](INSPECT_ALOUD.md#verify-the-hosted-workbench)

Box X, Y, and Z each accept **20, 30, or 40 mm**. Cylinder radius accepts **3, 5, or 8 mm**, and height accepts **20, 40, or 60 mm**. Uniform scale ranges from **0.5× to 2.0×**. CAD coordinates use illustrative millimetres.

## Save, reopen, and export

- **Export project** saves editable recipes, transforms, and command history as JSON. **Open project** accepts Palmivo v1 and v2 JSON up to 8 MiB and restores a project after its geometry successfully rebuilds. A new Undo history begins after opening.
- **Export STL** saves a selected committed solid with its position and scale applied. Choose millimetres in the receiving viewer or slicer. Keep the JSON for editable history.
- **Snapshot** saves the CAD viewport as PNG. **Record demo** records the viewport and AST as WebM. Use a screen recorder with system audio to capture live Inspect aloud playback.
- **Export result** saves a completed performance benchmark. [Measurement guide](benchmarks/README.md)

To verify offline operation, disconnect Wi-Fi and reload the portable localhost app. Open the example, scale or edit a solid, export the STL and project JSON, and reopen the JSON. The [example files](../examples/README.md) include the verified guide bushing and its editable recipe.
