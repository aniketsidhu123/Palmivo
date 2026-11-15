import type { ControllerState, Draft, Tool } from '../shared/types';
import { CONFIRMATION_DURATION_MS, manipulationInstruction, resolveInstruction, type ManipulationFeedback } from './feedback';
import './style.css';
import './responsive.css';
import './gesture-controls.css';

const icons: Record<string, string> = {
  box: '<path d="m12 3 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8M7.5 5.5l9 5"/>',
  cylinder: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  select: '<path d="m5 3 15 9-7 2-3 7z"/>',
  move: '<path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  scale: '<path d="M14 3h7v7M21 3l-8 8M10 21H3v-7M3 21l8-8"/><path d="M3 9V3h6M15 21h6v-6" opacity=".45"/>',
  subtract: '<path d="m9 3 8 4v9l-8 5-7-5V7zM2 7l7 5 8-5M9 12v9"/><path d="M15 11h7M18.5 7.5v7"/><path d="M15 11h7"/>',
  undo: '<path d="M8 5 3 10l5 5M3 10h11a7 7 0 0 1 0 14" transform="translate(0 -3)"/>',
  commit: '<path d="m5 12 4 4L19 6"/>',
  cancel: '<path d="m6 6 12 12M18 6 6 18"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  camera: '<rect x="3" y="5" width="18" height="15" rx="3"/><circle cx="12" cy="12.5" r="4"/><path d="m8 5 1-2h6l1 2"/>',
  export: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  hand: '<path d="M7 13V6a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-6a2 2 0 0 1 4 0v10c0 5-3 7-7 7-3 0-4-1-6-4l-3-5a2 2 0 0 1 3-2l3 3"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
};

export const icon = (name: string, className = '') => `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.box}</svg>`;

export interface WorkspaceUI {
  paletteButtons: Map<Tool, HTMLButtonElement>;
  viewportHost: HTMLElement;
  video: HTMLVideoElement;
  handCanvas: HTMLCanvasElement;
  cameraButton: HTMLButtonElement;
  calibrateButton: HTMLButtonElement;
  exportButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  metricsExportButton: HTMLButtonElement;
  dominantHandSelect: HTMLSelectElement;
  tuningSensitivity: HTMLSelectElement;
  tuningActivation: HTMLSelectElement;
  tuningHover: HTMLSelectElement;
  testGestureButton: HTMLButtonElement;
  update(state: ControllerState): void;
  updatePreview(state: ControllerState): void;
  confirmAction(message: string, button?: HTMLButtonElement | null): void;
  setManipulationFeedback(kind: 'scale' | 'move', phase: 'ready' | 'active' | 'held' | 'paused', value?: number): void;
  clearManipulationFeedback(): void;
  setStatus(text: string): void;
  setTracking(text: string): void;
  setMetrics(metrics: Record<string, string>): void;
  setAssetsReady(ready: boolean): void;
  setCameraState(active: boolean): void;
  setGestureCursor(x: number, y: number, visible: boolean, armed: boolean): void;
  setCalibration(text: string, step?: number): void;
  setSelectedTool(tool: Tool | null): void;
  setGestureFeedback(feedback: { hands: string; pinch: string; gate: string; target: string; progress: number }): void;
  setGestureTestCount(count: number): void;
}

const toolData: Array<[Tool, string, string, string]> = [
  ['box', 'Box', 'B', 'Create a box'], ['cylinder', 'Cylinder', 'C', 'Create a cylinder'],
  ['select', 'Select', 'V', 'Select a solid'], ['move', 'Move', 'M', 'Move on the XY plane; pinch and drag, or use the mouse'],
  ['scale', 'Scale', 'S', 'Scale with two hands'], ['subtract', 'Subtract', 'D', 'Subtract a cutter from the selected target'],
  ['undo', 'Undo', 'Ctrl Z', 'Undo the last committed command (Ctrl+Z)'],
];

export function createUI(root: HTMLElement): WorkspaceUI {
  root.innerHTML = `
    <header class="app-header">
      <a class="brand" href="#" aria-label="SignToAST workspace"><span class="brand-mark"><i></i><i></i><i></i></span><span>sign<span class="brand-to">to</span>ast<span class="brand-period">.</span></span></a>
      <div class="header-context"><span class="header-divider"></span><span>SPATIAL COMPILER</span><span class="version-tag">PROTOTYPE / 03</span></div>
      <div class="header-actions"><span class="local-indicator"><span class="status-dot"></span>All computation stays here</span><button id="export-project" class="quiet-button">${icon('export')}<span>Export project</span></button></div>
    </header>
    <main class="workspace">
      <section class="workspace-heading"><div><div class="eyebrow">CONTINUOUS INPUT. STRUCTURED OUTPUT.</div><h1>Give your ideas shape<span>.</span></h1></div><div class="readiness" id="assets-status"><span class="readiness-icon">↻</span><div><strong>Preparing local assets</strong><span>Checking geometry & tracking runtime</span></div></div></section>
      <div class="workspace-grid">
        <aside class="tool-rail" aria-label="CAD tools"><div class="rail-label">TOOLS <span>01—07</span></div><div class="tool-list">${toolData.map(([tool,label,key,title], i) => `${i === 2 || i === 6 ? '<div class="tool-divider"></div>' : ''}<button class="tool-button" data-tool="${tool}" title="${title}" aria-label="${title}">${icon(tool)}<span>${label}</span><kbd>${key}</kbd></button>`).join('')}</div><div class="rail-bottom"><button data-tool="pause" class="tool-button pause-button">${icon('pause')}<span>Pause</span><kbd>␣</kbd></button><button id="reset-scene" class="reset-button">${icon('reset')}Reset workspace</button></div></aside>
        <section class="stage-shell" aria-label="3D scene">
          <div class="stage-toolbar"><div><span class="stage-dot"></span><span>UNTITLED SCENE</span><span id="scene-revision" class="stage-revision">REV 000</span></div><div class="stage-options"><span id="solid-count">0 solids</span><span class="stage-separator">/</span><span>mm</span><span class="stage-view">PERSPECTIVE</span></div></div>
          <div class="viewport-wrap"><div id="viewport" class="viewport"></div><div class="viewport-label"><span class="corner-mark"></span>WORLD SPACE <span>XY / Z FIXED</span></div><div id="scene-objects" class="scene-objects" aria-label="Scene solids"></div><div id="empty-scene" class="empty-scene"><span class="empty-glyph">${icon('box')}</span><h2>A space for your next idea.</h2><p>Choose <strong>Box</strong> or <strong>Cylinder</strong> to start building.</p><span>GESTURE CONTROL OR MOUSE & KEYBOARD</span></div><div class="scene-axis" aria-hidden="true"><span class="axis-y">Y</span><span class="axis-x">X</span><span class="axis-z">Z</span><i></i></div><div id="draft-badge" class="draft-badge" hidden><span></span>DRAFT PREVIEW</div></div>
          <div class="stage-bottom"><span><span class="status-dot"></span><span id="stage-state">Ready for your first command</span></span><span id="selection-label">NO SELECTION</span></div>
        </section>
        <aside class="inspector" aria-label="Command inspector">
          <div class="inspector-title"><h2>Command inspector</h2><span class="small-index">02</span></div>
          <div class="pipeline"><span class="pipeline-active">INPUT</span><i>→</i><span id="pipeline-draft">DRAFT</span><i>→</i><span id="pipeline-ast">AST</span><i>→</i><span>SOLID</span></div>
          <div class="instruction-card"><div class="instruction-caption">${icon('hand')}<span>NEXT ACTION</span></div><p id="instruction">Choose a primitive to begin. Enable your camera when you're ready for gesture control.</p><div class="gesture-hint">Open other hand · point · pinch</div></div>
          <section class="selected-panel"><div class="section-heading"><h3>Selected solid</h3><span id="selected-type">—</span></div><div id="selected-name" class="selected-name">Nothing selected</div><div class="property-grid"><span>POSITION <small>mm</small></span><strong id="selected-position">— / — / —</strong><span>UNIFORM SCALE</span><strong id="selected-scale">—</strong></div></section>
          <section class="ast-panel"><div class="section-heading"><h3>Abstract syntax tree</h3><span id="ast-status" class="ast-status">NO COMMAND</span></div><div class="code-window"><div class="code-toolbar"><span><i></i><i></i><i></i></span><span>command.json</span><span>{ }</span></div><pre id="ast-code" aria-label="Command AST">{
  <span class="code-comment">// Your gestures become</span>
  <span class="code-comment">// structured instructions.</span>
}</pre></div></section>
          <div class="commit-actions"><button data-tool="commit" class="commit-button" disabled>${icon('commit')}Commit<span>↵</span></button><button data-tool="cancel" class="cancel-button" disabled>${icon('cancel')}Cancel<span>esc</span></button></div><p class="commit-note">A preview is only a possibility.<br>Commit makes it part of your scene.</p>
        </aside>
        <section class="tracking-panel" aria-label="Hand tracking controls"><div class="camera-tile"><video id="camera" autoplay muted playsinline aria-label="Mirrored local camera preview"></video><canvas id="hand-overlay"></canvas><div class="camera-placeholder" id="camera-placeholder">${icon('camera')}<span>Camera is off</span></div><span class="camera-local">LOCAL ONLY</span></div><div class="tracking-content"><div class="section-heading"><h3>Hands are your interface</h3><span id="tracking-badge" class="tracking-badge">CAMERA OFF</span></div><p id="tracking-status">Connect your camera to point, pinch, and shape in space.</p><div class="tracking-controls"><button id="camera-button" class="camera-button">${icon('camera')}Enable camera</button><button id="calibrate-button" class="outline-button">Calibrate</button><label class="dominant-select">POINTER HAND<select id="dominant-hand" aria-label="Pointer hand"><option value="Right">Right</option><option value="Left">Left</option></select></label></div><p id="calibration-status" class="calibration-status">Fixed frontal camera · two hands in frame · good lighting</p>
          <section class="gesture-controls" aria-label="Gesture controls">
            <div class="section-heading"><h3>Gesture controls</h3><span class="tuning-tag">TUNE YOUR INPUT</span></div>
            <div class="gesture-settings">
              <label for="gesture-sensitivity">Pinch sensitivity<select id="gesture-sensitivity"><option value="standard">Standard · 0.32 / 0.52</option><option value="easier" selected>Easier · 0.40 / 0.62</option><option value="precise">Precise · 0.25 / 0.42</option><option value="calibrated">Calibrated · your profile</option></select></label>
              <label for="gesture-activation">Button activation<select id="gesture-activation"><option value="pinch">Pinch</option><option value="dwell">Dwell assist</option></select></label>
              <label for="gesture-hover">Hover stability<select id="gesture-hover"><option value="350" selected>Relaxed · 350 ms</option><option value="200">Fast · 200 ms</option><option value="500">Steady · 500 ms</option></select></label>
            </div>
            <p id="activation-help" class="activation-help">Hover until the button is ready, then pinch. Release fully before the next click.</p>
            <div class="gesture-feedback" aria-label="Live gesture feedback">
              <div class="gesture-feedback-item"><span>Hands detected</span><strong id="gesture-hands">Camera off</strong></div>
              <div class="gesture-feedback-item"><span>Pinch / threshold</span><strong id="gesture-pinch">Waiting for your pointer hand</strong></div>
              <div class="gesture-feedback-item feedback-wide"><span>Toolbar readiness</span><strong id="gesture-gate">Enable the camera to test your input.</strong></div>
              <div class="gesture-feedback-item feedback-wide"><span>Hovered button</span><strong id="gesture-target">No target</strong><div id="gesture-progress" class="gesture-progress" role="progressbar" aria-label="Button activation progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div></div>
            </div>
            <div class="gesture-test"><button id="test-gesture" class="test-gesture-button" data-gesture-action="test">${icon('select')}Test click</button><span id="gesture-test-count" role="status" aria-live="polite">0 test clicks</span><span class="gesture-test-note">Practice here before editing a solid.</span></div>
          </section>
        </div></section>
        <section class="runtime-panel" aria-label="Runtime information"><div class="section-heading"><h3>Built to stay local</h3><span class="runtime-mark">↗</span></div><strong>MediaPipe + temporal<br>gesture rules</strong><p id="runtime-status" role="status">Initializing the solid modelling engine.</p><div class="runtime-caption">NO CLOUD · NO VIDEO UPLOAD</div></section>
      </div>
      <footer class="diagnostics"><div class="diagnostic-label"><span class="status-dot"></span>LIVE DIAGNOSTICS</div><div class="metric"><span>CAMERA</span><strong data-metric="camera">— fps</strong></div><div class="metric"><span>TRACKING</span><strong data-metric="tracking">— fps</strong></div><div class="metric"><span>RENDER</span><strong data-metric="render">— fps</strong></div><div class="metric"><span>LANDMARKS</span><strong data-metric="landmark">— ms</strong></div><div class="metric"><span>RULES → AST</span><strong data-metric="compiler">— ms</strong></div><div class="metric"><span>GEOMETRY</span><strong data-metric="geometry">— ms</strong></div><button id="metrics-export" title="Export measured performance" aria-label="Export measured performance">${icon('export')}</button></footer>
      <div class="page-footnote"><span>Spatial gesture prototype. Scene dimensions are illustrative, not physical measurements.</span><span>COMPILE SOMETHING TANGIBLE.</span></div>
    </main><div id="gesture-cursor" class="gesture-cursor" hidden><span></span></div>`;

  const references = new Map<string, HTMLElement>();
  const q = <T extends HTMLElement>(selector: string): T => {
    let element = references.get(selector);
    if (!element) { element = root.querySelector<HTMLElement>(selector)!; references.set(selector, element); }
    return element as T;
  };
  const text = (element: HTMLElement, value: string) => { if (element.textContent !== value) element.textContent = value; };
  const paletteButtons = new Map<Tool, HTMLButtonElement>();
  root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => paletteButtons.set(button.dataset.tool as Tool, button));
  const video = q<HTMLVideoElement>('#camera');
  const cameraButton = q<HTMLButtonElement>('#camera-button');
  const hud = document.createElement('div');
  hud.className = 'gesture-hud';
  hud.hidden = true;
  hud.setAttribute('aria-label', 'Live gesture input');
  hud.innerHTML = '<div class="gesture-hud-gate"><span><i></i>INPUT</span><strong id="hud-gate">Show your pointer hand.</strong></div><div class="gesture-hud-target"><span id="hud-target">No target</span><div class="gesture-progress" id="hud-progress"><i></i></div></div>';
  q('.stage-toolbar').after(hud);
  const booleanSummary = document.createElement('div');
  booleanSummary.className = 'boolean-summary'; booleanSummary.hidden = true;
  q('.selected-panel').append(booleanSummary);
  const tuningActivation = q<HTMLSelectElement>('#gesture-activation');
  tuningActivation.addEventListener('change', () => {
    q('#activation-help').textContent = tuningActivation.value === 'dwell' ? 'Dwell assist activates a hovered button after an intentional hold. Commit still requires choosing its button.' : 'Hover until the button is ready, then pinch. Release fully before the next click.';
  });
  const cursor = q('#gesture-cursor');
  let currentState: ControllerState | null = null;
  let selectedTool: Tool | null = null;
  let confirmation: { message: string; until: number; button: HTMLButtonElement | null } | null = null;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;
  let manipulation: ManipulationFeedback | null = null;
  let feedbackGate = 'Show your pointer hand.';
  const objectButtons = new Map<string, { button: HTMLButtonElement; color: HTMLElement; name: HTMLElement; role: HTMLElement }>();
  const baseInstruction = (): string => {
    const state = currentState;
    if (!state) return 'Choose a primitive to begin.';
    if (state.draft?.kind === 'subtract') {
      const draft = state.draft;
      const target = state.scene.solids.find(s => s.id === draft.targetId)?.name ?? draft.targetId;
      const cutter = state.scene.solids.find(s => s.id === draft.cutterId)?.name;
      return cutter ? `Cutter selected: ${cutter}. Choose Commit to subtract from ${target}.` : `Target: ${target}. Select a different solid as the Cutter.`;
    }
    const fallbackHint = state.draft?.kind === 'scale' ? ' Mouse: scroll, or use + / −.' : state.draft?.kind === 'move' ? ' Mouse: drag in the viewport.' : '';
    return (state.message || (state.draft ? 'Adjust your preview, then Commit or Cancel.' : 'Choose a primitive to begin.')) + fallbackHint;
  };
  const renderPrimary = () => {
    const context = manipulationInstruction(manipulation, currentState?.draft?.kind);
    const common = { confirmation, now: Date.now(), context };
    const primary = resolveInstruction({ ...common, base: baseInstruction() });
    text(q('#instruction'), primary.message);
    text(q('#hud-gate'), resolveInstruction({ ...common, base: feedbackGate }).message);
    text(q('#stage-state'), resolveInstruction({ ...common, context: null, base: currentState?.busy ? 'Compiling solid geometry…' : currentState?.paused ? 'Interaction paused' : currentState?.draft ? 'Preview only · commit to apply' : 'Ready for your next command' }).message);
    q('.instruction-card').classList.toggle('has-confirmation', primary.confirmed);
    hud.classList.toggle('has-confirmation', primary.confirmed);
    const hint = q('.gesture-hint');
    hint.hidden = !!context;
  };
  const updatePreviewFields = (state: ControllerState) => {
    currentState = state;
    const selected = state.scene.solids.find(solid => solid.id === state.selectedId);
    const position = state.draft?.kind === 'move' ? state.draft.position : selected?.position;
    const scale = state.draft?.kind === 'scale' ? state.draft.uniformScale : selected?.scale;
    text(q('#selected-position'), position ? position.map(value => value.toFixed(0)).join(' / ') : '— / — / —');
    text(q('#selected-scale'), scale !== undefined ? `${scale.toFixed(2)}×` : '—');
    const ast = state.draft ? draftAST(state.draft) : state.lastCommand?.ast;
    const code = q('#ast-code');
    const nextCode = ast ? JSON.stringify(ast, null, 2) : '{\n  // Your gestures become\n  // structured instructions.\n}';
    if (code.textContent !== nextCode) { const scrollTop = code.scrollTop; code.textContent = nextCode; code.scrollTop = scrollTop; }
    renderPrimary();
  };
  const updateButtonStates = () => {
    if (!currentState) return;
    const state = currentState;
    for (const [tool, button] of paletteButtons) {
      const hasSelection = !!state.selectedId;
      button.disabled = tool === 'pause' ? state.busy : tool === 'cancel' ? !state.draft || state.busy : tool === 'commit' ? !state.draft || state.busy || state.paused || (state.draft.kind === 'subtract' && !state.draft.cutterId) : state.busy || state.paused || !!state.draft || (['move', 'scale', 'subtract'].includes(tool) && !hasSelection) || (tool === 'undo' && !state.historyCount) || (['box', 'cylinder'].includes(tool) && state.scene.solids.length >= 10);
      button.classList.toggle('is-active', tool === selectedTool);
      button.setAttribute('aria-pressed', String(tool === selectedTool));
    }
    const pause = paletteButtons.get('pause')!;
    text(pause.querySelector<HTMLElement>('span')!, state.paused ? 'Resume' : 'Pause');
  };

  return {
    paletteButtons,
    viewportHost: q('#viewport'), video,
    handCanvas: q<HTMLCanvasElement>('#hand-overlay'), cameraButton,
    calibrateButton: q<HTMLButtonElement>('#calibrate-button'),
    exportButton: q<HTMLButtonElement>('#export-project'),
    resetButton: q<HTMLButtonElement>('#reset-scene'),
    metricsExportButton: q<HTMLButtonElement>('#metrics-export'),
    dominantHandSelect: q<HTMLSelectElement>('#dominant-hand'),
    tuningSensitivity: q<HTMLSelectElement>('#gesture-sensitivity'),
    tuningActivation,
    tuningHover: q<HTMLSelectElement>('#gesture-hover'),
    testGestureButton: q<HTMLButtonElement>('#test-gesture'),
    update(state) {
      currentState = state;
      updateButtonStates();
      text(q('#scene-revision'), `REV ${String(state.scene.revision).padStart(3, '0')}`);
      text(q('#solid-count'), `${state.scene.solids.length} solid${state.scene.solids.length === 1 ? '' : 's'}`);
      q('#empty-scene').hidden = !!(state.scene.solids.length || state.draft);
      q('#draft-badge').hidden = !state.draft;
      q('#draft-badge').classList.toggle('is-busy', state.busy);
      const selected = state.scene.solids.find(solid => solid.id === state.selectedId);
      text(q('#selection-label'), selected ? selected.name.toUpperCase() : 'NO SELECTION');
      const objectList = q('#scene-objects');
      const ids = new Set(state.scene.solids.map(solid => solid.id));
      for (const [id, entry] of objectButtons) {
        if (!ids.has(id)) { entry.button.remove(); objectButtons.delete(id); }
      }
      for (const solid of state.scene.solids) {
        let entry = objectButtons.get(solid.id);
        if (!entry) {
          const button = document.createElement('button');
          button.className = 'scene-object'; button.dataset.solidId = solid.id; button.dataset.action = 'solid';
          const color = document.createElement('i'), name = document.createElement('span'), role = document.createElement('small');
          button.append(color, name, role); objectList.append(button);
          entry = { button, color, name, role }; objectButtons.set(solid.id, entry);
        }
        const { button, color, name, role } = entry;
        button.classList.toggle('is-selected', solid.id === state.selectedId);
        button.disabled = state.busy || state.paused || !!state.draft && state.draft.kind !== 'subtract';
        const pressed = String(solid.id === state.selectedId);
        if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
        if (color.dataset.color !== solid.color) { color.style.background = solid.color; color.dataset.color = solid.color; }
        text(name, solid.name);
        text(role, state.draft?.kind === 'subtract' ? solid.id === state.draft.targetId ? 'TARGET' : solid.id === state.draft.cutterId ? 'CUTTER' : '' : solid.id === state.selectedId ? 'SELECTED' : '');
      }
      const subtract = state.draft?.kind === 'subtract' ? state.draft : null;
      const target = subtract ? state.scene.solids.find(solid => solid.id === subtract.targetId) : null;
      const cutter = subtract ? state.scene.solids.find(solid => solid.id === subtract.cutterId) : null;
      text(q('.selected-panel .section-heading h3'), subtract ? 'Boolean operands' : 'Selected solid');
      text(q('#selected-name'), subtract ? `Target: ${target?.name ?? '—'}` : selected?.name ?? 'Nothing selected');
      text(q('#selected-type'), subtract ? 'TARGET − CUTTER' : selected?.recipe.kind.toUpperCase() ?? '—');
      q('.property-grid').hidden = !!subtract;
      booleanSummary.hidden = !subtract;
      text(booleanSummary, subtract ? `Cutter: ${cutter?.name ?? 'Choose a different solid'}` : '');
      booleanSummary.classList.toggle('has-cutter', !!cutter);
      q('#pipeline-draft').classList.toggle('pipeline-active', !!state.draft);
      q('#pipeline-ast').classList.toggle('pipeline-active', !!state.lastCommand && !state.draft);
      const ast = state.draft ? draftAST(state.draft) : state.lastCommand?.ast;
      text(q('#ast-status'), state.busy ? 'COMPILING' : state.draft ? 'DRAFT' : ast ? 'COMMITTED' : 'NO COMMAND');
      q('#ast-status').classList.toggle('is-draft', !!state.draft);
      updatePreviewFields(state);
    },
    updatePreview(state) { updatePreviewFields(state); },
    confirmAction(message, button = null) {
      if (confirmationTimer) clearTimeout(confirmationTimer);
      confirmation?.button?.classList.remove('action-confirmed');
      confirmation = { message, until: Date.now() + CONFIRMATION_DURATION_MS, button };
      if (button) { button.classList.remove('action-confirmed'); void button.offsetWidth; button.classList.add('action-confirmed'); }
      renderPrimary();
      confirmationTimer = setTimeout(() => {
        confirmation?.button?.classList.remove('action-confirmed');
        confirmation = null; confirmationTimer = null; renderPrimary();
      }, CONFIRMATION_DURATION_MS);
    },
    setManipulationFeedback(kind, phase, value) {
      if (manipulation?.kind === kind && manipulation.phase === phase && manipulation.value === value) return;
      manipulation = { kind, phase, value }; renderPrimary();
    },
    clearManipulationFeedback() { manipulation = null; renderPrimary(); },
    setStatus(value) { text(q('#runtime-status'), value); },
    setTracking(value) {
      text(q('#tracking-status'), value);
      const badge = q('#tracking-badge');
      const normalized = value.toLowerCase();
      text(badge, normalized.includes('lost') || normalized.includes('missing') ? 'TRACKING LOST' : normalized.includes('error') || normalized.includes('denied') ? 'UNAVAILABLE' : video.srcObject ? 'LIVE TRACKING' : 'CAMERA OFF');
      badge.classList.toggle('is-live', !!video.srcObject);
    },
    setMetrics(metrics) {
      const aliases: Record<string, string> = { cameraFPS: 'camera', trackingFPS: 'tracking', renderFPS: 'render', fps: 'render', landmarkMs: 'landmark', inferenceMs: 'landmark', compilerMs: 'compiler', rulesMs: 'compiler', geometryMs: 'geometry', landmarks: 'landmark', rules: 'compiler' };
      for (const [key, value] of Object.entries(metrics)) {
        const element = q(`[data-metric="${aliases[key] ?? key}"]`);
        if (element) text(element, value);
      }
    },
    setAssetsReady(ready) {
      const status = q('#assets-status');
      status.classList.toggle('is-ready', ready);
      status.querySelector('strong')!.textContent = ready ? 'Local assets ready' : 'Preparing local assets';
      status.querySelector(':scope > div > span')!.textContent = ready ? 'Runtime files bundled on this device' : 'Checking geometry & tracking runtime';
      status.querySelector('.readiness-icon')!.textContent = ready ? '✓' : '↻';
    },
    setCameraState(active) {
      hud.hidden = !active;
      cameraButton.innerHTML = `${icon('camera')}${active ? 'Stop camera' : 'Enable camera'}`;
      q('#camera-placeholder').hidden = active;
      q('#tracking-badge').textContent = active ? 'LIVE TRACKING' : 'CAMERA OFF';
      q('#tracking-badge').classList.toggle('is-live', active);
      if (!active) { cursor.hidden = true; video.srcObject = null; }
    },
    setGestureCursor(x, y, visible, armed) {
      cursor.hidden = !visible;
      cursor.style.transform = `translate3d(${x}px,${y}px,0)`;
      cursor.classList.toggle('is-armed', armed);
    },
    setCalibration(text, step) {
      const active = step !== undefined && step >= 1;
      q('#calibration-status').textContent = active ? `${Math.min(4, step)} / 4 · ${text}` : text;
      q('#calibration-status').classList.toggle('is-calibrating', active);
    },
    setSelectedTool(tool) { selectedTool = tool; updateButtonStates(); },
    setGestureFeedback(feedback) {
      text(q('#gesture-hands'), feedback.hands);
      text(q('#gesture-pinch'), feedback.pinch);
      text(q('#gesture-gate'), feedback.gate);
      text(q('#gesture-target'), feedback.target);
      feedbackGate = feedback.gate;
      const progress = Math.max(0, Math.min(1, Number.isFinite(feedback.progress) ? feedback.progress : 0));
      const element = q('#gesture-progress');
      const progressValue = String(Math.round(progress * 100));
      if (element.getAttribute('aria-valuenow') !== progressValue) element.setAttribute('aria-valuenow', progressValue);
      const progressWidth = `${Math.round(progress * 1000) / 10}%`;
      if (q('#gesture-progress i').style.width !== progressWidth) q('#gesture-progress i').style.width = progressWidth;
      element.classList.toggle('is-ready', progress >= 1);
      text(q('#hud-target'), feedback.target);
      const hudProgress = q('#hud-progress');
      if (q('#hud-progress i').style.width !== progressWidth) q('#hud-progress i').style.width = progressWidth;
      hudProgress.classList.toggle('is-ready', progress >= 1);
      renderPrimary();
    },
    setGestureTestCount(count) {
      text(q('#gesture-test-count'), `${count} test click${count === 1 ? '' : 's'}`);
      q('#test-gesture').classList.toggle('has-clicked', count > 0);
    },
  };
}

function draftAST(draft: Draft): unknown {
  switch (draft.kind) {
    case 'create': return { type: 'Create', objectId: draft.solid.id, primitive: draft.solid.recipe.kind === 'box' ? 'Box' : 'Cylinder', dimensions: draft.solid.recipe.kind === 'box' ? draft.solid.recipe.dimensions : draft.solid.recipe.kind === 'cylinder' ? [draft.solid.recipe.radius, draft.solid.recipe.height] : [], position: draft.solid.position };
    case 'move': return { type: 'Move', targetId: draft.targetId, position: draft.position };
    case 'scale': return { type: 'Scale', targetId: draft.targetId, uniformScale: draft.uniformScale };
    case 'subtract': return { type: 'Subtract', targetId: draft.targetId, cutterId: draft.cutterId ?? '(choose cutter)', resultId: draft.resultId };
  }
}
