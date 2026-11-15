import './ui/style.css';
import { Controller } from './core/controller';
import { GeometryClient } from './geometry/GeometryClient';
import { TrackingClient } from './tracking/client';
import { GestureRecognizer, DEFAULT_PROFILE, sanitizeProfile } from './tracking/gestures';
import { CalibrationSession } from './tracking/calibration';
import { TargetActivation } from './tracking/activation';
import { ScaleSession } from './tracking/manipulation';
import { TRACKING_GAP_MS } from './tracking/gestures';
import { PresentationCoordinator } from './core/presentation';
import { recoverProject } from './core/recovery';
import { createUI } from './ui/workspace';
import { CADViewport } from './ui/viewport';
import { loadProject, saveProject } from './storage';
import { Measurements, downloadJSON } from './metrics';
import { recordDemo } from './recording';
import type { CalibrationProfile, GestureOutput, Tool, TrackingFrame, Vec3 } from './shared/types';

const ui = createUI(document.querySelector<HTMLDivElement>('#app')!);
const backendInfo = document.createElement('div'); backendInfo.className = 'runtime-caption';
backendInfo.append('TRACKING BACKEND / '); const backendValue = document.createElement('span'); backendValue.dataset.metric = 'backend'; backendValue.textContent = 'uninitialized'; backendInfo.append(backendValue);
document.querySelector('.runtime-panel')!.append(backendInfo);
const measurements = new Measurements();
const geometry = new GeometryClient();
const controller = new Controller({ build: async recipe => {
  const start = performance.now();
  try { return await geometry.build(recipe); }
  finally { measurements.add(recipe.kind === 'subtract' ? 'boolean_ms' : 'primitive_ms', performance.now() - start); }
} });
const viewport = new CADViewport(ui.viewportHost);
viewport.onFrame = ms => measurements.add('render_frame_ms', ms);
let profile: CalibrationProfile = { ...DEFAULT_PROFILE };
let hasSavedCalibration = false;
try { const saved = localStorage.getItem('signtoast-calibration'); if (saved) { profile = sanitizeProfile(JSON.parse(saved)); hasSavedCalibration = true; } } catch { /* Defaults work without storage. */ }
let calibratedProfile = { ...profile };
type Sensitivity = 'standard' | 'easier' | 'precise' | 'calibrated';
let tuning: { sensitivity: Sensitivity; mode: 'pinch' | 'dwell'; hoverMs: number } = { sensitivity: 'easier', mode: 'pinch', hoverMs: 350 };
try {
  const saved = JSON.parse(localStorage.getItem('signtoast-input-settings') || 'null');
  if (saved) tuning = { sensitivity: ['standard','easier','precise','calibrated'].includes(saved.sensitivity) ? saved.sensitivity : 'easier', mode: saved.mode === 'dwell' ? 'dwell' : 'pinch', hoverMs: [200,350,500].includes(saved.hoverMs) ? saved.hoverMs : 350 };
} catch { /* Use the accessible default. */ }
function tunedProfile(base: CalibrationProfile): CalibrationProfile {
  const presets = { standard: [.32, .52], easier: [.40, .62], precise: [.25, .42], calibrated: [base.pinchClose, base.pinchOpen] };
  const [pinchClose, pinchOpen] = presets[tuning.sensitivity];
  return sanitizeProfile({ ...base, dominantHand: profile.dominantHand, pinchClose, pinchOpen });
}
profile = tunedProfile(calibratedProfile);
const recognizer = new GestureRecognizer(profile);
let buttonActivation = new TargetActivation({ mode: tuning.mode, hoverMs: tuning.hoverMs, maxCaptureDriftPx: 64 });
ui.tuningSensitivity.value = tuning.sensitivity; ui.tuningActivation.value = tuning.mode; ui.tuningHover.value = String(tuning.hoverMs);
ui.tuningActivation.dispatchEvent(new Event('change'));
ui.dominantHandSelect.value = profile.dominantHand;
let lastDraft: object | null = null;
let selectionMode = false;
let moving: { anchor: Vec3; position: Vec3; source: 'pointer' | 'gesture' } | null = null;
let scaling: ScaleSession | null = null;
let movePhase: 'ready' | 'active' | 'held' | 'paused' = 'ready';
let lastValidGestureAt = -Infinity;
let highlightedButton: HTMLButtonElement | null = null;
let lastTargetId: string | null = null;
let lastHoverCursor: { x: number; y: number } | null = null;
let clickCursorLock: { x: number; y: number } | null = null;
let handFeedback = 'Camera off';
let testClickCount = 0;
let lastFrameAt = 0;
let cameraRunning = false;
let calibration: { stage: number; cyclesAtStart: number; started: number; session: CalibrationSession } | null = null;
let lastGesture: GestureOutput | null = null;
let gesturePaused = false;
let assetReady = false;
let persistenceReady = false;
let initialized = false;
ui.resetButton.disabled = true;
const useMappingButton = document.createElement('button');
useMappingButton.className = 'outline-button'; useMappingButton.id = 'use-current-mapping'; useMappingButton.textContent = 'Use current mapping'; useMappingButton.hidden = true;
ui.calibrateButton.after(useMappingButton);
useMappingButton.addEventListener('click', () => {
  calibration = null; useMappingButton.hidden = true; recognizer.reset(); resetActivation();
  ui.setCalibration('Using current mapping. Try Test click before editing; Calibrate remains available.', 0);
});

const presentation = new PresentationCoordinator({
  full: state => { ui.update({ ...state, busy: state.busy || !initialized }); viewport.update(state, controller.meshes); },
  renderPreview: state => viewport.updatePreview(state),
  preview: state => ui.updatePreview(state),
  persist: scene => { void saveProject(scene).catch(() => ui.setStatus('Local autosave unavailable. Export your project before closing.')); },
});
controller.subscribe(state => {
  if (lastDraft !== state.draft) {
    moving = null; scaling = state.draft?.kind === 'scale' ? new ScaleSession(state.draft.uniformScale) : null;
    movePhase = 'ready'; lastDraft = state.draft; ui.clearManipulationFeedback();
  }
  presentation.update(state, initialized, persistenceReady);
  presentManipulation();
});

async function runTool(tool: Tool, source: 'pointer' | 'gesture-rules' | 'keyboard' = 'pointer') {
  if (!initialized) { ui.setStatus('Preparing local engines and restoring the saved scene. Please wait.'); return; }
  if (calibration && source === 'gesture-rules') return;
  const beforeDraft = controller.state.draft;
  const beforeHistory = controller.state.historyCount;
  moving = null; movePhase = 'ready';
  if (source !== 'gesture-rules') resetActivation();
  const button = ui.paletteButtons.get(tool);
  if (tool === 'pause') { controller.setPaused(!controller.state.paused); ui.confirmAction(controller.state.paused ? 'Editing paused.' : 'Editing resumed.', button); return; }
  if (tool === 'cancel') { controller.cancel(); selectionMode = false; ui.setSelectedTool(null); if (beforeDraft && !controller.state.draft) ui.confirmAction('Preview cancelled. Committed scene preserved.', button); return; }
  if (controller.state.paused || controller.state.busy) return;
  selectionMode = tool === 'select';
  if (tool === 'box') controller.beginCreate('Box');
  if (tool === 'cylinder') controller.beginCreate('Cylinder');
  if (tool === 'move') controller.beginMove();
  if (tool === 'scale') controller.beginScale();
  if (tool === 'subtract') controller.beginSubtract();
  if (tool === 'undo') controller.undo();
  if (tool === 'commit') {
    const start = performance.now(); const committed = await controller.commit(source); measurements.add('command_completion_ms', performance.now() - start);
    if (committed) ui.confirmAction(controller.state.lastCommand?.ast.type === 'Subtract' ? 'Subtraction complete. Solid saved.' : `${controller.state.lastCommand?.ast.type} committed.`, button);
  }
  const draft = controller.state.draft;
  if (draft && draft !== beforeDraft) {
    const message = draft.kind === 'create' ? `${draft.solid.name} ready. Choose Commit to create it.` : draft.kind === 'scale' ? 'Scale ready. Pinch both hands, then change their separation.' : draft.kind === 'move' ? 'Move ready. Pinch and drag the selected solid.' : 'Target chosen. Select a different solid as the cutter.';
    ui.confirmAction(message, button);
  }
  if (tool === 'undo' && controller.state.historyCount < beforeHistory) ui.confirmAction('Undo restored the previous scene.', button);
  ui.setSelectedTool(selectionMode ? 'select' : tool === 'commit' || tool === 'undo' ? null : tool);
  if (selectionMode) { ui.setStatus('Point at a solid and pinch, or choose it in the scene list.'); ui.confirmAction('Select a solid in the scene or object list.', button); }
}
for (const [tool, button] of ui.paletteButtons) button.addEventListener('click', () => void runTool(tool));

function selectSolid(id: string, button: HTMLButtonElement | null = null) {
  if (controller.state.busy || controller.state.paused) return;
  const solid = controller.state.scene.solids.find(item => item.id === id); if (!solid) return;
  if (controller.state.draft?.kind === 'subtract') {
    const previousCutter = controller.state.draft.cutterId;
    controller.chooseCutter(id);
    if (controller.state.draft?.kind === 'subtract' && controller.state.draft.cutterId === id) ui.confirmAction(previousCutter === id ? `${solid.name} is already the cutter. Choose Commit.` : `Cutter selected: ${solid.name}. Choose Commit to subtract.`, button);
  } else if (!controller.state.draft) { controller.select(id); ui.confirmAction(`${solid.name} selected.`, button); }
}
document.querySelector('#app')!.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-solid-id]');
  if (button?.dataset.solidId && !button.disabled) selectSolid(button.dataset.solidId, button);
});

function beginMove(x: number, y: number, source: 'pointer' | 'gesture' = 'gesture') {
  const draft = controller.state.draft;
  if (draft?.kind !== 'move') return;
  const anchor = viewport.pointOnPlane(x, y, draft.position[2]);
  if (anchor) { moving = { anchor, position: [...draft.position], source }; movePhase = 'active'; presentManipulation(); }
}
function moveTo(x: number, y: number) {
  if (!moving) return;
  const point = viewport.pointOnPlane(x, y, moving.position[2]);
  if (point) controller.updateMove([moving.position[0] + point[0] - moving.anchor[0], moving.position[1] + point[1] - moving.anchor[1], moving.position[2]]);
}
function inViewport(x: number, y: number): boolean {
  const r = ui.viewportHost.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}
ui.viewportHost.addEventListener('pointerdown', event => {
  if (event.button !== 0 || controller.state.busy || controller.state.paused) return;
  const hit = viewport.pick(event.clientX, event.clientY);
  if (controller.state.draft?.kind === 'move') { beginMove(event.clientX, event.clientY, 'pointer'); ui.viewportHost.setPointerCapture(event.pointerId); }
  else if (hit) selectSolid(hit);
});
ui.viewportHost.addEventListener('pointermove', event => { if (event.buttons & 1) moveTo(event.clientX, event.clientY); });
ui.viewportHost.addEventListener('pointerup', () => { moving = null; movePhase = 'held'; presentManipulation(); });
ui.viewportHost.addEventListener('pointercancel', () => { moving = null; movePhase = 'held'; presentManipulation(); });
function manualScale(value: number) {
  controller.updateScale(value);
  if (controller.state.draft?.kind === 'scale') scaling?.reset(controller.state.draft.uniformScale);
}
ui.viewportHost.addEventListener('wheel', event => {
  if (controller.state.draft?.kind !== 'scale') return;
  event.preventDefault(); manualScale(controller.state.draft.uniformScale * Math.exp(-event.deltaY * .001));
}, { passive: false });

document.addEventListener('keydown', event => {
  if ((event.target as HTMLElement).matches('input, select, textarea') || event.repeat) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); void runTool('undo', 'keyboard'); return; }
  const keys: Record<string, Tool> = { b: 'box', c: 'cylinder', v: 'select', m: 'move', s: 'scale', d: 'subtract', Escape: 'cancel', Enter: 'commit', ' ': 'pause' };
  const tool = keys[event.key]; if (tool) { event.preventDefault(); void runTool(tool, 'keyboard'); }
  if (controller.state.draft?.kind === 'scale' && ['+', '=', '-'].includes(event.key)) { event.preventDefault(); manualScale(controller.state.draft.uniformScale + (event.key === '-' ? -.1 : .1)); }
});

function drawHands(frame: TrackingFrame) {
  const canvas = ui.handCanvas; if (canvas.width !== frame.width) canvas.width = frame.width; if (canvas.height !== frame.height) canvas.height = frame.height;
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const edges = [[0,1,2,3,4],[0,5,6,7,8],[5,9,10,11,12],[9,13,14,15,16],[13,17,18,19,20],[0,17]];
  for (const hand of frame.hands) {
    ctx.strokeStyle = hand.handedness === profile.dominantHand ? '#c5f2bd' : '#ffcb8a'; ctx.lineWidth = 2;
    for (const chain of edges) { ctx.beginPath(); chain.forEach((index, i) => { const point = hand.landmarks[index]; if (i) ctx.lineTo(point.x * canvas.width, point.y * canvas.height); else ctx.moveTo(point.x * canvas.width, point.y * canvas.height); }); ctx.stroke(); }
    for (const point of hand.landmarks) { ctx.beginPath(); ctx.arc(point.x * canvas.width, point.y * canvas.height, 2.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); }
  }
}

function resetActivation() {
  buttonActivation.reset(); lastTargetId = null; lastHoverCursor = null; clickCursorLock = null;
  highlightedButton?.classList.remove('gesture-hover'); highlightedButton = null;
}
function buttonId(button: HTMLButtonElement): string | null {
  if (button === ui.testGestureButton) return 'test:click';
  const tool = [...ui.paletteButtons].find(([, element]) => element === button)?.[0];
  return tool ? `tool:${tool}` : button.dataset.solidId ? `solid:${button.dataset.solidId}` : null;
}
function resolveButton(id: string | null): HTMLButtonElement | null {
  if (!id) return null;
  if (id === 'test:click') return ui.testGestureButton;
  if (id.startsWith('tool:')) return ui.paletteButtons.get(id.slice(5) as Tool) || null;
  return [...document.querySelectorAll<HTMLButtonElement>('[data-solid-id]')].find(button => button.dataset.solidId === id.slice(6)) || null;
}
function eligible(button: HTMLButtonElement | null): button is HTMLButtonElement {
  return !!button && !button.disabled && (!calibration || button === ui.testGestureButton) && !!buttonId(button) && button.getBoundingClientRect().width > 0;
}
function hitButton(x: number, y: number): HTMLButtonElement | null {
  const direct = document.elementFromPoint(x, y)?.closest<HTMLButtonElement>('button') || null;
  if (eligible(direct)) return direct;
  // Only retain an already acquired target; never acquire a new neighbour through its margin.
  const previous = resolveButton(lastTargetId);
  if (eligible(previous) && !direct) {
    const r = previous.getBoundingClientRect(), margin = 14;
    if (x >= r.left - margin && x <= r.right + margin && y >= r.top - margin && y <= r.bottom + margin) return previous;
  }
  return null;
}
function testClick(source: 'gesture' | 'mouse') {
  ui.setGestureTestCount(++testClickCount);
  ui.testGestureButton.dataset.lastInput = source;
  ui.setStatus(`${source === 'gesture' ? 'Gesture' : 'Mouse'} test click ${testClickCount} registered. Practice here before editing.`);
  ui.confirmAction(`${source === 'gesture' ? 'Gesture' : 'Mouse'} test click ${testClickCount} registered.`, ui.testGestureButton);
}
ui.testGestureButton.addEventListener('click', () => testClick('mouse'));

function presentManipulation() {
  const state = controller.state;
  if (!cameraRunning || calibration || state.busy || state.paused) { ui.clearManipulationFeedback(); return; }
  if (state.draft?.kind === 'scale') ui.setManipulationFeedback('scale', scaling?.phase || 'ready', state.draft.uniformScale);
  else if (state.draft?.kind === 'move') ui.setManipulationFeedback('move', movePhase);
  else ui.clearManipulationFeedback();
}
function handleGesture(output: GestureOutput) {
  try { processGesture(output); } finally { presentManipulation(); }
}
function processGesture(output: GestureOutput) {
  lastGesture = output;
  const ratio = output.dominantRatio;
  const pinchFeedback = ratio === undefined || !Number.isFinite(ratio) ? 'Pointer hand not detected' : `${ratio.toFixed(2)} · close ≤${profile.pinchClose.toFixed(2)} / release ≥${profile.pinchOpen.toFixed(2)} · ${output.dominantPinched ? 'PINCHED' : output.pinchClosing ? 'CLOSING' : 'OPEN'}`;
  if (!output.trackingReady || !output.cursor || !cameraRunning) {
    scaling?.update(output);
    if (moving?.source === 'gesture') {
      movePhase = 'paused';
      if (output.trackingLost || output.timestamp - lastValidGestureAt >= TRACKING_GAP_MS) moving = null;
    }
    buttonActivation.update({ timestamp: output.timestamp, targetId: null, trackingReady: false, toolbarArmed: false, pinched: output.dominantPinched, pinchStarted: false, pinchReleased: false, cursor: null });
    lastTargetId = null; clickCursorLock = null; highlightedButton?.classList.remove('gesture-hover'); highlightedButton = null;
    ui.setGestureCursor(0, 0, false, false);
    const gate = cameraRunning ? output.trackingLost ? 'Show both hands fully in frame.' : 'Release both pinches and hold hands steady briefly.' : 'Enable the camera to test your input.';
    ui.setGestureFeedback({ hands: handFeedback, pinch: pinchFeedback, gate, target: 'No target', progress: 0 });
    if (output.trackingLost) { gesturePaused = true; ui.setTracking('Tracking paused · show both hands'); }
    return;
  }
  gesturePaused = false;
  lastValidGestureAt = output.timestamp;
  const x = output.cursor.x * window.innerWidth, y = output.cursor.y * window.innerHeight;
  const hit = hitButton(x, y);
  const activation = buttonActivation.update({ timestamp: output.timestamp, targetId: hit ? buttonId(hit) : null, trackingReady: true, toolbarArmed: output.toolbarArmed, pinched: output.dominantPinched, pinchStarted: output.pinchStarted, pinchReleased: output.pinchReleased, pinchClosing: output.pinchClosing, cursor: { x, y } });
  const target = resolveButton(activation.targetId);
  lastTargetId = activation.targetId;
  if (highlightedButton !== target) { highlightedButton?.classList.remove('gesture-hover'); highlightedButton = target; highlightedButton?.classList.add('gesture-hover'); }
  if (!output.dominantPinched && !output.pinchClosing) { clickCursorLock = null; if (target) lastHoverCursor = { x, y }; }
  else if (target && !output.bothPinched && lastHoverCursor) clickCursorLock ??= { ...lastHoverCursor };
  if (output.bothPinched) clickCursorLock = null;
  const visual = clickCursorLock || { x, y };
  ui.setGestureCursor(visual.x, visual.y, true, output.toolbarArmed);
  const phases: Record<string, string> = { 'tracking-lost': 'Show both hands.', 'gate-closed': 'Open your other palm; keep at least three fingers straight.', release: 'Fully separate thumb and index finger to rearm.', idle: 'Aim at a button.', hover: 'Hold steady while the progress bar fills.', ready: tuning.mode === 'pinch' ? 'Ready — pinch thumb and index finger.' : 'Hold steady to activate.', closing: 'Pinch detected — target held steady.', activated: 'Click registered. Release before your next click.', 'leave-targets': 'Move away from the buttons to rearm dwell.' };
  const gate = !output.toolbarArmed ? output.otherRatio !== undefined && output.otherRatio < profile.pinchOpen ? `Spread your other thumb and index apart: ${output.otherRatio.toFixed(2)} / ${profile.pinchOpen.toFixed(2)} required.` : !output.otherOpen ? 'Straighten at least three fingers on your other hand.' : 'Hold your other palm open briefly.' : phases[activation.phase] || 'Ready';
  ui.setTracking(output.toolbarArmed ? `Toolbar armed · ${tuning.mode === 'dwell' ? 'dwell assist' : 'pinch to select'}` : 'Two hands tracked · open other hand for tools');
  ui.setGestureFeedback({ hands: handFeedback, pinch: pinchFeedback, gate, target: target?.textContent?.replace(/\s+/g, ' ').trim() || 'No target', progress: activation.progress });
  if (activation.activate) {
    const button = resolveButton(activation.activate);
    if (!eligible(button)) return;
    if (button === ui.testGestureButton) testClick('gesture');
    else if (activation.activate.startsWith('tool:')) void runTool(activation.activate.slice(5) as Tool, 'gesture-rules');
    else if (button.dataset.solidId) selectSolid(button.dataset.solidId, button);
    return;
  }
  if (calibration) return;
  // A pinch intended for a control must never also grab geometry behind it.
  if (!output.bothPinched && (hit || activation.targetId || clickCursorLock)) {
    scaling?.update(output);
    if (moving?.source === 'gesture') { moving = null; movePhase = 'held'; }
    return;
  }
  if (controller.state.busy || controller.state.paused || (controller.state.draft?.kind !== 'scale' && !inViewport(x, y))) {
    if (moving?.source === 'gesture') { moving = null; movePhase = 'held'; }
    return;
  }
  const draft = controller.state.draft;
  if (draft?.kind === 'scale') {
    scaling ??= new ScaleSession(draft.uniformScale);
    const preview = scaling.update(output);
    if (preview.changed) controller.updateScale(preview.value);
  } else if (draft?.kind === 'move') {
    if (moving?.source === 'pointer') return;
    if (output.pinchOpening) { moving = null; movePhase = 'held'; return; }
    if (output.pinchStarted) beginMove(x, y);
    if (output.dominantPinched && moving) { movePhase = 'active'; moveTo(x, y); }
    else if (!output.dominantPinched) { if (moving) movePhase = 'held'; moving = null; }
  } else if (output.pinchStarted) { const id = viewport.pick(x, y); if (id) selectSolid(id); }
}

function beginCalibration() {
  if (!cameraRunning) { ui.setStatus('Enable the camera before calibration.'); return; }
  controller.cancel(); recognizer.reset();
  moving = null; scaling = null; resetActivation();
  calibration = { stage: 0, cyclesAtStart: 0, started: performance.now(), session: new CalibrationSession(profile) };
  useMappingButton.hidden = false;
  ui.setCalibration('Show both hands with fingers open for one second.', 1);
}
function calibrateFrame(frame: TrackingFrame, output: GestureOutput) {
  const c = calibration; if (!c) return;
  const progress = c.session.update(frame);
  if (!progress.bothHandsVisible) { ui.setCalibration('Keep both hands visible while calibrating.', c.stage + 1); return; }
  if (c.stage === 0 && output.trackingReady && progress.otherHandVerified && frame.timestamp - c.started >= 1000) {
    c.stage = 1; c.started = frame.timestamp;
    ui.setCalibration('Sweep your pointer hand left/right and up/down across a comfortable area for 4 seconds.', 2);
  }
  if (c.stage === 1) {
    if (frame.timestamp - c.started > 4000) {
      if (!progress.rangeReady) { ui.setCalibration('Sweep a wider area: move your pointer hand left/right and up/down.', 2); return; }
      c.stage = 2; c.cyclesAtStart = progress.pinchCycles;
      ui.setCalibration('Pinch and fully release your pointer hand three times.', 3);
    }
  } else if (c.stage === 2) {
    const cycles = progress.pinchCycles - c.cyclesAtStart;
    if (cycles < 3) ui.setCalibration(`Pinch and fully release · ${cycles}/3 complete.`, 3);
    else { c.stage = 3; ui.setCalibration('Open your other hand to arm the toolbar.', 4); }
  } else if (c.stage === 3 && output.toolbarArmed) {
    try { calibratedProfile = c.session.finish(); }
    catch (error) { ui.setCalibration(error instanceof Error ? error.message : 'Please complete the calibration steps.', 4); return; }
    profile = tunedProfile(calibratedProfile); recognizer.setProfile(profile); resetActivation(); hasSavedCalibration = true;
    try { localStorage.setItem('signtoast-calibration', JSON.stringify(calibratedProfile)); } catch { /* Profile remains valid for this session. */ }
    calibration = null; useMappingButton.hidden = true; ui.setCalibration('Calibration complete. Hover a tool, then pinch.', 4);
    setTimeout(() => { if (!calibration) ui.setCalibration('', 0); }, 3500);
  }
}

const tracking = new TrackingClient({
  onStatus: status => {
    ui.setTracking(status.message);
    if (status.state === 'error') {
      cameraRunning = false; calibration = null; useMappingButton.hidden = true; moving = null; scaling = null; resetActivation();
      ui.clearManipulationFeedback();
      recognizer.reset(); ui.setGestureCursor(0, 0, false, false); ui.setCalibration('', 0);
      ui.handCanvas.getContext('2d')?.clearRect(0, 0, ui.handCanvas.width, ui.handCanvas.height);
      ui.setCameraState(false); ui.setStatus(status.message);
    }
  },
  onFrame: frame => {
    handFeedback = frame.hands.length ? frame.hands.map(hand => `${hand.handedness} ${Math.round(hand.score * 100)}%`).join(' · ') : 'No hands detected';
    lastFrameAt = performance.now(); drawHands(frame); measurements.add('landmark_ms', frame.inferenceMs);
    const start = performance.now(); const output = recognizer.process(frame);
    const wasCalibrating = calibration !== null;
    calibrateFrame(frame, output);
    // Completing calibration changes the coordinate map and resets recognition: do not execute
    // an edge produced under the previous profile on that same frame.
    if (wasCalibrating && calibration === null) ui.setGestureCursor(0, 0, false, false);
    else handleGesture(output);
    measurements.add('rules_to_draft_ms', performance.now() - start);
  },
});
ui.cameraButton.addEventListener('click', async () => {
  if (cameraRunning) { tracking.stop(); cameraRunning = false; calibration = null; useMappingButton.hidden = true; moving = null; scaling = null; movePhase = 'ready'; recognizer.reset(); resetActivation(); ui.clearManipulationFeedback(); ui.setCameraState(false); ui.setGestureCursor(0, 0, false, false); ui.setCalibration('', 0); return; }
  ui.cameraButton.disabled = true;
  try { if (!assetReady) throw Error('Local tracking assets are not ready. Reload or check your release files.'); await tracking.start(ui.video); cameraRunning = true; ui.setCameraState(true); resetActivation(); if (!hasSavedCalibration && tuning.mode === 'pinch') beginCalibration(); else ui.setCalibration(hasSavedCalibration ? 'Saved mapping loaded. Use Test click before editing.' : 'Using default mapping with dwell assist. Calibrate if the pointer cannot reach the tools.', 0); }
  catch (error) { ui.setStatus(error instanceof Error ? error.message : 'Camera could not start.'); }
  finally { ui.cameraButton.disabled = false; }
});
ui.calibrateButton.addEventListener('click', beginCalibration);
ui.dominantHandSelect.addEventListener('change', () => { profile = { ...profile, dominantHand: ui.dominantHandSelect.value === 'Left' ? 'Left' : 'Right' }; calibratedProfile = { ...calibratedProfile, dominantHand: profile.dominantHand }; recognizer.setProfile(profile); resetActivation(); try { localStorage.setItem('signtoast-calibration', JSON.stringify(calibratedProfile)); } catch {} if (cameraRunning) beginCalibration(); });
function changeTuning() {
  tuning = { sensitivity: ui.tuningSensitivity.value as Sensitivity, mode: ui.tuningActivation.value === 'dwell' ? 'dwell' : 'pinch', hoverMs: Number(ui.tuningHover.value) };
  profile = tunedProfile(calibratedProfile); recognizer.setProfile(profile);
  buttonActivation = new TargetActivation({ mode: tuning.mode, hoverMs: tuning.hoverMs, maxCaptureDriftPx: 64 }); resetActivation();
  moving = null; scaling = null;
  try { localStorage.setItem('signtoast-input-settings', JSON.stringify(tuning)); } catch {}
  if (tuning.mode === 'dwell' && calibration) { calibration = null; useMappingButton.hidden = true; ui.setCalibration('Dwell assist is using your current mapping. Hold over Test click to practice.', 0); }
  else if (calibration) beginCalibration();
  ui.setStatus(`Input tuned: ${tuning.sensitivity}, ${tuning.mode === 'dwell' ? 'dwell assist' : 'pinch'}, ${tuning.hoverMs} ms hover. Release your hands, then try Test click.`);
}
ui.tuningSensitivity.addEventListener('change', changeTuning);
ui.tuningActivation.addEventListener('change', changeTuning);
ui.tuningHover.addEventListener('change', changeTuning);
ui.exportButton.addEventListener('click', () => downloadJSON('SignToAST-project.json', controller.exportDocument()));
const snapshotButton = document.createElement('button');
snapshotButton.id = 'save-preview'; snapshotButton.textContent = 'Snapshot'; snapshotButton.title = 'Save the CAD viewport as a PNG image';
ui.metricsExportButton.before(snapshotButton);
snapshotButton.addEventListener('click', () => viewport.renderer.domElement.toBlob(blob => {
  if (!blob) return;
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'SignToAST-preview.png'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}));
const recordButton = document.createElement('button');
recordButton.className = 'quiet-button'; recordButton.id = 'record-demo'; recordButton.textContent = 'Record demo';
recordButton.title = 'Record CAD canvas and AST only; no webcam or audio';
ui.exportButton.before(recordButton);
let recording: ReturnType<typeof recordDemo> | null = null;
recordButton.addEventListener('click', async () => {
  try {
    if (!recording) { recording = recordDemo(viewport.renderer.domElement, () => controller.getDraftAST() || controller.state.lastCommand?.ast || null); recordButton.textContent = 'Stop recording'; ui.setStatus('Recording CAD canvas + AST locally. Webcam and audio are excluded.'); }
    else { const blob = await recording.stop(); recording = null; recordButton.textContent = 'Record demo'; const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'SignToAST-demo.webm'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); ui.setStatus('Demo recording downloaded.'); }
  } catch (error) { ui.setStatus(error instanceof Error ? error.message : 'Recording failed.'); }
});
ui.metricsExportButton.addEventListener('click', () => downloadJSON('SignToAST-measurements.json', { capturedAt: new Date().toISOString(), backend: tracking.backend, camera: tracking.stats, recognition: 'MediaPipe + temporal gesture rules', notes: 'Browser timings; not physical motion-to-action latency.', metrics: measurements.summary(), presentation: presentation.diagnostics, viewport: viewport.diagnostics }));
let resetArmedUntil = 0;
ui.resetButton.addEventListener('click', () => {
  if (performance.now() > resetArmedUntil) { resetArmedUntil = performance.now() + 3000; ui.setStatus('Click Reset again within 3 seconds to clear the local scene.'); return; }
  resetArmedUntil = 0; persistenceReady = true; controller.reset(); viewport.resetCamera(); ui.setSelectedTool(null);
});

setInterval(() => {
  if (cameraRunning && performance.now() - lastFrameAt > 150) handleGesture(recognizer.missing(performance.now()));
}, 100);
setInterval(() => {
  const metrics = measurements.summary();
  const value = (key: string) => metrics[key] ? `${metrics[key].p95.toFixed(1)} ms` : '—';
  ui.setMetrics({ render: metrics.render_frame_ms ? `${Math.round(1000 / metrics.render_frame_ms.p50)} fps` : '—', camera: `${tracking.stats.cameraFps.toFixed(0)} fps`, tracking: `${tracking.stats.trackingFps.toFixed(0)} fps`, landmark: value('landmark_ms'), compiler: value('rules_to_draft_ms'), geometry: value('boolean_ms'), dropped: String(tracking.stats.droppedFrames), backend: tracking.backend });
}, 500);

async function initialize() {
  try {
    const response = await fetch('/asset-manifest.json'); if (!response.ok) throw Error('Asset manifest missing');
    const manifest = await response.json() as { files: { path: string; bytes: number; sha256: string }[] };
    for (const item of manifest.files) {
      const file = await fetch(item.path); if (!file.ok) throw Error(`${item.path} missing`);
      const bytes = await file.arrayBuffer();
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      if (bytes.byteLength !== item.bytes || digest !== item.sha256) throw Error(`Asset verification failed: ${item.path}`);
    }
    await geometry.build({ kind: 'box', dimensions: [1, 1, 1] });
    assetReady = true; ui.setAssetsReady(true); ui.setStatus('Local runtimes verified. Enable the camera or use mouse and keyboard.');
  } catch (error) { ui.setStatus(`Local assets unavailable: ${error instanceof Error ? error.message : 'unknown error'}`); ui.setAssetsReady(false); }
  const recovery = await recoverProject(loadProject, saved => controller.restore(saved));
  persistenceReady = recovery.canAutosave;
  if (recovery.message) ui.setStatus(recovery.message);
  initialized = true;
  ui.resetButton.disabled = false;
  presentation.update(controller.state, initialized, persistenceReady);
}
void initialize();
window.addEventListener('beforeunload', () => { tracking.stop(); geometry.dispose(); viewport.dispose(); presentation.dispose(); });
