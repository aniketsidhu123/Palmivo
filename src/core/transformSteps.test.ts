import { describe, expect, it, vi } from 'vitest';
import { Controller } from './controller';
import { applyTransformStep } from './transformSteps';
import type { GeometryAdapter, GeometryMesh } from '../shared/types';

const mesh = (): GeometryMesh => ({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]), volume: 8000 });
async function fixture() {
  const geometry: GeometryAdapter = { build: vi.fn(async () => mesh()) };
  const controller = new Controller(geometry);
  controller.beginCreate('Box'); expect(await controller.commit()).toBe(true);
  return { controller, geometry, targetId: controller.state.selectedId! };
}

describe('deliberate transform preview steps', () => {
  it('preserves a fractional starting scale rather than snapping the whole value to tenths', async () => {
    const { controller } = await fixture(); controller.beginScale(); controller.updateScale(1.35);
    expect(applyTransformStep(controller, 'scale:up')).toBe(true);
    expect(controller.state.draft).toMatchObject({ kind: 'scale', uniformScale: 1.45 });
    expect(applyTransformStep(controller, 'scale:down')).toBe(true);
    expect(controller.state.draft).toMatchObject({ kind: 'scale', uniformScale: 1.35 });
  });

  it('clamps scale at 0.5–2.0 and reports no change for repeated attempts beyond the limit', async () => {
    const { controller } = await fixture(); controller.beginScale(); controller.updateScale(1.95);
    expect(applyTransformStep(controller, 'scale:up')).toBe(true);
    expect(controller.state.draft).toMatchObject({ uniformScale: 2 });
    expect(applyTransformStep(controller, 'scale:up')).toBe(false);
    controller.updateScale(.55);
    expect(applyTransformStep(controller, 'scale:down')).toBe(true);
    expect(controller.state.draft).toMatchObject({ uniformScale: .5 });
    expect(applyTransformStep(controller, 'scale:down')).toBe(false);
  });

  it('changes only the preview until explicit Commit records one resolved AST', async () => {
    const { controller, geometry, targetId } = await fixture(); const committed = controller.exportDocument();
    controller.beginScale();
    expect(applyTransformStep(controller, 'scale:up')).toBe(true);
    expect(applyTransformStep(controller, 'scale:up')).toBe(true);
    expect(controller.exportDocument()).toEqual(committed);
    expect(controller.getDraftAST()).toEqual({ type: 'Scale', targetId, uniformScale: 1.2 });
    expect(await controller.commit('gesture-rules')).toBe(true);
    expect(controller.state.scene.revision).toBe(committed.revision + 1);
    expect(controller.state.scene.commands).toHaveLength(committed.commands.length + 1);
    expect(controller.state.lastCommand).toMatchObject({ source: 'gesture-rules', ast: { type: 'Scale', targetId, uniformScale: 1.2 } });
    expect(controller.state.scene.solids[0].scale).toBe(1.2);
    expect(geometry.build).toHaveBeenCalledOnce();
  });

  it('moves X/Y one millimetre at a time while preserving an existing nonzero Z', async () => {
    const { controller, targetId } = await fixture();
    controller.beginMove(); controller.updateMove([5, -2, 7]); expect(await controller.commit()).toBe(true);
    const committed = controller.exportDocument(); controller.beginMove();
    expect(applyTransformStep(controller, 'move:x+')).toBe(true);
    expect(applyTransformStep(controller, 'move:y-')).toBe(true);
    expect(controller.state.draft).toMatchObject({ kind: 'move', position: [6, -3, 7] });
    expect(controller.exportDocument()).toEqual(committed);
    expect(applyTransformStep(controller, 'move:x-')).toBe(true);
    expect(applyTransformStep(controller, 'move:y+')).toBe(true);
    expect(controller.getDraftAST()).toEqual({ type: 'Move', targetId, position: [5, -2, 7] });
  });

  it('Cancel retains the exact committed transforms and history after either step operation', async () => {
    const { controller } = await fixture();
    controller.beginMove(); controller.updateMove([6, -4, 8]); await controller.commit();
    controller.beginScale(); controller.updateScale(1.35); await controller.commit();
    const committed = controller.exportDocument(); const history = controller.state.historyCount;
    controller.beginMove(); applyTransformStep(controller, 'move:x+'); applyTransformStep(controller, 'move:y-'); controller.cancel();
    expect(controller.exportDocument()).toEqual(committed);
    controller.beginScale(); applyTransformStep(controller, 'scale:down'); controller.cancel();
    expect(controller.exportDocument()).toEqual(committed);
    expect(controller.state.historyCount).toBe(history);
    expect(controller.state.draft).toBeNull();
  });

  it('cannot change a paused or busy draft', async () => {
    const { controller } = await fixture(); controller.beginScale();
    controller.setPaused(true); const paused = structuredClone(controller.state);
    expect(applyTransformStep(controller, 'scale:up')).toBe(false);
    expect(controller.state).toEqual(paused);
    controller.setPaused(false); controller.state.busy = true;
    const busy = structuredClone(controller.state);
    expect(applyTransformStep(controller, 'scale:down')).toBe(false);
    expect(controller.state).toEqual(busy);
  });

  it('rejects absent, mismatched, creation, and subtraction drafts without side effects', async () => {
    const { controller } = await fixture();
    expect(applyTransformStep(controller, 'scale:up')).toBe(false);
    controller.beginMove(); const move = structuredClone(controller.state);
    expect(applyTransformStep(controller, 'scale:up')).toBe(false); expect(controller.state).toEqual(move);
    controller.cancel(); controller.beginScale(); const scale = structuredClone(controller.state);
    expect(applyTransformStep(controller, 'move:x+')).toBe(false); expect(controller.state).toEqual(scale);
    controller.cancel(); controller.beginCreate('Cylinder'); const create = structuredClone(controller.state);
    expect(applyTransformStep(controller, 'move:x+')).toBe(false); expect(controller.state).toEqual(create);
    await controller.commit(); controller.beginSubtract(); const subtract = structuredClone(controller.state);
    expect(applyTransformStep(controller, 'scale:up')).toBe(false); expect(controller.state).toEqual(subtract);
  });

  it('ignores unknown keys and rejects steps beyond the supported scene bounds', async () => {
    const { controller } = await fixture(); controller.beginMove(); controller.updateMove([500, -500, 9]);
    const before = structuredClone(controller.state);
    for (const key of ['', 'move:z+', '__proto__', 'scale:invalid']) expect(applyTransformStep(controller, key)).toBe(false);
    expect(controller.state).toEqual(before);
    expect(applyTransformStep(controller, 'move:x+')).toBe(false);
    expect(applyTransformStep(controller, 'move:y-')).toBe(false);
    expect(controller.state.draft).toMatchObject({ position: [500, -500, 9] });
    expect(applyTransformStep(controller, 'move:x-')).toBe(true);
    expect(controller.state.draft).toMatchObject({ position: [499, -500, 9] });
  });
});
