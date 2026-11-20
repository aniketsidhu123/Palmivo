import { TsmRuntime } from './runtime';
import { TsmCadence } from './cadence';
import { TSM_MAX_GAP_MS, TSM_SHORTCUTS, TsmShortcutGate, type TsmTool } from './shortcuts';

type Mode = 'rules' | 'loading' | 'listening';
interface Options {
  canListen(): boolean;
  canAccept(): boolean;
  unionAvailable(): boolean;
  onOpenDraft(tool: TsmTool): boolean;
  onTiming(timing: { captureMs: number; preprocessMs: number; inferenceMs: number; roundTripMs: number; decisionMs: number }): void;
  onModeChange?(mode: Mode): void;
}

const LISTEN_MS = 8000;

export function mountTsmTools(toolbar: HTMLElement, runtimePanel: HTMLElement, options: Options) {
  const button = document.createElement('button');
  button.id = 'tsm-listen';
  button.type = 'button';
  button.className = 'outline-button tsm-listen';
  button.setAttribute('aria-describedby', 'tsm-status');
  const hint = document.createElement('span');
  hint.id = 'tsm-stage-hint';
  hint.hidden = true;
  toolbar.prepend(hint, button);

  const panel = document.createElement('section');
  panel.className = 'performance-panel tsm-panel';
  panel.setAttribute('aria-label', 'MIT TSM gesture shortcuts');
  panel.innerHTML = `
    <div class="section-heading"><h3>Gesture shortcuts</h3><span id="tsm-mode" data-mode="rules">GESTURE PALETTE</span></div>
    <p>${Object.values(TSM_SHORTCUTS).map(({ gesture, label }) => `${gesture} → ${label}`).join(' · ')}</p>
    <p id="tsm-status" role="status">Enable the camera to listen for one shortcut.</p>`;
  runtimePanel.append(panel);
  const status = panel.querySelector<HTMLElement>('#tsm-status')!;
  const badge = panel.querySelector<HTMLElement>('#tsm-mode')!;
  const runtime = new TsmRuntime();
  const gate = new TsmShortcutGate();
  const cadence = new TsmCadence();
  let mode: Mode = 'rules';
  let generation = 0;
  let capturing = false;
  let lastSample = -Infinity;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function show(message: string): void {
    if (status.textContent !== message) status.textContent = message;
    if (mode !== 'listening') return;
    const label = message.startsWith('Listening. Relax') ? 'Relax your hand' :
      message.includes('Checking stability') ? 'Recognizing…' :
      message.startsWith('Union needs') ? 'Swipe for a tool' : 'Make a shortcut';
    if (hint.textContent !== label) hint.textContent = label;
  }

  function refresh(): void {
    if (mode !== 'rules' && !options.canListen()) {
      stop('Listening ended. Return to the workspace and try again.');
      return;
    }
    button.disabled = disposed || mode === 'rules' && !options.canListen();
  }

  function setMode(next: Mode): void {
    const changed = mode !== next;
    mode = next;
    if (changed) options.onModeChange?.(next);
    button.textContent = next === 'rules' ? 'Listen for tool' : next === 'loading' ? 'Cancel loading' : 'Stop listening';
    button.title = next === 'rules' ? 'Use MIT TSM to open one CAD draft' : 'Return to gesture palette controls';
    button.setAttribute('aria-pressed', String(next !== 'rules'));
    hint.hidden = next !== 'listening';
    badge.dataset.mode = next;
    badge.textContent = next === 'rules' ? 'GESTURE PALETTE' : next === 'loading' ? 'LOADING MIT TSM' : 'MIT TSM LISTENING';
    refresh();
  }

  function stop(message = 'Gesture palette ready.'): void {
    if (mode === 'rules') return;
    generation++;
    if (deadline !== null) clearTimeout(deadline);
    deadline = null;
    // An in-flight result from a cancelled session cannot affect the next one.
    if (runtime.processing || mode === 'loading') runtime.close();
    gate.reset();
    cadence.reset();
    lastSample = -Infinity;
    setMode('rules');
    show(message);
  }

  async function arm(): Promise<void> {
    if (disposed || mode !== 'rules' || !options.canListen()) return;
    const attempt = ++generation;
    setMode('loading');
    show('Loading the bundled MIT TSM model…');
    try {
      await runtime.load();
      if (generation !== attempt) return;
      if (!options.canListen()) {
        stop('Listening ended. Return to the workspace and try again.');
        return;
      }
      gate.reset();
      cadence.reset();
      lastSample = -Infinity;
      setMode('listening');
      show('Listening. Relax your hand briefly, then make a shortcut.');
      deadline = setTimeout(() => stop('Listening timed out. Try again or choose a tool from the palette.'), LISTEN_MS);
    } catch (error) {
      if (generation !== attempt) return;
      runtime.close();
      stop('MIT TSM is unavailable. Use the gesture palette.');
      if (error instanceof Error) status.title = error.message;
    }
  }

  function sample(video: HTMLVideoElement, timestamp: number, mediaTimeSeconds: number): void {
    if (mode !== 'listening' || !options.canListen() || capturing || runtime.processing ||
        video.readyState < 2 || !cadence.take(mediaTimeSeconds)) return;
    const attempt = generation;
    const started = performance.now();
    const reset = timestamp - lastSample > TSM_MAX_GAP_MS;
    lastSample = timestamp;
    capturing = true;
    void createImageBitmap(video).then(async bitmap => {
      capturing = false;
      if (attempt !== generation || mode !== 'listening' || !options.canListen()) {
        bitmap.close();
        return;
      }
      const captureMs = performance.now() - started;
      const result = await runtime.step(bitmap, timestamp, reset);
      if (attempt !== generation || mode !== 'listening' || !options.canListen()) return;
      // Throw away late inferences before they enter the stability gate.
      if (performance.now() - result.timestamp > TSM_MAX_GAP_MS) {
        gate.reset();
        cadence.reset();
        lastSample = -Infinity;
        return;
      }
      const decisionStart = performance.now();
      const decision = gate.step(result.logits, result.timestamp, options.unionAvailable());
      options.onTiming({
        captureMs, preprocessMs: result.preprocessMs, inferenceMs: result.inferenceMs,
        roundTripMs: performance.now() - started, decisionMs: performance.now() - decisionStart,
      });
      if (decision.accepted) {
        const { tool, label } = decision.accepted;
        if (!options.canAccept()) {
          gate.reset();
          lastSample = -Infinity;
          show('Listening. Relax your hand briefly, then make a shortcut.');
          return;
        }
        stop(`${label} recognized. Review the draft before committing.`);
        if (!options.onOpenDraft(tool)) {
          show(tool === 'union' ? 'Select the first solid and make sure there is a second solid before requesting Union.' : `Could not open ${label}. Check the workspace and try again.`);
        }
      } else if (decision.unionUnavailable) {
        show('Union needs two solids and a selected first solid. Listening for swipes.');
      } else if (decision.shortcut) {
        show(`${decision.shortcut.gesture} detected. Checking stability…`);
      } else {
        show(decision.ready ? 'Listening for swipe left, swipe right, or thumbs up.' : 'Listening. Relax your hand briefly, then make a shortcut.');
      }
    }, error => {
      capturing = false;
      throw error;
    }).catch(error => {
      if (attempt !== generation) return;
      runtime.close();
      stop('MIT TSM stopped. Gesture palette controls are available.');
      if (error instanceof Error) status.title = error.message;
    });
  }

  button.addEventListener('click', () => {
    if (mode === 'rules') void arm();
    else stop();
  });
  setMode('rules');
  return {
    button, refresh, sample, stop, mode: () => mode,
    dispose() {
      disposed = true;
      stop();
      runtime.close();
      button.remove();
      hint.remove();
      panel.remove();
    },
  };
}
