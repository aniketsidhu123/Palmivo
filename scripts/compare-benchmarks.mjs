import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
if (args.length !== 6) {
  console.error('Usage: node scripts/compare-benchmarks.mjs rules1.json rules2.json rules3.json hybrid1.json hybrid2.json hybrid3.json');
  process.exit(1);
}

const runs = await Promise.all(args.map(async (file, index) => {
  const run = JSON.parse(await readFile(file, 'utf8'));
  const expected = index < 3 ? 'rules' : 'shadow';
  const { metadata, metrics } = run;
  if (run.schemaVersion !== 1 || run.warmupMs !== 3000 || run.durationMs !== 20000 ||
      metadata?.recognition !== expected || !metrics?.camera_delivered_frame?.samples ||
      !metrics.landmark_ms?.samples || !metrics.render_frame_ms?.samples ||
      !metrics.gesture_ready?.mean || metrics.document_visible?.min !== 1 ||
      (expected === 'shadow' && !metrics.onnx_inference_ms?.samples)) {
    throw new Error(`Use a completed, foreground ${expected} run with camera, hand-control and applicable inference samples: ${file}`);
  }
  return run;
}));

const comparable = ({ metadata }) => JSON.stringify([
  metadata.backend, metadata.inputMode, metadata.pointerHand, metadata.cameraInfo?.settings,
]);
if (runs.some(run => comparable(run) !== comparable(runs[0]))) {
  throw new Error('Match the tracking backend, input settings, pointer hand, and camera configuration across trials.');
}
if (new Set(runs.map(run => run.metadata.startedAt)).size !== runs.length) throw new Error('Supply six distinct runs.');

const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
};
const round = number => Number(number.toFixed(3));
function summarize(trials) {
  const rows = trials.map(({ metrics: m, durationMs }) => {
    const seconds = durationMs / 1000;
    const delivered = m.camera_delivered_frame.samples;
    return {
      cameraFPS: round(delivered / seconds),
      trackingFPS: round(m.landmark_ms.samples / seconds),
      renderFPS: round(m.render_frame_ms.samples / seconds),
      droppedTrackingPercent: round((m.tracking_dropped_frame?.samples ?? 0) * 100 / delivered),
      controlReadyPercent: round(m.gesture_ready.mean * 100),
      landmarksP95Ms: m.landmark_ms.p95,
      poseP95Ms: m.pose_ms?.p95 ?? null,
      onnxP95Ms: m.onnx_inference_ms?.p95 ?? null,
      ctcP95Ms: m.ctc_decoder_ms?.p95 ?? null,
      modelSamples: m.onnx_inference_ms?.samples ?? 0,
    };
  });
  return {
    trials: rows,
    median: Object.fromEntries(Object.keys(rows[0]).map(key => [key, median(rows.map(row => row[key]))])),
  };
}
const rules = summarize(runs.slice(0, 3));
const hybrid = summarize(runs.slice(3));
const relativeTrackingPercent = round(hybrid.median.trackingFPS * 100 / rules.median.trackingFPS);
console.log(JSON.stringify({
  settings: runs[0].metadata.cameraInfo?.settings,
  rules, hybrid, relativeTrackingPercent,
  targets: { render55Fps: hybrid.median.renderFPS >= 55, retained90PercentTracking: relativeTrackingPercent >= 90 },
}, null, 2));
