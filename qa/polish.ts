// Developer-only visual regression fixture. Vite serves this page; it is not in dist.
import { createUI } from '../src/ui/workspace';
import { CADViewport } from '../src/ui/viewport';
import { GeometryClient } from '../src/geometry/GeometryClient';
import { Controller } from '../src/core/controller';

const ui = createUI(document.querySelector<HTMLElement>('#app')!);
const viewport = new CADViewport(ui.viewportHost);
const geometry = new GeometryClient();
const controller = new Controller(geometry);
controller.subscribe(state => { ui.update(state); viewport.update(state, controller.meshes); });
controller.beginCreate('Box'); await controller.commit(); controller.beginScale(); controller.updateScale(1.4);
ui.setAssetsReady(true); ui.setCameraState(true); ui.setTracking('Simulated hand states for layout testing. No camera is accessed.');
ui.setGestureFeedback({ hands: 'Fixture', pinch: 'Simulated dual pinch', gate: 'Open your other hand', target: 'No target', progress: 0 });
ui.setManipulationFeedback('scale','active',1.4);
const result = document.querySelector<HTMLOutputElement>('#fixture-result')!; result.textContent = 'Ready';
document.querySelector('#fixture-active')!.addEventListener('click', () => ui.setManipulationFeedback('scale','active',controller.state.draft?.kind === 'scale' ? controller.state.draft.uniformScale : 1));
document.querySelector('#fixture-held')!.addEventListener('click', () => ui.setManipulationFeedback('scale','held',controller.state.draft?.kind === 'scale' ? controller.state.draft.uniformScale : 1));
document.querySelector('#fixture-confirm')!.addEventListener('click', () => ui.confirmAction('Cutter selected: Cylinder 1. Choose Commit.',ui.paletteButtons.get('commit')));
document.querySelector('#fixture-preview')!.addEventListener('click', () => {
  const button = document.querySelector('[data-solid-id]'); const geometryCount = viewport.diagnostics.geometryCreations; const outlineCount = viewport.diagnostics.outlineCreations;
  for(let i=0;i<100;i++) controller.updateScale(1.2 + i / 1000);
  const stable = button === document.querySelector('[data-solid-id]') && geometryCount === viewport.diagnostics.geometryCreations && outlineCount === viewport.diagnostics.outlineCreations;
  result.textContent = stable ? 'PASS: stable object buttons, geometry and outline across 100 updates' : 'FAIL: resources replaced';
  ui.setManipulationFeedback('scale','held',controller.state.draft?.kind === 'scale' ? controller.state.draft.uniformScale : 1);
});
window.addEventListener('beforeunload',()=>{ geometry.dispose(); viewport.dispose(); });
