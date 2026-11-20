# Benchmark and verification evidence

This directory contains exported measurements and independent verification reports. Screenshots and video remain in [../media/](../media/).

| File | Measurement or verification |
| --- | --- |
| [performance-before.json](performance-before.json) | GPU-worker processing baseline with 1,201 landmark/rules samples |
| [camera-delivery-before.json](camera-delivery-before.json) | Camera-only comparison of video callbacks and raw track delivery |
| [camera-delivery-minimum30.json](camera-delivery-minimum30.json) | Capture-rate preference experiment at the same resolution |
| [camera-exposure-capabilities.json](camera-exposure-capabilities.json) | Camera settings and advertised exposure controls |
| [camera-delivery-short-exposure.json](camera-delivery-short-exposure.json) | Short-exposure diagnostic with restoration of automatic exposure |
| [camera-measurements.json](camera-measurements.json) | Earlier camera/tracking session |
| [browser-measurements.json](browser-measurements.json) | Original browser CAD sequence measurements |
| [polish-measurements.json](polish-measurements.json) | Preview-update counters and browser timing sample |
| [prototype04-measurements.json](prototype04-measurements.json) | Precise-size and project reopening browser sample |
| [stl-verification.json](stl-verification.json) | Independent binary STL and solid-surface audit |
| [workbench-validation.json](workbench-validation.json) | Workbench browser and geometry verification record |

## Measurement definitions

- Camera delivery and processed tracking FPS describe different pipeline stages.
- `landmark_ms` measures the hand-tracking call.
- `rules_to_draft_ms` measures recognition and synchronous interaction handling.
- Geometry and command completion use separate asynchronous timings.
- Browser video-callback-to-handler timings begin after camera capture.
- Recorded exports retain their original sample counts and measurement method.

The application also supports a fresh benchmark with a three-second warm-up and fixed twenty-second measurement window. Its exports include input configuration, p50/p95, counts, hand-presence coverage, and control-ready coverage. Historical rolling samples and fixed-window exports remain distinct.

## Local MIT TSM sample

This sample used a 640 × 480 webcam with Wi-Fi disabled. The 20-second measurement recorded two active **Listen for tool** intervals totalling 5.20 seconds and 74 predictions.

| Window | Camera FPS | Tracking FPS | Render FPS |
| --- | ---: | ---: | ---: |
| Full benchmark | 29.55 | 28.45 | 59.85 |
| While listening | 29.43 | 28.85 | 59.82 |

TSM inference took **36.36 ms p50 / 40.06 ms p95**. The frame round trip took **41.60 ms p50 / 45.81 ms p95**. These are per-frame metrics. Measuring gesture accuracy or gesture-end-to-draft delay requires a labelled set of attempts.

To reproduce, enable the camera and start **Run 23 s benchmark**. After warm-up, use **Listen for tool** and rearm between shortcuts. Export the finished result and check the listening duration and timed prediction count. For a comparison, run the same scene and camera setup with listening off. Hosted inspection reports request-to-result and request-to-playback separately.
