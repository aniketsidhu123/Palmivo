// Developer-only visual checks. Vite serves this page; it is absent from dist.
// Tracking feedback is explicitly simulated. This fixture never requests a webcam.
import { Controller } from '../src/core/controller';
import { GeometryClient } from '../src/geometry/GeometryClient';
import { createUI } from '../src/ui/workspace';
import { CADViewport } from '../src/ui/viewport';

const ui = createUI(document.querySelector<HTMLElement>('#app')!);
const viewport = new CADViewport(ui.viewportHost);
const geometry = new GeometryClient();
const controller = new Controller(geometry);
const result = document.querySelector<HTMLOutputElement>('#appearance-result')!;
const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-appearance]')];
let preparing = false;
const stop = controller.subscribe(state => {
  ui.update(state, controller.meshes);
  viewport.update(state, controller.meshes);
});

function reset(): void {
  ui.clearManipulationFeedback(); ui.setSelectedTool(null); ui.setGestureCursor(0, 0, false, false);
  ui.setCameraState(false); controller.reset(); viewport.resetCamera();
  for (const button of ui.paletteButtons.values()) button.classList.remove('gesture-hover', 'action-confirmed');
  ui.stlExportButton.classList.remove('gesture-hover', 'action-confirmed');
  ui.setGestureFeedback({ hands: 'Fixture · no camera', pinch: 'Simulated state', gate: 'Camera off in this fixture.', target: 'No target', progress: 0 });
  ui.setStatus('Appearance fixture. Local geometry is real; tracking feedback is simulated.');
}

function tracking(target = 'No target', progress = 0): void {
  ui.setCameraState(true);
  ui.setTracking('Simulated two-hand state for appearance checks. No camera is accessed.');
  ui.setGestureFeedback({ hands: 'SIMULATED · two hands', pinch: 'SIMULATED · 0.20 / 0.40', gate: 'Fixture: toolbar armed. Fresh pinch can choose a tool.', target, progress });
}

async function makeBox(scale = 1): Promise<string> {
  controller.beginCreate('Box'); controller.applySizePreset('box:y:30'); controller.applySizePreset('box:z:40');
  if (!await controller.commit()) throw Error(controller.state.message);
  const id = controller.state.selectedId!;
  if (scale !== 1) {
    controller.beginScale(); controller.updateScale(scale);
    if (!await controller.commit()) throw Error(controller.state.message);
  }
  return id;
}

async function scaleDraft(): Promise<void> {
  await makeBox(1.4); controller.beginScale(); controller.updateScale(1.6);
  ui.setSelectedTool('scale'); tracking('Scale preview', 0);
}

async function run(action: string): Promise<void> {
  if (preparing) return;
  preparing = true; buttons.forEach(button => { button.disabled = true; });
  result.textContent = 'Preparing fixture state…';
  try {
    reset();
    switch (action) {
      case 'empty': break;
      case 'box':
        controller.beginCreate('Box'); controller.applySizePreset('box:y:30'); controller.applySizePreset('box:z:40');
        ui.setSelectedTool('box'); tracking('Box Z · 40 mm', .6); break;
      case 'scaled': await makeBox(1.4); break;
      case 'active':
        await scaleDraft(); ui.setManipulationFeedback('scale', 'active', 1.6); break;
      case 'held':
        await scaleDraft(); ui.setManipulationFeedback('scale', 'held', 1.6); break;
      case 'subtract': {
        const target = await makeBox(1.4);
        controller.beginCreate('Cylinder'); controller.applySizePreset('cylinder:radius:3');
        if (!await controller.commit()) throw Error(controller.state.message);
        const cutter = controller.state.selectedId!;
        controller.select(target); controller.beginSubtract(); controller.chooseCutter(cutter);
        ui.setSelectedTool('subtract'); tracking('Commit', 1); break;
      }
      case 'lost':
        await makeBox(1.4); controller.beginMove(); controller.updateMove([5, 3, 0]);
        tracking(); ui.setTracking('Tracking lost · simulated occlusion');
        ui.setGestureFeedback({ hands: 'SIMULATED · hand missing', pinch: 'Unavailable', gate: 'Show both hands and release pinches to resume.', target: 'No target', progress: 0 });
        ui.setManipulationFeedback('move', 'paused'); break;
      case 'paused': await makeBox(1.4); controller.setPaused(true); tracking(); break;
      case 'busy':
        await makeBox(1.4); controller.beginCreate('Cylinder');
        // UI-only busy state: no artificial worker job or delay is introduced.
        ui.update({ ...controller.state, busy: true, message: 'Simulated geometry execution…' }, controller.meshes); break;
      case 'confirm':
        await makeBox(1.4); tracking('Export STL', 1);
        ui.confirmAction('STL download started. Import coordinates as millimetres.', ui.stlExportButton); break;
      case 'hover':
        await makeBox(1.4); tracking('Export STL', 1);
        ui.stlExportButton.classList.add('gesture-hover');
        ui.setGestureFeedback({ hands: 'SIMULATED · two hands', pinch: 'SIMULATED · released', gate: 'Ready — hold steady to activate.', target: 'Export STL', progress: 1 }); break;
      case 'preview': {
        await scaleDraft();
        const button = document.querySelector('[data-solid-id]');
        const before = { ...viewport.diagnostics };
        for (let sample = 0; sample < 100; sample++) controller.updateScale(1.2 + sample / 1000);
        const stable = button === document.querySelector('[data-solid-id]')
          && before.geometryCreations === viewport.diagnostics.geometryCreations
          && before.outlineCreations === viewport.diagnostics.outlineCreations;
        ui.setManipulationFeedback('scale', 'held', 1.299);
        result.textContent = stable ? 'PASS: stable object button, geometry and outline across 100 preview samples.' : 'FAIL: preview replaced a stable resource.';
        return;
      }
      case 'review': {
        await makeBox(1.4);
        const accepted = await ui.reviewProject('example.json', 1, 4);
        result.textContent = accepted ? 'Review returned Open saved project. Fixture scene unchanged.' : 'Review cancelled. Fixture scene unchanged.';
        return;
      }
      default: throw Error(`Unknown fixture state: ${action}`);
    }
    result.textContent = `Ready: ${action}. Simulated tracking only; no camera access.`;
  } catch (error) {
    result.textContent = `Fixture error: ${error instanceof Error ? error.message : 'Unknown error'}`;
  } finally {
    preparing = false; buttons.forEach(button => { button.disabled = false; });
  }
}

for (const button of buttons) button.addEventListener('click', () => void run(button.dataset.appearance!));
buttons.forEach(button => { button.disabled = true; });
try {
  await geometry.build({ kind: 'box', dimensions: [1, 1, 1] });
  ui.setAssetsReady(true); await run('empty');
} catch (error) {
  result.textContent = `Geometry initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
  buttons.forEach(button => { button.disabled = false; });
}
window.addEventListener('beforeunload', () => { stop(); geometry.dispose(); viewport.dispose(); });
