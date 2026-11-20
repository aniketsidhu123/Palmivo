import type { ControllerState, Draft, GeometryMesh, Tool } from '../shared/types';
import { SIZE_PRESETS } from '../core/presets';
import { TRANSFORM_STEPS } from '../core/transformSteps';
import { measureSolid, type SolidMeasurements } from '../core/solidMeasurements';
import { CONFIRMATION_DURATION_MS, manipulationInstruction, resolveInstruction, type ManipulationFeedback } from './feedback';
import './style.css';
import './responsive.css';
import './gesture-controls.css';
import './features.css';
import './workbench.css';

const icons: Record<string, string> = {
  box: '<path d="m12 3 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8M7.5 5.5l9 5"/>',
  cylinder: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  select: '<path d="m5 3 15 9-7 2-3 7z"/>',
  move: '<path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  scale: '<path d="M14 3h7v7M21 3l-8 8M10 21H3v-7M3 21l8-8"/><path d="M3 9V3h6M15 21h6v-6" opacity=".45"/>',
  subtract: '<path d="m9 3 8 4v9l-8 5-7-5V7zM2 7l7 5 8-5M9 12v9"/><path d="M15 11h7M18.5 7.5v7"/><path d="M15 11h7"/>',
  union: '<path d="M3 3h11v5h7v13H8v-7H3zM8 14V8h6"/><path d="M14.5 11v7M11 14.5h7"/>',
  undo: '<path d="M8 5 3 10l5 5M3 10h11a7 7 0 0 1 0 14" transform="translate(0 -3)"/>',
  commit: '<path d="m5 12 4 4L19 6"/>',
  cancel: '<path d="m6 6 12 12M18 6 6 18"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  camera: '<rect x="3" y="5" width="18" height="15" rx="3"/><circle cx="12" cy="12.5" r="4"/><path d="m8 5 1-2h6l1 2"/>',
  export: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  open: '<path d="M3 19V5h7l2 3h9v11z"/><path d="M3 11h18"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  hand: '<path d="M7 13V6a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-6a2 2 0 0 1 4 0v10c0 5-3 7-7 7-3 0-4-1-6-4l-3-5a2 2 0 0 1 3-2l3 3"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
};

export const icon = (name: string, className = '') => `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.box}</svg>`;

export interface WorkspaceUI {
  paletteButtons: Map<Tool, HTMLButtonElement>;
  sizePresetButtons: Map<string, HTMLButtonElement>;
  transformStepButtons: Map<string, HTMLButtonElement>;
  viewportHost: HTMLElement;
  video: HTMLVideoElement;
  handCanvas: HTMLCanvasElement;
  cameraButton: HTMLButtonElement;
  exampleCameraButton: HTMLButtonElement;
  tryBushingButton: HTMLButtonElement;
  calibrateButton: HTMLButtonElement;
  exportButton: HTMLButtonElement;
  stlExportButton: HTMLButtonElement;
  openProjectButton: HTMLButtonElement;
  projectFileInput: HTMLInputElement;
  reviewProject(filename: string, solids: number, commands: number, example?: boolean): Promise<boolean>;
  resetButton: HTMLButtonElement;
  metricsExportButton: HTMLButtonElement;
  dominantHandSelect: HTMLSelectElement;
  tuningSensitivity: HTMLSelectElement;
  tuningActivation: HTMLSelectElement;
  tuningHover: HTMLSelectElement;
  testGestureButton: HTMLButtonElement;
  update(state: ControllerState, meshes?: ReadonlyMap<string, GeometryMesh>): void;
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
  ['union', 'Union', 'U', 'Join the selected solid with a second solid'],
  ['undo', 'Undo', 'Ctrl Z', 'Undo the last committed command (Ctrl+Z)'],
];

export function createUI(root: HTMLElement): WorkspaceUI {
  root.innerHTML = `
    <header class="app-header">
      <a class="brand" href="#" aria-label="Palmivo workspace"><span class="brand-mark"><i></i><i></i><i></i></span><span>palmivo<span class="brand-period">.</span></span></a>
      <div class="header-context"><span class="header-divider"></span><span>GESTURE CAD / LOCAL COMPILER</span><span class="version-tag">BUILD / 06</span></div>
      <div class="header-actions"><span class="local-indicator"><span class="status-dot"></span>CAD and camera stay local</span><button id="open-project" class="quiet-button" aria-label="Open project" title="Reopen a Palmivo project JSON">${icon('open')}<span>Open project</span></button><button id="export-project" class="quiet-button" aria-label="Export project">${icon('export')}<span>Export project</span></button><input id="project-file" type="file" accept=".json,application/json" aria-label="Open Palmivo project JSON" hidden></div>
    </header>
    <main class="workspace">
      <section class="workspace-heading"><div><div class="eyebrow">LOCAL SPATIAL WORKSPACE</div><h1>Shape with intent<span>.</span></h1><div class="example-actions"><button id="try-bushing" type="button" class="outline-button" disabled>Try the bushing</button><button id="try-camera" type="button" class="outline-button" disabled>Use my camera</button></div></div><div class="readiness" id="assets-status"><span class="readiness-icon">↻</span><div><strong>Preparing local assets</strong><span>Checking geometry & tracking runtime</span></div></div></section>
      <div class="workspace-grid">
        <aside class="tool-rail" aria-label="CAD tools"><div class="rail-label">TOOLS <span>01—08</span></div><div class="tool-list">${toolData.map(([tool,label,key,title]) => `${tool === 'select' || tool === 'undo' ? '<div class="tool-divider"></div>' : ''}<button class="tool-button" data-tool="${tool}" title="${title}" aria-label="${title}">${icon(tool)}<span>${label}</span><kbd>${key}</kbd></button>`).join('')}</div><div class="rail-bottom"><button data-tool="pause" class="tool-button pause-button">${icon('pause')}<span>Pause</span><kbd>␣</kbd></button><button id="reset-scene" class="reset-button">${icon('reset')}Reset workspace</button></div></aside>
        <section class="stage-shell" aria-label="3D scene">
          <div class="stage-toolbar"><div><span class="stage-dot"></span><span>MODEL SPACE</span><span id="scene-revision" class="stage-revision">REV 000</span></div><div class="stage-options"><span id="solid-count">0 solids</span><span class="stage-separator">/</span><span>mm</span><span class="stage-view">PERSPECTIVE</span></div></div>
          <div class="viewport-wrap"><div id="viewport" class="viewport"></div><div class="viewport-label"><span class="corner-mark"></span>WORLD SPACE <span>XY / Z FIXED</span></div><div id="scene-objects" class="scene-objects" aria-label="Scene solids"></div><div id="empty-scene" class="empty-scene"><span class="empty-glyph">${icon('box')}</span><h2>A space for your next idea.</h2><p>Choose <strong>Box</strong> or <strong>Cylinder</strong> to start building.</p><span>GESTURE CONTROL OR MOUSE & KEYBOARD</span></div><div class="scene-axis" aria-hidden="true"><span class="axis-y">Y</span><span class="axis-x">X</span><span class="axis-z">Z</span><i></i></div><div id="draft-badge" class="draft-badge" hidden><span></span>DRAFT PREVIEW</div></div>
          <div class="stage-bottom"><span><span class="status-dot"></span><span id="stage-state">Ready for your first command</span></span><span id="selection-label">NO SELECTION</span></div>
        </section>
        <aside class="inspector" aria-label="Command inspector">
          <div class="inspector-title"><h2>Command inspector</h2><span class="small-index">02</span></div>
          <div class="pipeline"><span class="pipeline-active">INPUT</span><i>→</i><span id="pipeline-draft">DRAFT</span><i>→</i><span id="pipeline-ast">AST</span><i>→</i><span>SOLID</span></div>
          <div class="instruction-card"><div class="instruction-caption">${icon('hand')}<span>NEXT ACTION</span></div><p id="instruction">Choose a primitive to begin. Enable your camera when you're ready for gesture control.</p><div class="gesture-hint">Open other hand · point · pinch</div></div>
          <section class="selected-panel"><div class="section-heading"><h3>Selected solid</h3><span id="selected-type">—</span></div><div id="selected-name" class="selected-name">Nothing selected</div><div class="property-grid"><span>POSITION <small>mm</small></span><strong id="selected-position">— / — / —</strong><span>UNIFORM SCALE</span><strong id="selected-scale">—</strong></div><div class="solid-dimensions" aria-label="Selected solid dimensions"><div><span id="dimensions-label">FINAL SIZE</span><small>X × Y × Z</small></div><strong id="selected-dimensions">—</strong></div><button id="export-stl" class="stl-export-button" aria-label="Export selected solid as STL" title="Select a committed solid to export" disabled>${icon('export')}<span>Export STL</span><small>mm coordinates</small></button></section>
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
              <label for="gesture-activation">Button activation<select id="gesture-activation"><option value="pinch">Pinch</option><option value="dwell">Dwell assist · two hands</option><option value="one-hand">One-hand dwell · no pinch</option></select></label>
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
    </main><div id="gesture-cursor" class="gesture-cursor" hidden><span></span></div><dialog id="project-review" class="project-review" aria-labelledby="project-review-title" aria-describedby="project-review-description"><form method="dialog"><div class="eyebrow">LOCAL PROJECT</div><h2 id="project-review-title">Replace this workspace?</h2><p id="project-review-description">Opening a project replaces the current scene. Export your current project first if you want to keep it.</p><div class="project-review-file"><strong id="project-review-filename"></strong><span id="project-review-summary"></span></div><p class="project-review-note">Only the saved geometry and command history are restored. Your hand calibration stays the same.</p><div class="project-review-actions"><button value="cancel" class="cancel-button" autofocus>Keep current scene</button><button value="replace" class="commit-button">Open saved project</button></div></form></dialog>`;

  const references = new Map<string, HTMLElement>();
  const q = <T extends HTMLElement>(selector: string): T => {
    let element = references.get(selector);
    if (!element) { element = root.querySelector<HTMLElement>(selector)!; references.set(selector, element); }
    return element as T;
  };
  const text = (element: HTMLElement, value: string) => { if (element.textContent !== value) element.textContent = value; };
  const paletteButtons = new Map<Tool, HTMLButtonElement>();
  root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(button => paletteButtons.set(button.dataset.tool as Tool, button));
  const sizePresetButtons = new Map<string, HTMLButtonElement>();
  const transformStepButtons = new Map<string, HTMLButtonElement>();
  const transformPanel = document.createElement('div');
  transformPanel.className = 'transform-steps'; transformPanel.hidden = true;
  transformPanel.setAttribute('aria-label', 'Precise preview adjustments; Commit to apply');
  for (const step of TRANSFORM_STEPS) {
    const button = document.createElement('button'); button.type = 'button';
    button.className = 'transform-step'; button.dataset.transformStep = step.key;
    button.textContent = step.label; button.setAttribute('aria-label', step.description);
    button.title = step.description + '. Preview only; choose Commit or Cancel.';
    transformPanel.append(button); transformStepButtons.set(step.key, button);
  }
  q('#export-stl').before(transformPanel);
  const presetsPanel = document.createElement('section');
  presetsPanel.className = 'size-presets'; presetsPanel.hidden = true;
  presetsPanel.setAttribute('aria-label', 'Precise creation sizes');
  presetsPanel.innerHTML = `<div class="section-heading"><h3>Precise size</h3><span>mm</span></div><div id="preset-dimensions" class="preset-dimensions"></div>`;
  for (const primitive of ['Box', 'Cylinder'] as const) {
    const group = document.createElement('div');
    group.className = 'preset-group'; group.dataset.primitive = primitive; group.hidden = true;
    const fields = primitive === 'Box' ? ['x', 'y', 'z'] : ['radius', 'height'];
    for (const field of fields) {
      const row = document.createElement('div'); row.className = 'preset-row';
      const label = document.createElement('span'); label.className = 'preset-field';
      label.textContent = field.length === 1 ? field.toUpperCase() : field === 'radius' ? 'Radius' : 'Height';
      row.append(label);
      for (const preset of SIZE_PRESETS.filter(p => p.primitive === primitive && p.field === field)) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'size-preset'; button.dataset.sizePreset = preset.key;
        button.textContent = String(preset.value); button.setAttribute('aria-label', `${primitive} ${preset.label}`);
        button.setAttribute('aria-pressed', 'false'); button.title = `${preset.label} · exact size before uniform scaling`;
        row.append(button); sizePresetButtons.set(preset.key, button);
      }
      group.append(row);
    }
    presetsPanel.append(group);
  }
  q('.selected-panel').after(presetsPanel);
  const reviewDialog = q<HTMLDialogElement>('#project-review');
  let finishReview: ((approved: boolean) => void) | null = null;
  reviewDialog.addEventListener('close', () => { const finish = finishReview; finishReview = null; finish?.(reviewDialog.returnValue === 'replace'); });
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
    const single = tuningActivation.value === 'one-hand';
    paletteButtons.get('scale')!.setAttribute('aria-label', single ? 'Scale with precise preview buttons' : 'Scale with two hands or precise preview buttons');
    paletteButtons.get('move')!.setAttribute('aria-label', single ? 'Move on the XY plane with precise preview buttons' : 'Move on the XY plane; pinch and drag, or use precise preview buttons');
    q('#activation-help').textContent = single ? 'One hand, no pinching. Hold over a button, then move off all buttons before the next action. Use precise Scale and Move buttons; Commit remains separate.' : tuningActivation.value === 'dwell' ? 'Dwell assist activates a hovered button after an intentional hold. Commit still requires choosing its button.' : 'Hover until the button is ready, then pinch. Release fully before the next click.';
    q('.gesture-hint').textContent = single ? 'One hand · hold · move away to rearm' : 'Open other hand · point · pinch';
  });
  const cursor = q('#gesture-cursor');
  let currentState: ControllerState | null = null;
  let currentMeshes: ReadonlyMap<string, GeometryMesh> | undefined;
  let selectedMeasurement: { id: string; mesh: GeometryMesh; scale: number; value: SolidMeasurements } | null = null;
  let selectedTool: Tool | null = null;
  let confirmation: { message: string; until: number; button: HTMLButtonElement | null } | null = null;
  let confirmationTimer: ReturnType<typeof setTimeout> | null = null;
  let manipulation: ManipulationFeedback | null = null;
  let feedbackGate = 'Show your pointer hand.';
  const objectButtons = new Map<string, { button: HTMLButtonElement; color: HTMLElement; name: HTMLElement; role: HTMLElement }>();
  const baseInstruction = (): string => {
    const state = currentState;
    if (!state) return 'Choose a primitive to begin.';
    if (tuningActivation.value === 'one-hand' && (state.draft?.kind === 'scale' || state.draft?.kind === 'move')) return 'Hold over a precise adjustment. Move off buttons to rearm. Commit applies; Cancel restores.';
    if (state.draft?.kind === 'create') return 'Choose exact sizes below, then Commit to create your solid. Cancel discards the preview.';
    if (state.draft?.kind === 'subtract') {
      const draft = state.draft;
      const target = state.scene.solids.find(s => s.id === draft.targetId)?.name ?? draft.targetId;
      const cutter = state.scene.solids.find(s => s.id === draft.cutterId)?.name;
      return cutter ? `Cutter selected: ${cutter}. Choose Commit to subtract from ${target}.` : `Target: ${target}. Select a different solid as the Cutter.`;
    }
    if (state.draft?.kind === 'union') {
      const { targetId, otherId } = state.draft;
      const target = state.scene.solids.find(solid => solid.id === targetId)?.name ?? targetId;
      const other = state.scene.solids.find(solid => solid.id === otherId)?.name;
      return other ? `Choose Commit to join ${target} and ${other}.` : `${target} selected. Choose the second solid to join.`;
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
    hint.hidden = !!context || currentState?.draft?.kind === 'create';
  };
  const updatePreviewFields = (state: ControllerState) => {
    currentState = state;
    const selected = state.scene.solids.find(solid => solid.id === state.selectedId);
    const position = state.draft?.kind === 'move' ? state.draft.position : selected?.position;
    const scale = state.draft?.kind === 'scale' ? state.draft.uniformScale : selected?.scale;
    text(q('#selected-position'), position ? position.map(value => value.toFixed(0)).join(' / ') : '— / — / —');
    text(q('#selected-scale'), scale !== undefined ? `${scale.toFixed(2)}×` : '—');
    const preview = state.draft && (state.draft.kind === 'move' || state.draft.kind === 'scale') && state.draft.targetId === selected?.id;
    const dimensionLabel = state.draft?.kind === 'subtract' ? 'TARGET SIZE' : state.draft?.kind === 'union' ? 'FIRST SOLID SIZE' : preview ? 'PREVIEW SIZE' : 'FINAL SIZE';
    text(q('#dimensions-label'), dimensionLabel);
    const measured = selectedMeasurement?.id === selected?.id ? selectedMeasurement : null;
    const factor = preview && state.draft?.kind === 'scale' && measured ? state.draft.uniformScale / measured.scale : 1;
    const dimensions = measured?.value.dimensions.map(value => value * factor);
    const formatted = dimensions?.map(value => Number(value.toFixed(2)).toString());
    const dimensionElement = q('#selected-dimensions');
    text(dimensionElement, formatted ? `${formatted.join(' × ')} mm` : '—');
    dimensionElement.setAttribute('aria-label', formatted ? `${dimensionLabel.toLowerCase()}: X ${formatted[0]}, Y ${formatted[1]}, Z ${formatted[2]} millimetres` : 'Dimensions unavailable');
    const ast = state.draft ? draftAST(state.draft) : state.lastCommand?.ast;
    const code = q('#ast-code');
    const nextCode = ast ? JSON.stringify(ast, null, 2) : '{\n  // Your gestures become\n  // structured instructions.\n}';
    if (code.textContent !== nextCode) { const scrollTop = code.scrollTop; code.textContent = nextCode; code.scrollTop = scrollTop; }
    renderPrimary();
  };
  const updateButtonStates = () => {
    if (!currentState) return;
    const state = currentState;
    const incompleteBoolean = (state.draft?.kind === 'subtract' && !state.draft.cutterId) || (state.draft?.kind === 'union' && !state.draft.otherId);
    for (const [tool, button] of paletteButtons) {
      const hasSelection = !!state.selectedId;
      const isBooleanTool = tool === 'subtract' || tool === 'union';
      button.disabled = tool === 'pause' ? state.busy : tool === 'cancel' ? !state.draft || state.busy : tool === 'commit' ? !state.draft || state.busy || state.paused || incompleteBoolean : state.busy || state.paused || !!state.draft || ((tool === 'move' || tool === 'scale' || isBooleanTool) && !hasSelection) || (isBooleanTool && state.scene.solids.length < 2) || (tool === 'undo' && !state.historyCount) || (['box', 'cylinder'].includes(tool) && state.scene.solids.length >= 10);
      button.classList.toggle('is-active', tool === selectedTool);
      button.setAttribute('aria-pressed', String(tool === selectedTool));
    }
    const pause = paletteButtons.get('pause')!;
    text(pause.querySelector<HTMLElement>('span')!, state.paused ? 'Resume' : 'Pause');
    const open = q<HTMLButtonElement>('#open-project');
    open.disabled = state.busy || !!state.draft;
    q<HTMLButtonElement>('#try-bushing').disabled = open.disabled;
    open.title = state.busy ? 'Wait for the current geometry operation to finish' : state.draft ? 'Commit or Cancel the current draft before opening a project' : 'Reopen a Palmivo project JSON';
    const stlExport = q<HTMLButtonElement>('#export-stl');
    const transform = state.draft?.kind === 'scale' || state.draft?.kind === 'move' ? state.draft : null;
    transformPanel.hidden = !transform;
    transformPanel.classList.toggle('is-move', transform?.kind === 'move');
    stlExport.hidden = !!transform;
    for (const step of TRANSFORM_STEPS) {
      const button = transformStepButtons.get(step.key)!;
      button.hidden = transform?.kind !== step.kind;
      button.disabled = !transform || state.busy || state.paused;
    }
    stlExport.disabled = state.busy || state.paused || !!state.draft || !selectedMeasurement || selectedMeasurement.id !== state.selectedId;
    stlExport.title = state.busy ? 'Wait for geometry execution to finish' : state.draft ? 'Commit or Cancel the preview before exporting STL' : state.paused ? 'Resume editing before exporting STL' : !selectedMeasurement ? 'Select a committed solid to export' : 'Export the selected committed surface with coordinates in millimetres. Keep project JSON for editable history.';
    const create = state.draft?.kind === 'create' ? state.draft : null;
    presetsPanel.hidden = !create;
    q('.inspector').classList.toggle('is-create-draft', !!create);
    for (const group of presetsPanel.querySelectorAll<HTMLElement>('.preset-group')) group.hidden = !create || group.dataset.primitive?.toLowerCase() !== create.solid.recipe.kind;
    const recipe = create?.solid.recipe;
    for (const preset of SIZE_PRESETS) {
      const button = sizePresetButtons.get(preset.key)!;
      const activeValue = recipe?.kind === 'box' && preset.primitive === 'Box' ? recipe.dimensions[preset.field === 'x' ? 0 : preset.field === 'y' ? 1 : 2]
        : recipe?.kind === 'cylinder' && preset.primitive === 'Cylinder' ? recipe[preset.field] : undefined;
      const pressed = String(activeValue === preset.value);
      if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
      button.disabled = !create || state.busy || state.paused;
    }
    text(q('#preset-dimensions'), recipe?.kind === 'box' ? `${recipe.dimensions.join(' × ')} mm` : recipe?.kind === 'cylinder' ? `R ${recipe.radius} × H ${recipe.height} mm` : '');
  };

  return {
    paletteButtons, sizePresetButtons, transformStepButtons,
    viewportHost: q('#viewport'), video,
    handCanvas: q<HTMLCanvasElement>('#hand-overlay'), cameraButton,
    exampleCameraButton: q<HTMLButtonElement>('#try-camera'),
    tryBushingButton: q<HTMLButtonElement>('#try-bushing'),
    calibrateButton: q<HTMLButtonElement>('#calibrate-button'),
    exportButton: q<HTMLButtonElement>('#export-project'),
    stlExportButton: q<HTMLButtonElement>('#export-stl'),
    openProjectButton: q<HTMLButtonElement>('#open-project'),
    projectFileInput: q<HTMLInputElement>('#project-file'),
    reviewProject(filename, solids, commands, example = false) {
      if (reviewDialog.open || finishReview) return Promise.resolve(false);
      text(q('#project-review-description'), example
        ? 'The example opens in this workspace. Your existing autosave remains available after reload.'
        : 'Opening a project replaces the current scene. Export your current project first if you want to keep it.');
      text(q('.project-review-note'), example
        ? 'Export your project to keep any changes you make to the example.'
        : 'Only the saved geometry and command history are restored. Your hand calibration stays the same.');
      text(q('#project-review button[value="replace"]'), example ? 'Open example' : 'Open saved project');
      text(q('#project-review-filename'), filename);
      text(q('#project-review-summary'), `${solids} solid${solids === 1 ? '' : 's'} · ${commands} saved command${commands === 1 ? '' : 's'}`);
      reviewDialog.returnValue = 'cancel';
      return new Promise<boolean>(resolve => { finishReview = resolve; reviewDialog.showModal(); });
    },
    resetButton: q<HTMLButtonElement>('#reset-scene'),
    metricsExportButton: q<HTMLButtonElement>('#metrics-export'),
    dominantHandSelect: q<HTMLSelectElement>('#dominant-hand'),
    tuningSensitivity: q<HTMLSelectElement>('#gesture-sensitivity'),
    tuningActivation,
    tuningHover: q<HTMLSelectElement>('#gesture-hover'),
    testGestureButton: q<HTMLButtonElement>('#test-gesture'),
    update(state, meshes) {
      currentState = state;
      if (meshes !== undefined) currentMeshes = meshes;
      const measuredSolid = state.scene.solids.find(solid => solid.id === state.selectedId);
      const mesh = measuredSolid && currentMeshes?.get(measuredSolid.id);
      if (!measuredSolid || !mesh) selectedMeasurement = null;
      else if (selectedMeasurement?.id !== measuredSolid.id || selectedMeasurement.mesh !== mesh || selectedMeasurement.scale !== measuredSolid.scale) {
        try { selectedMeasurement = { id: measuredSolid.id, mesh, scale: measuredSolid.scale, value: measureSolid(measuredSolid, mesh) }; }
        catch { selectedMeasurement = null; }
      }
      updateButtonStates();
      q('.inspector').classList.toggle('has-selection', !!measuredSolid);
      text(q('#scene-revision'), `REV ${String(state.scene.revision).padStart(3, '0')}`);
      text(q('#solid-count'), `${state.scene.solids.length} solid${state.scene.solids.length === 1 ? '' : 's'}`);
      q('#empty-scene').hidden = !!(state.scene.solids.length || state.draft);
      q('#draft-badge').hidden = !state.draft;
      q('#draft-badge').classList.toggle('is-busy', state.busy);
      const selected = state.scene.solids.find(solid => solid.id === state.selectedId);
      text(q('#selection-label'), selected ? selected.name.toUpperCase() : 'NO SELECTION');
      const objectList = q('#scene-objects');
      const booleanDraft = state.draft?.kind === 'subtract' || state.draft?.kind === 'union' ? state.draft : null;
      const isUnion = booleanDraft?.kind === 'union';
      const otherId = booleanDraft?.kind === 'subtract' ? booleanDraft.cutterId : booleanDraft?.otherId;
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
        button.disabled = state.busy || state.paused || (!!state.draft && !booleanDraft) || solid.id === booleanDraft?.targetId;
        const pressed = String(solid.id === state.selectedId);
        if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
        if (color.dataset.color !== solid.color) { color.style.background = solid.color; color.dataset.color = solid.color; }
        text(name, solid.name);
        const operandRole = solid.id === booleanDraft?.targetId ? (isUnion ? 'FIRST' : 'TARGET') : solid.id === otherId ? (isUnion ? 'SECOND' : 'CUTTER') : '';
        text(role, booleanDraft ? operandRole : solid.id === state.selectedId ? 'SELECTED' : '');
      }
      const target = state.scene.solids.find(solid => solid.id === booleanDraft?.targetId);
      const other = state.scene.solids.find(solid => solid.id === otherId);
      text(q('.selected-panel .section-heading h3'), booleanDraft ? 'Boolean operands' : 'Selected solid');
      text(q('#selected-name'), booleanDraft ? `${isUnion ? 'First solid' : 'Target'}: ${target?.name ?? '—'}` : selected?.name ?? 'Nothing selected');
      text(q('#selected-type'), booleanDraft ? (isUnion ? 'FIRST + SECOND' : 'TARGET − CUTTER') : selected?.recipe.kind.toUpperCase() ?? '—');
      q('.selected-panel').hidden = state.draft?.kind === 'create';
      q('.property-grid').hidden = !!booleanDraft;
      booleanSummary.hidden = !booleanDraft;
      text(booleanSummary, booleanDraft ? `${isUnion ? 'Second solid' : 'Cutter'}: ${other?.name ?? 'Choose a different solid'}` : '');
      booleanSummary.classList.toggle('has-cutter', !!other && !isUnion);
      booleanSummary.classList.toggle('has-join', !!other && isUnion);
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
      q('#try-camera').hidden = active;
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
      const total = tuningActivation.value === 'one-hand' ? 2 : 4;
      q('#calibration-status').textContent = active ? `${Math.min(total, step)} / ${total} · ${text}` : text;
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
    case 'union': return { type: 'Union', targetId: draft.targetId, otherId: draft.otherId ?? '(choose second solid)', resultId: draft.resultId };
  }
}
