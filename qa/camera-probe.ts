import { downloadJSON } from '../src/metrics';

interface RawFrame { close(): void }
interface Processor { readable: ReadableStream<RawFrame> }
type ProcessorConstructor = new (options: { track: MediaStreamTrack }) => Processor;
const q = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const video = q<HTMLVideoElement>('#probe-video');
const status = q('#probe-status'), output = q('#probe-report');
let generation = 0, stream: MediaStream | null = null, rawTrack: MediaStreamTrack | null = null;
let reader: ReadableStreamDefaultReader<RawFrame> | null = null, callback: number | null = null;
let startedAt = 0, stoppedAt = 0, previousVideo = 0, previousRaw = 0, videoCount = 0, rawCount = 0;
let videoIntervals: number[] = [], rawIntervals: number[] = [];
let mode = 'off', rawState = 'not started';
let settings: Record<string, unknown> = {}, capabilities: Record<string, unknown> = {};
let cleanup: Promise<void> = Promise.resolve();
let exposureRestore: { track: MediaStreamTrack; constraints: MediaTrackConstraints; originalMode: string; originalTime: number } | null = null;
let exposureChange: Promise<void> | null = null;
let exposureExperiment: Record<string, unknown> = { requested: false, restoration: 'not needed' };
// Image Capture camera controls vary by browser/device. Inspect only an explicit
// allowlist; never collect device/group identifiers.
const cameraControls = ['exposureMode', 'exposureTime', 'exposureCompensation', 'brightness', 'iso', 'lowLightCompensation', 'torch'] as const;
function inspectControls(values: unknown): Record<string, unknown> {
  const input = values as Record<string, unknown>;
  return Object.fromEntries(cameraControls.flatMap<[string, unknown]>(key => {
    const value = input[key];
    if (typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)) return [[key, value]];
    if (Array.isArray(value) && value.every(item => typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item))) return [[key, value]];
    if (value && typeof value === 'object') {
      const range = value as Record<string, unknown>;
      return [[key, Object.fromEntries(['min', 'max', 'step'].flatMap(field => typeof range[field] === 'number' && Number.isFinite(range[field]) ? [[field, range[field]]] : []))]];
    }
    return [];
  }));
}
const warmupMs = 2000;
const summarize = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: sorted.length, p50: sorted[Math.floor((sorted.length - 1) * .5)] ?? null, p95: sorted[Math.floor((sorted.length - 1) * .95)] ?? null };
};
function report() {
  const elapsed = startedAt ? Math.max(0, (stoppedAt || performance.now()) - startedAt - warmupMs) : 0;
  return { mode, active: !!stream, warmupMs, measuredMs: elapsed, settings, capabilities, exposureExperiment, rawState, video: { frames: videoCount, fps: elapsed > 0 ? videoCount * 1000 / elapsed : 0, intervalsMs: summarize(videoIntervals) }, raw: { frames: rawCount, fps: elapsed > 0 ? rawCount * 1000 / elapsed : 0, intervalsMs: summarize(rawIntervals) }, notes: 'Camera delivery only; no landmarks, gesture inference or physical action latency. No video frames are retained. Stop restores the original exposure before releasing the camera.' };
}
function draw() { output.textContent = JSON.stringify(report(), null, 2); }
function stop(): Promise<void> {
  generation++; stoppedAt = performance.now();
  if (callback !== null && typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback(callback);
  callback = null; const cancelRead = reader?.cancel().catch(() => {}); reader = null;
  rawTrack?.stop(); rawTrack = null;
  const previousStream = stream, restore = exposureRestore, pendingExposure = exposureChange; stream = null; exposureRestore = null; exposureChange = null;
  video.pause(); video.srcObject = null;
  status.textContent = restore ? 'Stopping and restoring original camera exposure…' : 'Stopped. Report retained locally.';
  cleanup = cleanup.then(async () => {
    try {
      await cancelRead;
      await pendingExposure?.catch(() => {});
      if (restore) {
        await restore.track.applyConstraints(restore.constraints);
        const restored = inspectControls(restore.track.getSettings());
        exposureExperiment.restoredSettings = restored;
        if (restored.exposureMode !== restore.originalMode || restore.originalMode === 'manual' && Math.abs(Number(restored.exposureTime) - restore.originalTime) > .001) throw Error('Camera did not report its original exposure setting after restoration.');
        exposureExperiment.restoration = 'restored';
        status.textContent = 'Stopped. Original exposure restored. Report retained locally.';
      }
    } catch (error) {
      exposureExperiment.restoration = `restore failed: ${String(error)}`;
      status.textContent = 'Stopped; exposure restoration failed. Restart the camera in baseline mode before leaving.';
    } finally { previousStream?.getTracks().forEach(track => track.stop()); draw(); }
  });
  draw(); return cleanup;
}
async function start(minimum30: boolean, manualExposure = false) {
  const stopped = stop(), run = generation;
  await stopped;
  if (run !== generation) return;
  mode = minimum30 ? 'minimum-30' : 'baseline'; settings = {}; capabilities = {}; rawState = 'not started';
  exposureExperiment = { requested: manualExposure, restoration: 'not needed' };
  videoIntervals = []; rawIntervals = []; videoCount = 0; rawCount = 0; previousVideo = 0; previousRaw = 0;
  startedAt = 0; stoppedAt = 0; status.textContent = 'Requesting camera…';
  try {
    const source = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60, max: 60 }, facingMode: 'user' } });
    if (run !== generation) { source.getTracks().forEach(track => track.stop()); return; }
    stream = source;
    const track = source.getVideoTracks()[0];
    const c = track.getCapabilities?.() ?? {};
    capabilities = { frameRate: c.frameRate, width: c.width, height: c.height, ...inspectControls(c) };
    if (minimum30 && (c.frameRate?.max ?? 60) >= 30) {
      try { const max = Math.min(60, c.frameRate?.max ?? 60), previous = track.getSettings(); await track.applyConstraints({ width: { exact: previous.width ?? 640 }, height: { exact: previous.height ?? 480 }, frameRate: { min: 30, ideal: max, max }, facingMode: 'user' }); mode += ' applied'; }
      catch { mode += ' rejected; baseline retained'; }
    }
    if (run !== generation) return;
    if (manualExposure) {
      const controls = inspectControls(c), previous = track.getSettings();
      const previousControls = inspectControls(previous), range = controls.exposureTime as { min?: number; max?: number } | undefined;
      const requestedExposure = 156.25; // 15.625 ms; W3C exposureTime uses 100 microsecond units.
      if (!Array.isArray(controls.exposureMode) || !controls.exposureMode.includes('manual') || !range || requestedExposure < (range.min ?? Infinity) || requestedExposure > (range.max ?? -Infinity)) throw Error('This camera does not advertise the required manual exposure capability. No exposure change was made.');
      if (typeof previousControls.exposureMode !== 'string' || typeof previousControls.exposureTime !== 'number') throw Error('Original exposure cannot be read safely. No exposure change was made.');
      const original = track.getConstraints();
      const restoreControls = { exposureMode: previousControls.exposureMode, exposureTime: previousControls.exposureTime } as unknown as MediaTrackConstraintSet;
      exposureRestore = { track, constraints: { ...original, advanced: [...(original.advanced ?? []), restoreControls] }, originalMode: previousControls.exposureMode, originalTime: previousControls.exposureTime };
      exposureExperiment = { requested: true, requestedExposureUnits: requestedExposure, requestedExposureMs: requestedExposure / 10, originalSettings: previousControls, restoration: 'pending Stop' };
      const manualControls = { exposureMode: 'manual', exposureTime: requestedExposure } as unknown as MediaTrackConstraintSet;
      const applying = track.applyConstraints({ ...original, advanced: [...(original.advanced ?? []), manualControls] });
      exposureChange = applying;
      try { await applying; } finally { if (exposureChange === applying) exposureChange = null; }
      mode += ' + manual 15.625 ms exposure';
    }
    if (run !== generation) return;
    const s = track.getSettings(); settings = { width: s.width, height: s.height, frameRate: s.frameRate, facingMode: s.facingMode, ...inspectControls(s) };
    video.srcObject = source; await video.play();
    if (run !== generation) return;
    startedAt = performance.now(); status.textContent = 'Running. Warm up 2 seconds, then measure at least 10 seconds.';
    const visit = (now: number) => {
      if (run !== generation) return;
      if (now - startedAt >= warmupMs) { videoCount++; if (previousVideo) { videoIntervals.push(now - previousVideo); if (videoIntervals.length > 1800) videoIntervals.shift(); } previousVideo = now; }
      callback = video.requestVideoFrameCallback(visit);
    };
    if (typeof video.requestVideoFrameCallback === 'function') callback = video.requestVideoFrameCallback(visit);
    const ProcessorClass = (window as unknown as { MediaStreamTrackProcessor?: ProcessorConstructor }).MediaStreamTrackProcessor;
    if (ProcessorClass) {
      try {
      rawTrack = track.clone(); reader = new ProcessorClass({ track: rawTrack }).readable.getReader();
      rawState = 'MediaStreamTrackProcessor active';
      void (async () => {
        const currentReader = reader!;
        try {
          while (run === generation) {
            const sample = await currentReader.read();
            if (sample.done) break;
            sample.value.close();
            if (run !== generation) break;
            const now = performance.now();
            if (now - startedAt >= warmupMs) { rawCount++; if (previousRaw) { rawIntervals.push(now - previousRaw); if (rawIntervals.length > 1800) rawIntervals.shift(); } previousRaw = now; }
          }
        } catch (error) { if (run === generation) rawState = `Raw probe unavailable: ${String(error)}`; }
      })();
      } catch (error) { rawTrack?.stop(); rawTrack = null; rawState = `Raw probe unavailable: ${String(error)}`; }
    } else rawState = 'MediaStreamTrackProcessor unavailable in this browser; RVFC probe only';
    draw();
  } catch (error) { if (run === generation) { await stop(); status.textContent = `Camera unavailable: ${String(error)}`; } }
}
q('#probe-baseline').addEventListener('click', () => void start(false));
q('#probe-fast').addEventListener('click', () => void start(true));
q('#probe-manual').addEventListener('click', () => void start(true, true));
q('#probe-stop').addEventListener('click', () => void stop());
q('#probe-download').addEventListener('click', () => downloadJSON('Palmivo-camera-probe.json', report()));
setInterval(draw, 250);
window.addEventListener('beforeunload', () => { void stop(); });
draw();
