# Inspect aloud

Palmivo’s hosted workbench sends a selected solid’s binary STL and scene revision to a Render Workflow after the user chooses **Inspect aloud**. The Workflow independently measures the exported mesh and checks surface closure and the central Z passage. ElevenLabs receives the short inspection caption and returns playable speech. Camera input, landmark computation, and project edits run in the browser.

## Deploy on Render

Use the `codex/inspect-aloud` branch in the Palmivo repository. In the Render Dashboard choose **New → Blueprint**, select the branch, and use the root `render.yaml`. The Blueprint creates the public **palmivo** web service and the **palmivo-inspection** Workflow in Singapore.

| Render resource | Variable | Value to enter in Render |
| --- | --- | --- |
| **palmivo** web service | `RENDER_API_KEY` | An API key for the same Render workspace, with permission to start and read Workflow runs. |
| **palmivo-inspection** Workflow | `ELEVENLABS_API_KEY` | A Text to Speech key from ElevenLabs with a credit quota set for the demo. |
| **palmivo-inspection** Workflow | `ELEVENLABS_VOICE_ID` | The ID of an English voice accessible to that ElevenLabs account. Copy the ID from **Voices**. |

Render generates `PALMIVO_INSPECT_SECRET` and sets `PALMIVO_WORKFLOW_SLUG` from the Workflow resource. Enter credentials directly in Render. Confirm that your workspace has enough applicable Render credits for Workflow compute and temporary state before enabling inspection. The web service uses the free instance plan and the Workflow uses metered `flex` compute.

[Render Blueprints](https://render.com/docs/infrastructure-as-code) · [Render Workflow billing](https://render.com/docs/workflows-limits) · [ElevenLabs API key restrictions](https://elevenlabs.io/docs/api-reference/authentication)

### Verify and record the hosted demo

1. Copy the web service’s public HTTPS URL from the Render Dashboard. Open it in a fresh browser or on a second device.
2. Choose **Try the bushing** and select the result. Choose **Inspect aloud**. Check the **20 × 20 × 40 mm** caption, hear the voice, and match the run ID to the completed Workflow in Render.
3. Select **Scale**, increase the scale by **0.1×**, and **Commit**. Request another inspection. Verify **22 × 22 × 44 mm**, an open centre passage, and a new run ID. **Play again** reuses the received audio.
4. Verify **Use my camera**, one TSM shortcut, Commit, Undo, STL export, and project reopening. Confirm the portable version still opens and models offline.
5. Record a fresh hosted inspection with a screen recorder that captures system audio. Show the changed dimensions and completed Render run. Use the actual public app URL in the submission.

The inspection panel reports time from inspection request to result and, when speech starts automatically, to audio playback. Record those times separately from webcam and gesture benchmarks.

## Local verification

```sh
pnpm install --frozen-lockfile
pnpm build:hosted
pnpm test
node --test server/host.test.mjs
python -m pip install -r workflow/requirements.txt
python -m unittest workflow.test_inspection
```

`pnpm start` serves the portable workbench. `node server/host.mjs` serves the hosted build locally on port 10000 by default. An unconfigured host offers CAD and the bundled example. Workflow inputs and outputs are subject to Render’s 30-day run retention.
