import { beforeAll, describe, expect, it } from 'vitest';
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import type { ManifoldToplevel } from 'manifold-3d';
import { Controller } from '../core/controller';
import { PresentationCoordinator } from '../core/presentation';
import { parseProjectFile } from '../core/projectFile';
import { exportSolidSTL } from '../core/stlExport';
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

/** Verify the exported triangles with the independent STL reader, not export metadata. */
function inspectSTL(data: ArrayBuffer) {
  const geometry = new STLLoader().parse(data);
  geometry.computeBoundingBox();
  const position = geometry.getAttribute('position');
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  let volume = 0;
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i); b.fromBufferAttribute(position, i + 1); c.fromBufferAttribute(position, i + 2);
    volume += a.dot(b.cross(c)) / 6;
  }
  const dimensions = geometry.boundingBox!.getSize(new Vector3()).toArray();
  const material = new MeshBasicMaterial({ side: DoubleSide });
  const mesh = new Mesh(geometry, material); mesh.updateMatrixWorld(true);
  return { geometry, material, mesh, volume, dimensions };
}

describe('complete gesture-to-AST CAD demonstration', () => {
  const scenarios = [13,30,60].flatMap(fps => [{ fps, precise: false, bushing: false, mode: 'default' }, { fps, precise: true, bushing: false, mode: 'precise presets + project reopen' }]);
  scenarios.push({ fps: 15, precise: false, bushing: true, mode: 'flanged guide bushing' });
  it.each(scenarios)('completes the $mode workflow through the real pipeline at $fps FPS', async ({ fps, precise, bushing }) => {
    const geometry = { build: async (recipe: Parameters<typeof buildMesh>[1]) => buildMesh(kernel, recipe) };
    let controller = new Controller(geometry);
    const recognizer = new GestureRecognizer();
    const activation = new TargetActivation({ hoverMs: 350 });
    const presentation = new PresentationCoordinator({ full: () => {}, preview: () => {}, renderPreview: () => {}, persist: () => {} });
    let stop = controller.subscribe(state => presentation.update(state, true, true));
    let frameIndex = 0;
    let pendingAction: Promise<boolean> | null = null;
    let target: string | null = null;
    let scale: ScaleSession | null = null;
    let boxId = '', cylinderId = '', restoredId = '';
    const fired: string[] = [];
    const exports: ReturnType<typeof exportSolidSTL>[] = [];
    const exportEligible = () => !controller.state.draft && !controller.state.busy && !controller.state.paused
      && controller.state.scene.solids.some(solid => solid.id === controller.state.selectedId)
      && controller.meshes.has(controller.state.selectedId!);
    const dispatch = (id: string) => {
      fired.push(id);
      if (id === 'tool:box') controller.beginCreate('Box');
      else if (id === 'tool:cylinder') controller.beginCreate('Cylinder');
      else if (id === 'tool:commit') pendingAction = controller.commit('gesture-rules');
      else if (id === 'tool:scale') { controller.beginScale(); scale = new ScaleSession(controller.state.scene.solids.find(s => s.id === controller.state.selectedId)!.scale); }
      else if (id === 'tool:subtract') controller.beginSubtract();
      else if (id === 'tool:union') controller.beginUnion();
      else if (id === 'tool:undo') controller.undo();
      else if (id === 'tool:move') controller.beginMove();
      else if (id === 'tool:cancel') controller.cancel();
      else if (id === 'solid:box') controller.select(boxId);
      else if (id === 'solid:cylinder') {
        if (controller.state.draft?.kind === 'union') controller.chooseUnionOperand(cylinderId);
        else controller.chooseCutter(cylinderId);
      }
      else if (id === 'solid:restored') controller.select(restoredId);
      else if (id.startsWith('preset:')) expect(controller.applySizePreset(id.slice('preset:'.length))).toBe(true);
      else if (id === 'export:stl' && exportEligible()) {
        const selected = controller.state.scene.solids.find(solid => solid.id === controller.state.selectedId)!;
        exports.push(exportSolidSTL(selected, controller.meshes.get(selected.id)!));
      }
    };
    const tick = (dominantRatio = 1.2, otherRatio = 1.2, separation = .3, missing = false): GestureOutput => {
      const frame: TrackingFrame = { timestamp: frameIndex++ * 1000 / fps, width: 640, height: 480, inferenceMs: 0,
        hands: missing ? [] : [hand('Right', dominantRatio, .15), hand('Left', otherRatio, .15 - separation)] };
      const gesture = recognizer.process(frame);
      const eligibleTarget = target === 'export:stl' && !exportEligible() ? null : target;
      const result = activation.update({ timestamp: gesture.timestamp, targetId: eligibleTarget, cursor: gesture.cursor,
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
    const blockedExport = () => {
      target = 'export:stl'; const before = exports.length, beforeFired = fired.length;
      for (let i = 0; i < Math.ceil(fps * .9); i++) tick();
      tick(.2); tick(.2); tick(.2); tick(.2);
      expect(exports).toHaveLength(before); expect(fired).toHaveLength(beforeFired);
      target = null; tick(); tick();
    };
    blockedExport(); // No selected committed solid exists yet.
    await click('tool:box');
    if (precise) {
      const originalObjectId = controller.state.draft?.kind === 'create' ? controller.state.draft.solid.id : '';
      await click('preset:box:y:30'); await click('preset:box:z:40');
      expect(controller.getDraftAST()).toMatchObject({ type: 'Create', objectId: originalObjectId, primitive: 'Box', dimensions: [20,30,40] });
      expect(fired.filter(id => id === 'preset:box:y:30')).toHaveLength(1);
      expect(fired.filter(id => id === 'preset:box:z:40')).toHaveLength(1);
    }
    // Clicking size controls, holding the pinch, and releasing still do not commit.
    expect(controller.state.scene.solids).toHaveLength(0); expect(controller.state.scene.commands).toHaveLength(0);
    blockedExport();
    await click('tool:commit'); boxId = controller.state.selectedId!;
    expect(controller.state.scene.solids).toHaveLength(1);
    if (bushing) {
      await click('tool:cylinder');
      await click('preset:cylinder:radius:8'); await click('preset:cylinder:height:40');
      await click('tool:commit'); cylinderId = controller.state.selectedId!;
      await click('solid:box'); await click('tool:union'); await click('solid:cylinder');
      expect(controller.getDraftAST()).toMatchObject({ type: 'Union', targetId: boxId, otherId: cylinderId });
      expect(controller.state.scene.solids).toHaveLength(2);
      await click('tool:commit'); boxId = controller.state.selectedId!;
      await click('tool:cylinder'); await click('preset:cylinder:radius:3');
      await click('tool:commit'); cylinderId = controller.state.selectedId!;
      await click('solid:box'); await click('tool:subtract'); await click('solid:cylinder');
      await click('tool:commit');
      expect(controller.state.scene.commands.map(command => command.ast.type)).toEqual(['Create', 'Create', 'Union', 'Create', 'Subtract']);
      await click('export:stl');
      expect(exports).toHaveLength(1);
      expect(exports[0].measurements.dimensions).toEqual([20, 20, 40]);
      expect(controller.exportDocument().schemaVersion).toBe(2);
      stop(); presentation.dispose();
      return;
    }
    await click('tool:scale');
    blockedExport();
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
    const beforeBoxExport = controller.exportDocument();
    await click('export:stl');
    expect(exports).toHaveLength(1);
    expect(controller.exportDocument()).toEqual(beforeBoxExport);
    const exportedBox = inspectSTL(exports[0].data);
    const expectedSize = precise ? [20,30,40] : [20,20,20];
    exportedBox.dimensions.forEach((value, axis) => expect(value).toBeCloseTo(expectedSize[axis] * actualScale, 4));
    expect(exports[0].measurements.triangles).toBe(12);
    exportedBox.geometry.dispose(); exportedBox.material.dispose();
    controller.setPaused(true); blockedExport(); controller.setPaused(false);
    expect(controller.exportDocument()).toEqual(beforeBoxExport);
    await click('tool:cylinder');
    if (precise) {
      await click('preset:cylinder:radius:3');
      expect(controller.getDraftAST()).toMatchObject({ type: 'Create', primitive: 'Cylinder', dimensions: [3,60] });
      expect(fired.filter(id => id === 'preset:cylinder:radius:3')).toHaveLength(1);
      expect(controller.state.scene.solids).toHaveLength(1);
    }
    await click('tool:commit'); cylinderId = controller.state.selectedId!;
    await click('solid:box'); await click('tool:subtract'); await click('solid:cylinder');
    expect(controller.getDraftAST()).toMatchObject({ type: 'Subtract', targetId: boxId, cutterId: cylinderId });
    await click('tool:commit');
    expect(controller.state.scene.solids).toHaveLength(1);
    const result = controller.meshes.get(controller.state.selectedId!)!;
    const radius = precise ? 3 : 5;
    const boxVolume = precise ? 20 * 30 * 40 : 8000;
    const boxDepth = precise ? 40 : 20;
    const boreArea = 32 * .5 * radius ** 2 * Math.sin(2 * Math.PI / 32);
    expect(60).toBeGreaterThan(boxDepth * actualScale);
    expect(result.volume).toBeCloseTo(boxVolume * actualScale ** 3 - boreArea * boxDepth * actualScale, 3);
    expect(controller.state.scene.commands.map(c => c.ast.type)).toEqual(['Create','Scale','Create','Subtract']);
    expect(controller.state.scene.commands.every(c => c.source === 'gesture-rules')).toBe(true);
    const beforeResultExport = controller.exportDocument();
    await click('export:stl');
    expect(exports).toHaveLength(2);
    expect(controller.exportDocument()).toEqual(beforeResultExport);
    const resultSTL = inspectSTL(exports[1].data);
    const expectedVolume = boxVolume * actualScale ** 3 - boreArea * boxDepth * actualScale;
    expect(Math.abs(resultSTL.volume - expectedVolume)).toBeLessThan(expectedVolume * 1e-6);
    resultSTL.dimensions.forEach((value, axis) => expect(value).toBeCloseTo(expectedSize[axis] * actualScale, 4));
    // Looking down world Z through the center must encounter no surface.
    // A nearby ray through remaining stock must hit the front/back faces.
    expect(new Raycaster(new Vector3(0,0,100), new Vector3(0,0,-1)).intersectObject(resultSTL.mesh)).toHaveLength(0);
    expect(new Raycaster(new Vector3(radius + 1,0,100), new Vector3(0,0,-1)).intersectObject(resultSTL.mesh).length).toBeGreaterThanOrEqual(2);
    resultSTL.geometry.dispose(); resultSTL.material.dispose();
    if (precise) {
      const exported = controller.exportDocument();
      const parsed = parseProjectFile(JSON.stringify(exported));
      const reopened = new Controller(geometry);
      expect(await reopened.restore(parsed)).toBe(true);
      restoredId = exported.solids[0].id;
      expect(reopened.exportDocument()).toEqual(exported);
      expect(reopened.state.scene.commands).toEqual(exported.commands);
      expect(reopened.meshes.get(restoredId)!.volume).toBeCloseTo(result.volume, 5);
      expect(reopened.state.historyCount).toBe(0);
      // Persisted commands are provenance; session Undo snapshots are deliberately fresh.
      reopened.undo(); expect(reopened.exportDocument()).toEqual(exported);
      stop(); controller = reopened; stop = controller.subscribe(state => presentation.update(state, true, true));
      await click('solid:restored'); expect(controller.state.selectedId).toBe(restoredId);
      await click('export:stl');
      expect(exports).toHaveLength(3);
      expect(new Uint8Array(exports[2].data)).toEqual(new Uint8Array(exports[1].data));
      expect(controller.exportDocument()).toEqual(exported);
      await click('tool:move'); controller.updateMove([5,3,0]); await click('tool:cancel');
      expect(controller.exportDocument()).toEqual(exported); expect(controller.state.historyCount).toBe(0);
      // A new committed edit after reopening has a new undo snapshot.
      await click('tool:move'); controller.updateMove([5,3,0]); await click('tool:commit');
      expect(controller.state.scene.solids[0].position).toEqual([5,3,0]); expect(controller.state.historyCount).toBe(1);
      await click('tool:undo');
      expect(controller.state.scene.solids).toEqual(exported.solids);
      expect(controller.state.scene.commands).toEqual(exported.commands);
      expect(controller.state.scene.revision).toBeGreaterThan(exported.revision);
      expect(controller.state.historyCount).toBe(0);
    } else {
      await click('tool:undo'); expect(controller.state.scene.solids).toHaveLength(2);
      await click('solid:box'); const original = controller.exportDocument();
      await click('tool:move'); controller.updateMove([5,3,0]); await click('tool:cancel');
      expect(controller.exportDocument()).toEqual(original);
    }
    stop(); presentation.dispose();
  });
});
