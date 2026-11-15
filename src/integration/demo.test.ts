import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { Controller } from '../core/controller';
import { PresentationCoordinator } from '../core/presentation';
import { buildMesh, initializeKernel } from '../geometry/kernel';
import { GestureRecognizer } from '../tracking/gestures';
import { TargetActivation } from '../tracking/activation';
import { ScaleSession } from '../tracking/manipulation';
import type { GestureOutput, TrackedHand, TrackingFrame } from '../shared/types';

let kernel: ManifoldToplevel;
beforeAll(async () => {
  const wasm = decodeURIComponent(new URL('../../node_modules/manifold-3d/manifold.wasm', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
  kernel = await initializeKernel(wasm);
});
function hand(side: 'Left' | 'Right', ratio: number, offset: number): TrackedHand {
  const landmarks = Array.from({ length: 21 }, () => ({ x: .5 + offset, y: .7, z: 0 }));
  landmarks[0] = { x: .5 + offset, y: .8, z: 0 };
  [5,9,13,17].forEach((joint, index) => {
    const x = .4 + index * .06 + offset;
    [.6,.5,.4,.3].forEach((y, step) => { landmarks[joint + step] = { x, y, z: 0 }; });
  });
  const palm = Math.hypot(landmarks[0].x - landmarks[9].x, (landmarks[0].y - landmarks[9].y) * .75);
  landmarks[4] = { x: landmarks[8].x + ratio * palm, y: landmarks[8].y, z: 0 };
  return { handedness: side, score: .99, landmarks };
}

describe('complete gesture-to-AST CAD demonstration', () => {
  it.each([13,30,60])('creates, scales, subtracts, undoes, and cancels through the real pipeline at %i FPS', async fps => {
    const controller = new Controller({ build: async recipe => buildMesh(kernel, recipe) });
    const recognizer = new GestureRecognizer();
    const activation = new TargetActivation({ hoverMs: 350 });
    const presentation = new PresentationCoordinator({ full: () => {}, preview: () => {}, renderPreview: () => {}, persist: () => {} });
    const stop = controller.subscribe(state => presentation.update(state, true, true));
    let frameIndex = 0;
    let pendingAction: Promise<boolean> | null = null;
    let target: string | null = null;
    let scale: ScaleSession | null = null;
    let boxId = '', cylinderId = '';
    const fired: string[] = [];
    const dispatch = (id: string) => {
      fired.push(id);
      if (id === 'tool:box') controller.beginCreate('Box');
      else if (id === 'tool:cylinder') controller.beginCreate('Cylinder');
      else if (id === 'tool:commit') pendingAction = controller.commit('gesture-rules');
      else if (id === 'tool:scale') { controller.beginScale(); scale = new ScaleSession(controller.state.scene.solids.find(s => s.id === controller.state.selectedId)!.scale); }
      else if (id === 'tool:subtract') controller.beginSubtract();
      else if (id === 'tool:undo') controller.undo();
      else if (id === 'tool:move') controller.beginMove();
      else if (id === 'tool:cancel') controller.cancel();
      else if (id === 'solid:box') controller.select(boxId);
      else if (id === 'solid:cylinder') controller.chooseCutter(cylinderId);
    };
    const tick = (dominantRatio = 1.2, otherRatio = 1.2, separation = .3, missing = false): GestureOutput => {
      const frame: TrackingFrame = { timestamp: frameIndex++ * 1000 / fps, width: 640, height: 480, inferenceMs: 0,
        hands: missing ? [] : [hand('Right', dominantRatio, .15), hand('Left', otherRatio, .15 - separation)] };
      const gesture = recognizer.process(frame);
      const result = activation.update({ timestamp: gesture.timestamp, targetId: target, cursor: gesture.cursor,
        trackingReady: gesture.trackingReady, toolbarArmed: gesture.toolbarArmed, pinched: gesture.dominantPinched,
        pinchStarted: gesture.pinchStarted, pinchReleased: gesture.pinchReleased, pinchClosing: gesture.pinchClosing });
      if (result.activate) dispatch(result.activate);
      if (scale && controller.state.draft?.kind === 'scale') { const preview = scale.update(gesture); if (preview.changed) controller.updateScale(preview.value); }
      return gesture;
    };
    const click = async (id: string) => {
      target = id;
      // A complete neutral release and armed stable hover precede every click.
      for (let i = 0; i < Math.ceil(fps * .9); i++) tick();
      const previous = fired.length;
      tick(.2); tick(.2);
      expect(fired.slice(previous)).toEqual([id]);
      if (pendingAction) { expect(await pendingAction).toBe(true); pendingAction = null; }
      for (let i = 0; i < 4; i++) tick(.2);
      expect(fired.length).toBe(previous + 1);
      target = null; tick(); tick();
    };
    await click('tool:box'); await click('tool:commit'); boxId = controller.state.selectedId!;
    expect(controller.state.scene.solids).toHaveLength(1);
    await click('tool:scale');
    const beforePreview = { ...presentation.diagnostics };
    tick(.2,.2,.3); tick(.2,.2,.3);
    for (let i = 0; i < Math.ceil(fps * .65); i++) tick(.2,.2,.3 + .12 * i / Math.ceil(fps * .65));
    for (let i = 0; i < Math.ceil(fps * .6); i++) tick(.2,.2,.42);
    expect(controller.state.draft).toMatchObject({ kind: 'scale' });
    const value = controller.state.draft?.kind === 'scale' ? controller.state.draft.uniformScale : 0;
    expect(value).toBeCloseTo(1.4, 2);
    expect(presentation.diagnostics.fullUpdates).toBe(beforePreview.fullUpdates);
    expect(presentation.diagnostics.persistenceWrites).toBe(beforePreview.persistenceWrites);
    expect(presentation.diagnostics.renderPreviews).toBeGreaterThan(beforePreview.renderPreviews);
    tick(); tick(); const held = controller.getDraftAST();
    for (let i = 0; i < 5; i++) tick();
    expect(controller.getDraftAST()).toEqual(held);
    await click('tool:commit');
    const actualScale = controller.state.scene.solids[0].scale;
    expect(actualScale).toBeCloseTo(1.4, 2);
    await click('tool:cylinder'); await click('tool:commit'); cylinderId = controller.state.selectedId!;
    await click('solid:box'); await click('tool:subtract'); await click('solid:cylinder');
    expect(controller.getDraftAST()).toMatchObject({ type: 'Subtract', targetId: boxId, cutterId: cylinderId });
    await click('tool:commit');
    expect(controller.state.scene.solids).toHaveLength(1);
    const result = controller.meshes.get(controller.state.selectedId!)!;
    const boreArea = 32 * .5 * 25 * Math.sin(2 * Math.PI / 32);
    expect(result.volume).toBeCloseTo(8000 * actualScale ** 3 - boreArea * 20 * actualScale, 3);
    expect(controller.state.scene.commands.map(c => c.ast.type)).toEqual(['Create','Scale','Create','Subtract']);
    expect(controller.state.scene.commands.every(c => c.source === 'gesture-rules')).toBe(true);
    await click('tool:undo'); expect(controller.state.scene.solids).toHaveLength(2);
    await click('solid:box'); const original = controller.exportDocument();
    await click('tool:move'); controller.updateMove([5,3,0]); await click('tool:cancel');
    expect(controller.exportDocument()).toEqual(original);
    stop(); presentation.dispose();
  });
});
