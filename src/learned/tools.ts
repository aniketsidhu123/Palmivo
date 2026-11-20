import { LearnedBackend } from './backend';
import { MAX_GAP_MS, type FeatureSet, type LearnedMode, type LearnedTiming, type ModelManifest, type ToolToken } from './contract';
import { StreamingCtcDecoder } from './ctc';
import { MAX_REPLAY_BYTES, parseReplay, verifyReplay, type ReplayResult } from './replay';

export interface LearnedToolsOptions {
  /** Verify camera availability and that a draft can safely be opened. */
  getIdle(): boolean;
  onOpenDraft(token: ToolToken): boolean;
  onTiming?(timing: LearnedTiming): void;
}

export function mountLearnedTools(host: HTMLElement, options: LearnedToolsOptions) {
  const panel = document.createElement('section');
  panel.className = 'performance-panel learned-panel';
  panel.setAttribute('aria-label', 'Learned gesture shortcuts');
  panel.innerHTML = `
    <div class="section-heading"><h3>Gesture recognition</h3><span id="learned-mode">GESTURE RULES</span></div>
    <p id="learned-help">Trace a square for Box or a circle for Cylinder. Bring both open hands together for Union.</p>
    <div class="benchmark-actions">
      <button id="learned-listen" type="button" class="outline-button">Listen with custom model</button>
      <button id="learned-shadow" type="button" class="outline-button">Measure learned model</button>
      <button id="learned-replay" type="button" class="outline-button">Replay parity clip</button>
      <button id="learned-report" type="button" class="outline-button" hidden>Save parity result</button>
      <button id="learned-stop" type="button" class="outline-button" disabled>Stop</button>
      <input id="learned-replay-file" type="file" accept=".json,application/json" aria-label="Load local parity clip" hidden>
    </div>
    <p id="learned-status" role="status">Gesture rules active. Learned shortcuts require the packaged presenter-trained model.</p>
    <p id="learned-output" hidden></p>
  `;
  host.append(panel);
  const get = <T extends HTMLElement>(id: string) => panel.querySelector<T>('#' + id)!;
  const badge = get('learned-mode');
  const status = get('learned-status');
  const output = get('learned-output');
  const listenButton = get<HTMLButtonElement>('learned-listen');
  const shadowButton = get<HTMLButtonElement>('learned-shadow');
  const replayButton = get<HTMLButtonElement>('learned-replay');
  const reportButton = get<HTMLButtonElement>('learned-report');
  const stopButton = get<HTMLButtonElement>('learned-stop');
  const filePicker = get<HTMLInputElement>('learned-replay-file');
  const backend = new LearnedBackend();
  const decoder = new StreamingCtcDecoder();
  let manifest: ModelManifest | null = null;
  let mode: LearnedMode = 'rules';
  let generation = 0;
  let loading = false;
  let ended = false;
  let nextReset = true;
  let lastTimestamp = -Infinity;
  let droppedFrames = 0;
  let stableCount = 0;
  let replayReport: { result: ReplayResult; modelSha256: string; featureSet: FeatureSet } | null = null;

  function setMode(next: LearnedMode): void {
    mode = next;
    badge.textContent = {
      rules: 'GESTURE RULES', live: 'LIVE LEARNED SHORTCUTS',
      shadow: 'LEARNED MEASUREMENT', replay: 'RECORDED REPLAY',
    }[mode];
    refresh();
  }

  function refresh(): void {
    listenButton.disabled = ended || loading || mode !== 'rules' || !options.getIdle();
    shadowButton.disabled = ended || loading || mode !== 'rules' || !options.getIdle();
    replayButton.disabled = ended || loading || mode !== 'rules';
    stopButton.disabled = ended || (!loading && mode === 'rules');
  }

  function resetStream(): void {
    decoder.reset();
    nextReset = true;
    lastTimestamp = -Infinity;
  }

  function stop(message = 'Gesture rules active.'): void {
    generation++;
    if (backend.processing) {
      backend.close();
      manifest = null;
    }
    loading = false;
    resetStream();
    setMode('rules');
    status.textContent = message;
  }

  async function arm(next: 'live' | 'shadow'): Promise<void> {
    if (ended || loading || mode !== 'rules' || !options.getIdle()) return;
    const attempt = ++generation;
    output.hidden = true;
    loading = true;
    status.textContent = 'Loading local gesture model…';
    refresh();
    try {
      const loaded = await backend.load();
      if (generation !== attempt) return;
      manifest = loaded;
      if (!options.getIdle()) {
        status.textContent = 'Return to the idle workspace and enable the camera to listen.';
        return;
      }
      if (next === 'live' && !manifest.liveApproved) {
        status.textContent = 'Live draft opening is locked pending presenter acceptance. Measure the model or replay a parity clip.';
        return;
      }
      resetStream();
      droppedFrames = 0;
      stableCount = 0;
      setMode(next);
      status.textContent = next === 'live' ? 'Listening for one tool. Release your pinches and make the gesture.' : 'Measuring the learned model alongside gesture rules.';
    } catch (error) {
      if (generation === attempt) status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      if (generation === attempt) {
        loading = false;
        refresh();
      }
    }
  }

  function active(): boolean { return mode === 'live' || mode === 'shadow'; }

  function reset(): void {
    if (mode === 'live') {
      stop('Listening stopped. Return to Idle and start again.');
    } else if (mode === 'shadow') {
      generation++;
      resetStream();
    }
    refresh();
  }

  function push(timestamp: number, features: Float32Array): void {
    if (!active() || !Number.isFinite(timestamp) || timestamp <= lastTimestamp) return;
    if (mode === 'live' && !options.getIdle()) {
      stop('Listening ended because the workspace is no longer idle.');
      return;
    }
    if (backend.processing) {
      droppedFrames++;
      return;
    }
    if (timestamp - lastTimestamp > MAX_GAP_MS) resetStream();
    const attempt = generation;
    const started = performance.now();
    const reset = nextReset;
    nextReset = false;
    lastTimestamp = timestamp;
    void backend.step(features, reset).then(result => {
      if (generation !== attempt || !active()) return;
      const decoderStart = performance.now();
      const recognition = decoder.step(result.logits, timestamp);
      const decoderMs = performance.now() - decoderStart;
      options.onTiming?.({ inferenceMs: result.inferenceMs, decoderMs, roundTripMs: performance.now() - started, droppedFrames });
      if (recognition.stable) stableCount++;
      const label = recognition.provisional ? `${recognition.provisional} · ${Math.round(recognition.confidence * 100)}%` : 'Waiting for a gesture';
      const stableSummary = recognition.stable ? ` · Stable ${recognition.stable}` : '';
      output.hidden = false;
      output.textContent = `${label}${stableSummary}${mode === 'shadow' ? ` · ${stableCount} stable tokens` : ''}`;
      if (recognition.stable && mode === 'live' && options.getIdle()) {
        const token = recognition.stable;
        // Disarm before invoking the controller to prevent reentrancy or a duplicate draft.
        stop(`Recognized ${token}. Review the draft before committing.`);
        if (!options.onOpenDraft(token)) status.textContent = `Recognized ${token}. The workspace could not open its draft.`;
      }
    }).catch(error => {
      if (generation !== attempt || !active()) return;
      backend.close();
      manifest = null;
      stop(error instanceof Error ? error.message : String(error));
    });
  }

  async function replay(file: File): Promise<void> {
    if (ended || loading || mode !== 'rules') return;
    if (file.size > MAX_REPLAY_BYTES) {
      status.textContent = 'Choose a parity clip smaller than 16 MiB.';
      return;
    }
    const attempt = ++generation;
    output.hidden = true;
    setMode('replay');
    status.textContent = 'Loading the local model and replay clip…';
    try {
      const loaded = await backend.load();
      const clip = parseReplay(JSON.parse(await file.text()), loaded);
      if (generation !== attempt) return;
      manifest = loaded;
      status.textContent = 'Running browser inference on the frozen presenter clip…';
      const result = await verifyReplay(backend, clip, () => generation !== attempt);
      if (generation !== attempt) return;
      replayReport = { result, modelSha256: loaded.modelSha256, featureSet: loaded.featureSet };
      reportButton.hidden = false;
      const parity = result.logitParity && result.transcriptParity ? 'passed' : 'failed';
      const summary = (tokens: ToolToken[]) => tokens.join(' → ') || 'blank';
      status.textContent = `Recorded replay · Browser parity ${parity} · ${result.frameCount} frames.`;
      const delays = result.stableDelaysMs?.map(delay => delay.toFixed(0)).join(', ');
      output.textContent = `Intended ${summary(result.intended)} · Desktop ${summary(result.desktop)} · Browser ${summary(result.decoded)} · Stable ${summary(result.stable)} · Max logit error ${result.maxAbsoluteLogitError.toExponential(2)} · Inference p95 ${result.inferenceP95Ms.toFixed(2)} ms${delays ? ` · Gesture-end delays ${delays} ms` : ''}`;
      output.hidden = false;
    } catch (error) {
      if (generation === attempt) status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      if (generation === attempt) setMode('rules');
    }
  }

  listenButton.addEventListener('click', () => void arm('live'));
  shadowButton.addEventListener('click', () => void arm('shadow'));
  replayButton.addEventListener('click', () => filePicker.click());
  reportButton.addEventListener('click', () => {
    if (!replayReport) return;
    const file = new Blob([JSON.stringify({ version: 1, backend: 'ONNX Runtime Web (WASM)', ...replayReport }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(file);
    link.href = url;
    link.download = 'Palmivo-browser-parity.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  stopButton.addEventListener('click', () => stop());
  filePicker.addEventListener('change', () => {
    const file = filePicker.files?.[0];
    filePicker.value = '';
    if (file) void replay(file);
  });
  refresh();

  return {
    active, push, reset, stop, refresh, listenButton, stopButton,
    featureSet: (): FeatureSet => manifest?.featureSet ?? 'hands',
    mode: (): LearnedMode => mode,
    dispose() {
      ended = true;
      stop();
      backend.close();
      panel.remove();
    },
  };
}
