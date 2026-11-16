# Developer QA tools

Run `pnpm dev` and open the corresponding path on the Vite localhost server.

| Path / tool | Purpose |
| --- | --- |
| `/qa/appearance.html` | Real geometry with explicitly simulated gesture feedback states and preview resource checks |
| `/qa/polish.html` | Instruction, scaling, and preview-scheduling regression fixture |
| `/qa/stl.html` | Separate Three.js STLLoader viewer for exported surface geometry |
| `/qa/camera-probe.html` | Camera-only frame-delivery diagnostics, settings, and supported capture modes |
| `verify_stl.py` | Python standard-library audit of binary STL layout and solid geometry |
| `invalid-project.json` | Project-opening rejection fixture |
| `logs/` | Generated local server logs, excluded from Git and distributions |

Fixtures stay outside the production application entry point. The appearance fixtures label simulated tracking and do not use the webcam.

The camera probe starts capture only after a button activation. The optional exposure experiment restores the original exposure mode before releasing the camera. Use **Stop & restore exposure** and wait for its completion before closing that diagnostic.

Example independent STL audit:

~~~sh
python qa/verify_stl.py examples/through-hole-mm.stl --dimensions 28 42 56 --through-hole
~~~

Application tests stay beside their modules in `src/`; full-flow tests live in `src/integration/` and `src/tracking/oneHand.integration.test.ts`.
