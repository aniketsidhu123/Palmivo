import type { Controller } from './controller';
import type { Vec3 } from '../shared/types';

/** Deliberate preview adjustments usable with dwell, pointer, and keyboard focus. */
export const TRANSFORM_STEPS = [
  { key: 'scale:down', kind: 'scale', label: '− 0.1×', description: 'Decrease preview scale by 0.1', delta: -0.1 },
  { key: 'scale:up', kind: 'scale', label: '+ 0.1×', description: 'Increase preview scale by 0.1', delta: 0.1 },
  { key: 'move:x-', kind: 'move', label: 'X −1', description: 'Move preview X minus 1 millimetre', delta: -1, axis: 0 },
  { key: 'move:x+', kind: 'move', label: 'X +1', description: 'Move preview X plus 1 millimetre', delta: 1, axis: 0 },
  { key: 'move:y-', kind: 'move', label: 'Y −1', description: 'Move preview Y minus 1 millimetre', delta: -1, axis: 1 },
  { key: 'move:y+', kind: 'move', label: 'Y +1', description: 'Move preview Y plus 1 millimetre', delta: 1, axis: 1 },
] as const;

export function applyTransformStep(controller: Controller, key: string): boolean {
  const { draft, busy, paused } = controller.state;
  if (!draft || busy || paused) return false;
  const step = TRANSFORM_STEPS.find(item => item.key === key);
  if (!step || draft.kind !== step.kind) return false;
  if (draft.kind === 'scale' && step.kind === 'scale') {
    const previous = draft.uniformScale;
    controller.updateScale(Math.round((previous + step.delta) * 1e6) / 1e6);
    return controller.state.draft?.kind === 'scale' && controller.state.draft.uniformScale !== previous;
  }
  if (draft.kind === 'move' && step.kind === 'move') {
    const position: Vec3 = [...draft.position];
    position[step.axis] += step.delta;
    controller.updateMove(position);
    return controller.state.draft?.kind === 'move' && controller.state.draft.position[step.axis] === position[step.axis];
  }
  return false;
}
