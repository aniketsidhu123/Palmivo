# Learned-recognition roadmap

The current release validates the local interaction, spatial parameters, AST compiler, and CAD executor. A learned recognizer can replace the temporal rule front end while retaining the same draft and execution interfaces.

## 1. Continuous domain dataset

Define a small CAD gesture vocabulary with fluent signer involvement if natural sign-language compatibility becomes a goal. Do not label a purpose-built gesture vocabulary as a general natural sign language.

Collect an initial 2,400 genuine continuous sequences: twelve participants, two sessions per participant, one hundred sequences per session. Split participants into eight training, two validation, and two test participants before creating windows. Add background/rest activity, incomplete commands, speed variation, co-articulation, repeated tokens, two-hand crossings, and occlusion.

Save timestamps, landmark masks, token transcripts, intended ASTs, spatial roles, camera conditions, recording permissions, and annotation versions. Annotate gesture boundaries in evaluation clips to measure post-gesture delays. Keep raw recordings local unless participants explicitly authorize another use.

## 2. Skeletal feature pipeline

Introduce upper-body tracking and torso-relative global features. Preserve hand-local shape, inter-hand relations, motion, validity masks, and elapsed time as distinct features. Hand-centered world coordinates and hip-centered pose coordinates do not automatically form one metric skeleton.

Evaluate normalization for translation, scale, and moderate camera changes. Arbitrary camera-angle invariance needs evidence from held-out recordings. Add facial features only when the vocabulary has annotated nonmanual distinctions that require them.

## 3. Causal ST-GCN

Begin with five causal temporal graph blocks, kernel size three, dilations 1/2/4/8/16, channels 32/32/64/64/96, and temporal stride one. Pool nodes while preserving per-time-step token outputs. Expose temporal caches as explicit inputs/outputs for streaming export.

The [original ST-GCN](https://arxiv.org/abs/1801.07455) is an action-recognition backbone. The per-frame causal sign/token adaptation requires development and evaluation.

## 4. Streaming CTC and spatial binding

Train a full-sequence CTC reference, establish greedy-decoder correctness, and then add a persistent grammar-constrained prefix beam of width five. Keep decoder state across chunks and distinguish provisional from stable prefixes.

[CTC](https://www.cs.toronto.edu/~graves/icml_2006.pdf) provides monotonic sequence alignment. It does not by itself resolve object references or numeric CAD parameters. Preserve a parallel timestamped spatial channel and initially keep explicit Commit. Test repeated labels, long blanks, tracking gaps, provisional corrections, and no duplicate execution across chunk boundaries.

## 5. Browser export and optimization

Train in PyTorch and export an FP32 ONNX reference. Compare logits and decoded commands with desktop ONNX and browser output on frozen clips. Benchmark FP16 WebGPU and INT8 WASM separately against the same accuracy set.

Do not assume quantization improves GPU speed. Validate the exact graph and operator placement against the pinned [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) version. Warm-up, readback, worker transfers, and CPU fallback all belong in the measured runtime budget.

## 6. Promotion gates

Report token error rate, exact command accuracy, AST correctness, object-reference accuracy, parameter error, false executable commands per hour, task success, and post-gesture stabilization/commit delay. Separate enrolled-presenter results from held-out-user results.

Promote the learned backend only after it passes the existing transaction, recovery, offline, and CAD acceptance scenarios. A sub-15 ms post-landmark inference/compiler target is a separate requirement from 60 FPS rendering, camera delivery, and full motion-to-action latency.

