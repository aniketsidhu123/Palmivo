# Palmivo learned gesture training

The pilot model recognizes three CAD tool tokens. A three-block causal ST-GCN applies convolution over the hand skeleton and over time. The history for each temporal layer is explicit in the exported FP32 ONNX graph. CTC aligns continuous input with Box, Cylinder, and Union transcripts. The learned recognizer suggests a draft through the same controller as the gesture palette, with a separate Commit action.

## Record three sessions

Open the local landmark recorder. Record 30 varied clips per session, with two or three consecutive tokens per positive clip and a handful of empty-transcript clips. Include repeated tokens, deliberate neutral transitions, partial gestures, and ordinary toolbar movement. Mark gesture end times for latency evaluation and optional frame guidance during training. Use a new session ID for each split and save recordings under `ml/data/`. Store local landmark recordings with the presenter's permission.

The recorder writes format `schemaVersion: 1`, `featureVersion: 1`. A feature row has 42 nodes × 13 channels. The pointer hand comes first, followed by the other hand. Each hand uses its native MediaPipe node order and carries image-space motion, hand-local shape and validity, and optional shoulder-relative position and pose validity. Train the hands-only variant by masking the last three feature channels. To compare shoulder features, enable pose for all recordings and reuse the training and validation files.

## Setup and train on Windows

Run from the repository root with Python 3.12. The venv supplies training only. The offline Palmivo launcher uses the frozen export and bundled browser runtime.

```powershell
python -m venv ml/.venv
& ml/.venv/Scripts/python.exe -m pip install torch==2.7.1+cpu --index-url https://download.pytorch.org/whl/cpu
& ml/.venv/Scripts/python.exe -m pip install -r ml/requirements.txt
& ml/.venv/Scripts/python.exe ml/pipeline.py fit --sessions ml/data/train.json ml/data/validation.json --output ml/artifacts/hands
```

For the optional shoulder comparison, add `--features hands+shoulders` and use a different output directory such as `ml/artifacts/shoulders`. Use the validation reports to choose a model. The held-out test stays out of all training, variant choice, and threshold tuning. The CPU wheel is the tested configuration. `--device cuda` requires a compatible PyTorch CUDA environment.

The output contains `gesture.pt`, `gesture.onnx`, `manifest.json`, and `fit-report.json`. The model inputs are `frame` `[1,42,13]`, and `state0` through `state2` `[1,32,42,2/4/8]`. Outputs are `logits` `[1,4]` in blank, Box, Cylinder, Union order and `next0` through `next2` matching their input states. Supply zero caches at each new sequence. The export checks full-sequence PyTorch, incremental PyTorch, and desktop ONNX parity including the temporal cache.

## Evaluate and replay

```powershell
& ml/.venv/Scripts/python.exe ml/pipeline.py evaluate --model ml/artifacts/hands --sessions ml/data/test.json
```

Specify `--parity-clip CLIP_ID` to produce `browser-parity.json` from an approved held-out clip for the browser playback tool. The report contains exact transcript counts, token error rate, stable transcript counts, false drafts on negative clips, marked-end-to-stable delay, and desktop inference timings. Browser inference still needs its own parity and timing run. The 90% exact transcript gate requires at least 20 distinct positive clips. The five-minute negative-activity check and physical bushing runs need to be measured with the presenter. The training command never authorizes live control.

For an isolated forward/backward and export test, run `& ml/.venv/Scripts/python.exe ml/test_pipeline.py`. Synthetic test tensors are used only for runtime verification inside temporary directories. Training explicitly requires presenter recordings and rejects clips and session IDs shared across splits.
