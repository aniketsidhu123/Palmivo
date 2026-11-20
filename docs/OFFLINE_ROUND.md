# Palmivo hybrid release

The portable hybrid build serves the CAD workspace on `http://127.0.0.1:4181/`. Run `start-demo.cmd` from its extracted folder and keep the console open. The submitted portable release remains on port 4173. Each port has independent calibration and autosaved project storage.

## Build a flanged guide bushing

1. Create and commit the default 20 mm box.
2. Create and commit a radius 8 mm, height 40 mm cylinder. Keep both solids centered.
3. Select the box, choose **Union**, select the cylinder, inspect the AST, and Commit.
4. Create and commit a radius 3 mm, height 60 mm cylinder. Select the joined solid, choose **Subtract**, select the new cylinder as Cutter, and Commit.
5. Show the 6 mm open bore and **20 × 20 × 40 mm** final size. Export STL or reopen the editable project example.

The example files are in `examples/`. An independent mesh audit found 400 triangles, a closed and consistently wound surface, and zero intersections through the bore center.

## Try the pretrained gesture shortcuts

Enable the camera and finish calibration. Choose **Listen for tool** above the viewport and relax your pointer hand briefly. Start the motion when the toolbar says **Make a shortcut**. Keep the motion near the center of the camera. Swipe directions refer to the mirrored preview. Pause briefly on thumbs up so the model sees a stable pose.

| Gesture | Opens |
| --- | --- |
| Swipe left | Box draft |
| Swipe right | Cylinder draft |
| Thumbs up | Union draft when a solid is selected and a second solid is available |

Listening opens at most one draft. A swipe can survive one weak or neutral model frame when its direction remains consistent. Thumbs up needs three consecutive confident predictions. Use swipe left for the box, swipe right for each cylinder, and thumbs up after selecting the box as the first Union solid. Set dimensions, choose operands, and Commit with the regular controls. The palette also provides all four modelling tools for the bushing. Rearm listening before each shortcut.

For an offline rehearsal, disconnect Wi-Fi, reload the workspace, enable the camera, and build the bushing above. Try a few normal hand movements while listening, then test each supported shortcut. Verify that preview, operand selection, Commit, and STL export work with your stage lighting and camera position.

## Train a custom presenter model

Open **Learned gesture pilot → Open gesture capture**. Keep one recording tab open at a time. For each split, agree to local capture, start the camera, select the pointer hand and split, then record the 30 prompted clips. After exporting the training set, reload the capture page to create a new session ID for validation. Start another fresh session for the held-out test set after the model and thresholds are fixed. Use the prompt to guide the motion. A helper can use **J** to mark gesture ends, or the presenter can adjust annotations using the wrist trace after a clip.

Store exports privately in `ml/data/`. The collector exports feature vectors and labels. It keeps camera video in the local preview. Shoulder inputs are optional. For a comparison, capture shoulders in each session and train the hands-only variant from the same recordings with the three shoulder channels masked.

Follow [training and export](../ml/README.md) in the source bundle. Test the selected model on genuinely held-out clips. Copy its `manifest.json` and `gesture.onnx` into `public/learned/` before rebuilding. Load the private parity clip via **Replay parity clip**. Show the expected, desktop, and browser transcripts. An optional **Measure learned model** mode runs inference alongside the gesture rules and counts stable tokens without opening drafts.

Only enable `liveApproved` in a custom presenter model manifest after at least 90% exact held-out accuracy across 20 positive clips, browser parity, five minutes of armed background activity with zero unintended suggestions, and three complete physical bushing rehearsals. Review its drafts and Commit through the existing palette.

## Compare performance

To measure MIT TSM, start **Run 23 s benchmark** with the camera active. Once the panel shows **Measuring**, arm **Listen for tool** and try the shortcuts. Rearm between attempts and let the timer finish. **Export result** records how many seconds TSM actually listened, how many predictions were timed, p50/p95 inference and frame round-trip latency, and camera, tracking, and render FPS while listening. Run another sample with listening off for the palette baseline.

The two November 19 rehearsal exports measured 29.65 and 29.80 camera FPS, 29.65 and 29.75 tracking FPS, and 60.00 render FPS in both windows. Both exports captured rules-mode observations with zero TSM predictions. Use a new export with nonzero listening time and timed predictions for live TSM timing.

The November 20 Wi-Fi-off presenter run recorded two TSM intervals totalling 5.20 seconds. The 20-second window delivered 29.55 camera, 28.45 tracking and 59.85 render FPS. During listening those rates were 29.43, 28.85 and 59.82 FPS. The 74 timed predictions yielded 36.36 / 40.06 ms inference and 41.60 / 45.81 ms frame round trip at p50 / p95. This is a per-frame timing sample. Use a labelled attempt tally for shortcut accuracy and a separate recording for gesture-end-to-draft delay.

For comparisons with the custom presenter model:

1. Use the camera-only probe at `/qa/camera-probe.html` on the Vite development server. Match the intended resolution, lighting, and camera. Stop the probe and close its tab before measuring Palmivo.
2. Open the same bushing scene at the same browser size. Run and export three **Performance check** trials in Gesture rules mode. Repeat in **Measure learned model** mode with similar recorded movements in the same working area. Each trial includes 3 seconds of warm-up and a fixed 20-second sample.
3. From the source bundle, run `node scripts/compare-benchmarks.mjs rules1.json rules2.json rules3.json hybrid1.json hybrid2.json hybrid3.json`. Use each trial's actual filename. Review coverage, capture rate, tracking, rendering, skipped tracking samples, and the per-stage timings together.
4. Disconnect Wi-Fi, reload the portable release, and run the chosen demo flow continuously for ten minutes. Record the camera, measured rates, and actual mode for the pitch.

The preserved pre-hybrid observations were 15.13 raw camera FPS and 15.08 tracking FPS. Use the observed measurements and input coverage from the actual trial when reporting performance.

## Package

From the source workspace, run `pnpm build`, `node scripts/package.mjs --candidate`, then `scripts/archive.ps1 -Candidate` in PowerShell. The candidate Windows and source archives and their checksums go into `release/`. The source archive includes the training scripts and pinned requirements. Keep presenter recordings and tagged replay clips private.

### MIT TSM asset provenance

The portable and source packages include the verified model at `dist/tsm/mit-tsm-jester-streaming.onnx` and `public/tsm/mit-tsm-jester-streaming.onnx`, respectively. The build stages the local export from `ml/artifacts/pretrained-evaluation/` when the prepared public copy is absent. Package verification checks the 9,012,233-byte export against the SHA-256 below. All inference assets load from the local Palmivo server.

- [Official MobileNetV2 Online TSM Jester weights](https://hanlab18.mit.edu/projects/tsm/models/mobilenetv2_jester_online.pth.tar) · SHA-256 `da56d12597699a34c51834d059669679049cd9d530876279259a1eed8bb34688`.
- [Reference architecture](https://github.com/mit-han-lab/temporal-shift-module/blob/master/online_demo/mobilenet_v2_tsm.py) · Source SHA-256 `c0ddbc356368e69b8048653fdbf86a9f393f58905d5e1b3013db963506f7e35`.
- FP32 ONNX opset 17 export · SHA-256 `e4142cece680362eec7b5ce2571bc7b763b841830942b30c51cb9b21ccfd1ebb`. Its input is a 224 × 224 frame and ten recurrent caches. It returns 27 logits and the next caches.

## Candidate verification

A fresh production browser session completed Box → Cylinder → Union → Cylinder → Subtract both through the regular palette and through injected TSM predictions at the shortcut boundary. Both paths verified the Boolean ASTs and downloaded and reopened the version 2 project. The independent STL audit confirmed 400 triangles, 20 × 20 × 40 mm bounds, 10,871.7294 mm³ signed volume, and an open bore. The browser blocked external network access and observed zero attempted external HTTP requests. Model load and inference failure both returned the workspace to palette controls.

The pretrained model has 2,258,459 parameters. The FP32 export matched PyTorch logits and caches across 12 streaming steps. The bundled worker returned 27 finite logits for each of 14 synthetic image frames and reproduced its first output after a cache reset. A live webcam rehearsal is needed to measure gesture accuracy and overall responsiveness.

The tuned candidate repeated the full bushing workflow in network-restricted Chrome. A separate fixed-window test used a synthetic camera stream with the real TSM worker. It recorded two listening intervals totalling 4.72 seconds and 46 predictions, with 58.28 / 66.47 ms inference and 66.06 / 75.58 ms frame round trip at p50 / p95. A second run with listening off recorded zero TSM predictions. These checks verify benchmark attribution and packaged execution.
