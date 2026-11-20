import type { BenchmarkResult, BenchmarkStatus } from '../core/benchmark';
import type { CameraInfo } from '../tracking/client';

export function createPerformancePanel(host: HTMLElement) {
  const panel = document.createElement('section'); panel.className = 'performance-panel';
  panel.setAttribute('aria-label', 'Measured performance');
  panel.innerHTML = '<div class="section-heading"><h3>PERFORMANCE CHECK</h3><span>LOCAL / MEASURED</span></div><p id="camera-configuration">Enable camera to inspect its negotiated capture mode.</p><p id="capture-advice"></p><div class="benchmark-actions"><button id="benchmark-run" class="outline-button" disabled>Run 23 s benchmark</button><button id="benchmark-export" class="outline-button" disabled>Export result</button></div><p id="benchmark-status" role="status">3 s warm-up + 20 s sample. Use Listen for tool during the sample to include TSM.</p><div id="benchmark-results" hidden></div><small>Frame-processing timings exclude physical motion, exposure, and display latency.</small>';
  host.append(panel);
  const q = <T extends HTMLElement>(id: string) => panel.querySelector<T>(id)!;
  const runButton = q<HTMLButtonElement>('#benchmark-run');
  const exportButton = q<HTMLButtonElement>('#benchmark-export');
  return {
    runButton, exportButton,
    camera(info: CameraInfo | null, stats: { cameraFps: number; trackingFps: number }) {
      const settings = info?.settings;
      const rate = settings?.frameRate;
      q('#camera-configuration').textContent = settings ? [String(settings.width || '—') + ' × ' + String(settings.height || '—'), rate ? rate.toFixed(0) + ' FPS negotiated' : 'Rate not reported', info?.capabilities.frameRate?.max ? 'device max ' + info.capabilities.frameRate.max.toFixed(0) + ' FPS' : ''].filter(Boolean).join(' · ') : 'Enable camera to inspect its negotiated capture mode.';
      q('#capture-advice').textContent = stats.cameraFps > 0 && rate && stats.cameraFps < rate * .8 ? 'Capture is below the negotiated rate. Add frontal light and close other camera apps. A camera limited to 30 FPS cannot supply 60 unique frames/s.' : stats.cameraFps > 0 && stats.trackingFps < stats.cameraFps * .8 ? 'Inference is skipping stale frames to keep interaction responsive. Close GPU-heavy apps.' : info?.ratePreference === 'fallback' ? 'Higher capture rate was rejected. The camera is using its supported fallback.' : '';
    },
    status(status: BenchmarkStatus, result: BenchmarkResult | null, cameraActive: boolean) {
      const active = status.phase === 'warmup' || status.phase === 'recording';
      runButton.disabled = active || !cameraActive;
      runButton.textContent = active ? status.phase === 'warmup' ? 'Warming up…' : 'Measuring…' : 'Run 23 s benchmark';
      exportButton.disabled = !result;
      const summary = q('#benchmark-results'); summary.hidden = !result;
      if (active) q('#benchmark-status').textContent = (status.phase === 'warmup' ? 'Warm-up: ' : 'Measuring: ') + Math.ceil(status.remainingMs / 1000) + ' s remaining. Keep hands in view. Listen for tool can be used during the sample.';
      else if (result) {
        const metrics = result.metrics;
        const seconds = result.durationMs / 1000;
        const trackingRate = metrics.landmark_ms ? metrics.landmark_ms.samples / seconds : 0;
        const renderRate = metrics.render_frame_ms ? metrics.render_frame_ms.samples / seconds : 0;
        const cameraRate = (metrics.camera_delivered_frame?.samples ?? 0) / seconds;
        const rows = [['Tracking', trackingRate.toFixed(1) + ' FPS'], ['Rendering', renderRate.toFixed(1) + ' FPS'], ['Landmarks p95', metrics.landmark_ms ? metrics.landmark_ms.p95.toFixed(2) + ' ms' : 'No samples'], ['Rules → draft p95', metrics.rules_to_draft_ms ? metrics.rules_to_draft_ms.p95.toFixed(2) + ' ms' : 'No samples'], ['Video callback → handler p95', metrics.video_to_handler_ms ? metrics.video_to_handler_ms.p95.toFixed(2) + ' ms' : 'No samples'], ['Hands present', ((metrics.hands_present?.mean || 0) * 100).toFixed(0) + '%'], ['Control ready', ((metrics.gesture_ready?.mean || 0) * 100).toFixed(0) + '%']];
        rows.unshift(['Camera delivery', cameraRate.toFixed(1) + ' FPS']);
        rows.push(['Tracking frames skipped', String(metrics.tracking_dropped_frame?.samples ?? 0)]);
        const tsm = result.tsm;
        if (tsm.listeningMs > 0 || tsm.timedPredictions > 0) {
          const listeningSeconds = tsm.listeningMs / 1000;
          rows.push(['TSM listening', listeningSeconds.toFixed(2) + ' / ' + seconds.toFixed(0) + ' s']);
          rows.push(['TSM timed predictions', String(tsm.timedPredictions)]);
          if (listeningSeconds > 0) {
            rows.push(['Camera while listening', (tsm.cameraFrames / listeningSeconds).toFixed(1) + ' FPS']);
            rows.push(['Tracking while listening', (tsm.trackingFrames / listeningSeconds).toFixed(1) + ' FPS']);
            rows.push(['Rendering while listening', (tsm.renderFrames / listeningSeconds).toFixed(1) + ' FPS']);
          }
          if (metrics.tsm_inference_ms) rows.push(['TSM inference p50 / p95', metrics.tsm_inference_ms.p50.toFixed(2) + ' / ' + metrics.tsm_inference_ms.p95.toFixed(2) + ' ms']);
          if (metrics.tsm_round_trip_ms) rows.push(['TSM frame round trip p95', metrics.tsm_round_trip_ms.p95.toFixed(2) + ' ms']);
        }
        for (const [key, label] of [['pose_ms', 'Shoulders p95'], ['onnx_inference_ms', 'ONNX p95'], ['ctc_decoder_ms', 'CTC p95']]) {
          if (metrics[key]) rows.push([label, metrics[key].p95.toFixed(2) + ' ms']);
        }
        summary.replaceChildren(...rows.map(([label, value]) => { const row = document.createElement('div'); const name = document.createElement('span'), number = document.createElement('strong'); name.textContent = label; number.textContent = value; row.append(name, number); return row; }));
        q('#benchmark-status').textContent = !metrics.hands_present?.mean ? 'Complete. No hands were detected during the sample.' : !metrics.gesture_ready?.mean ? 'Complete. Hands appeared, but gesture controls never armed.' : metrics.document_visible?.min === 0 ? 'Complete. Some of the sample ran while the tab was in the background.' : tsm.listeningMs > 0 ? '20 s sample complete. Compare listening time, timed predictions, and hand coverage across runs.' : '20 s sample complete with no TSM listening time during measurement.';
      } else q('#benchmark-status').textContent = cameraActive ? '3 s warm-up + 20 s sample. Use Listen for tool during the sample to include TSM.' : 'Enable camera to run a fresh benchmark. Previous rolling timings remain separate.';
    },
  };
}
