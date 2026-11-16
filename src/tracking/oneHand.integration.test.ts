import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import type { ManifoldToplevel } from 'manifold-3d';
import { Controller } from '../core/controller';
import { applyTransformStep } from '../core/transformSteps';
import { exportSolidSTL } from '../core/stlExport';
import { buildMesh, initializeKernel } from '../geometry/kernel';
import { DEFAULT_PROFILE, GestureRecognizer } from './gestures';
import { TargetActivation } from './activation';
import type { TrackedHand, TrackingFrame } from '../shared/types';

let kernel: ManifoldToplevel;
beforeAll(async () => {
  const wasm = decodeURIComponent(new URL('../../node_modules/manifold-3d/manifold.wasm', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
  kernel = await initializeKernel(wasm);
});

const WIDTH = 1000, HEIGHT = 800;
const targets = [
  'tool:box', 'preset:box:y:30', 'preset:box:z:40', 'tool:commit',
  'tool:scale', 'adjust:scale:up', 'tool:cylinder', 'preset:cylinder:radius:3',
  'solid:box', 'tool:subtract', 'solid:cylinder', 'export:stl',
  'tool:undo', 'tool:move', 'adjust:move:x+', 'tool:cancel',
].map((id, index) => ({ id, x: .15 + index % 4 * .2, y: .12 + Math.floor(index / 4) * .16 }));

/** A closed/relaxed hand: no offhand, straight-finger pose, or pinch cycles. */
function pointer(x: number, y: number): TrackedHand {
  const imageX = 1 - x;
  const landmarks = Array.from({ length: 21 }, (_, index) => ({
    x: imageX + Math.cos(index) * .02, y: y + .04 + Math.sin(index) * .02, z: 0,
  }));
  landmarks[0] = { x: imageX + .03, y: y + .1, z: 0 };
  landmarks[9] = { x: imageX + .02, y: y + .055, z: 0 };
  landmarks[8] = { x: imageX, y, z: 0 };
  landmarks[4] = { x: imageX + .003, y, z: 0 };
  return { handedness: 'Right', score: .99, landmarks };
}

class OneHandPipeline {
  readonly controller = new Controller({ build: async recipe => buildMesh(kernel, recipe) });
  readonly recognizer = new GestureRecognizer({ ...DEFAULT_PROFILE, minX: 0, maxX: 1, minY: 0, maxY: 1 }, { singleHand: true });
  readonly activation = new TargetActivation({ mode: 'dwell' });
  readonly fired: string[] = [];
  readonly exports: ReturnType<typeof exportSolidSTL>[] = [];
  private position = { x: .95, y: .95 };
  private frameIndex = 0;
  private pending: Promise<boolean> | null = null;
  private boxId = '';
  private cylinderId = '';
  constructor(readonly fps: number) {}

  private eligible(id: string): boolean {
    const { draft, busy, paused, selectedId, scene, historyCount } = this.controller.state;
    if (busy || paused) return false;
    if (id === 'tool:commit') return this.controller.getDraftAST() !== null;
    if (id === 'tool:cancel') return !!draft;
    if (id.startsWith('adjust:')) return id.includes(':scale:') ? draft?.kind === 'scale' : draft?.kind === 'move';
    if (id.startsWith('preset:')) return draft?.kind === 'create' && (id.includes(':box:') ? draft.solid.recipe.kind === 'box' : draft.solid.recipe.kind === 'cylinder');
    if (id.startsWith('solid:')) return scene.solids.some(solid => solid.id === (id === 'solid:box' ? this.boxId : this.cylinderId)) && (!draft || draft.kind === 'subtract');
    if (draft) return false;
    if (id === 'tool:undo') return historyCount > 0;
    if (id === 'export:stl' || id === 'tool:move' || id === 'tool:scale') return !!selectedId;
    if (id === 'tool:subtract') return !!selectedId && scene.solids.length >= 2;
    return true;
  }

  private dispatch(id: string): void {
    this.fired.push(id);
    if (id === 'tool:box') this.controller.beginCreate('Box');
    else if (id === 'tool:cylinder') this.controller.beginCreate('Cylinder');
    else if (id === 'tool:scale') this.controller.beginScale();
    else if (id === 'tool:move') this.controller.beginMove();
    else if (id === 'tool:subtract') this.controller.beginSubtract();
    else if (id === 'tool:cancel') this.controller.cancel();
    else if (id === 'tool:undo') this.controller.undo();
    else if (id === 'tool:commit') this.pending = this.controller.commit('gesture-rules');
    else if (id === 'solid:box') this.controller.select(this.boxId);
    else if (id === 'solid:cylinder') this.controller.chooseCutter(this.cylinderId);
    else if (id.startsWith('preset:')) expect(this.controller.applySizePreset(id.slice(7))).toBe(true);
    else if (id.startsWith('adjust:')) expect(applyTransformStep(this.controller, id.slice(7))).toBe(true);
    else if (id === 'export:stl') {
      const solid = this.controller.state.scene.solids.find(item => item.id === this.controller.state.selectedId)!;
      this.exports.push(exportSolidSTL(solid, this.controller.meshes.get(solid.id)!));
    }
  }

  tick(missing = false, overrideTarget?: string | null) {
    const frame: TrackingFrame = { timestamp: this.frameIndex++ * 1000 / this.fps, width: 640, height: 480,
      inferenceMs: 0, hands: missing ? [] : [pointer(this.position.x, this.position.y)] };
    const gesture = this.recognizer.process(frame);
    const cursor = gesture.cursor ? { x: gesture.cursor.x * WIDTH, y: gesture.cursor.y * HEIGHT } : null;
    const hit = cursor && targets.find(target => this.eligible(target.id) &&
      Math.abs(cursor.x - target.x * WIDTH) <= 40 && Math.abs(cursor.y - target.y * HEIGHT) <= 25);
    const output = this.activation.update({ timestamp: gesture.timestamp, cursor,
      targetId: overrideTarget === undefined ? hit?.id ?? null : overrideTarget,
      trackingReady: gesture.trackingReady, toolbarArmed: gesture.toolbarArmed,
      pinched: gesture.dominantPinched, pinchStarted: gesture.pinchStarted, pinchReleased: gesture.pinchReleased,
      pinchClosing: gesture.pinchClosing });
    expect(gesture.bothPinched).toBe(false); expect(gesture.pinchStarted).toBe(false);
    if (output.activate) this.dispatch(output.activate);
    return { gesture, output };
  }

  hold(milliseconds: number): void { for (let index = 0; index < Math.ceil(milliseconds * this.fps / 1000); index++) this.tick(); }
  private move(x: number, y: number): void {
    const start = { ...this.position }, count = Math.ceil(.3 * this.fps);
    for (let index = 1; index <= count; index++) {
      this.position = { x: start.x + (x - start.x) * index / count, y: start.y + (y - start.y) * index / count };
      this.tick();
    }
  }
  leaveTargets(): void { this.move(.95, .95); this.hold(300); }
  aim(id: string): void { const target = targets.find(item => item.id === id)!; this.move(target.x, target.y); }
  async settleExecution(): Promise<void> {
    if (this.pending) { expect(await this.pending).toBe(true); this.pending = null; }
    this.boxId ||= this.controller.state.scene.solids.find(solid => solid.recipe.kind === 'box')?.id ?? '';
    this.cylinderId ||= this.controller.state.scene.solids.find(solid => solid.recipe.kind === 'cylinder')?.id ?? '';
  }
  async choose(id: string): Promise<void> {
    this.leaveTargets(); const before = this.fired.length;
    this.aim(id); this.hold(id === 'tool:commit' ? 1600 : 1300);
    expect(this.fired.slice(before)).toEqual([id]);
    await this.settleExecution();
    this.hold(450); expect(this.fired.length).toBe(before + 1);
  }
}

describe('one-hand dwell → AST → real solid geometry', () => {
  it.each([13, 30, 60])('completes the precise CAD demo without an offhand or pinching at %i FPS', async fps => {
    const pipeline = new OneHandPipeline(fps); pipeline.hold(400);
    await pipeline.choose('tool:box');
    await pipeline.choose('preset:box:y:30'); await pipeline.choose('preset:box:z:40');
    expect(pipeline.controller.state.scene.solids).toHaveLength(0);
    await pipeline.choose('tool:commit');
    await pipeline.choose('tool:scale');
    for (let count = 0; count < 4; count++) await pipeline.choose('adjust:scale:up');
    expect(pipeline.controller.getDraftAST()).toMatchObject({ type: 'Scale', uniformScale: 1.4 });
    expect(pipeline.controller.state.scene.solids[0].scale).toBe(1);
    await pipeline.choose('tool:commit');
    const committed = pipeline.controller.exportDocument();
    await pipeline.choose('tool:move'); await pipeline.choose('adjust:move:x+');
    expect(pipeline.controller.getDraftAST()).toMatchObject({ type: 'Move', position: [1, 0, 0] });
    await pipeline.choose('tool:cancel'); expect(pipeline.controller.exportDocument()).toEqual(committed);
    await pipeline.choose('tool:cylinder'); await pipeline.choose('preset:cylinder:radius:3'); await pipeline.choose('tool:commit');
    await pipeline.choose('solid:box'); await pipeline.choose('tool:subtract'); await pipeline.choose('solid:cylinder');
    expect(pipeline.controller.state.scene.solids).toHaveLength(2);
    await pipeline.choose('tool:commit');
    const result = pipeline.controller.state.scene.solids[0];
    expect(pipeline.controller.state.scene.solids).toHaveLength(1);
    expect(pipeline.controller.state.lastCommand?.ast).toMatchObject({ type: 'Subtract' });
    expect(pipeline.controller.meshes.get(result.id)!.volume).toBeCloseTo(64282.791638, 2);
    const beforeExport = pipeline.controller.exportDocument();
    await pipeline.choose('export:stl'); expect(pipeline.exports).toHaveLength(1);
    expect(pipeline.controller.exportDocument()).toEqual(beforeExport);
    const exported = new STLLoader().parse(pipeline.exports[0].data); exported.computeBoundingBox();
    expect(exported.boundingBox!.getSize(new Vector3()).toArray()).toEqual([28, 42, 56]);
    expect(exported.getAttribute('position').count / 3).toBe(144); exported.dispose();
    await pipeline.choose('tool:undo'); expect(pipeline.controller.state.scene.solids).toHaveLength(2);
    expect(pipeline.controller.state.scene.solids.map(solid => solid.recipe.kind).sort()).toEqual(['box', 'cylinder']);
  });

  it.each([13, 30, 60])('discards a partial Commit dwell on tracking loss and blocks stationary repeats at %i FPS', async fps => {
    const pipeline = new OneHandPipeline(fps); pipeline.hold(400); await pipeline.choose('tool:box');
    pipeline.leaveTargets(); pipeline.aim('tool:commit'); pipeline.hold(650);
    expect(pipeline.controller.state.scene.solids).toHaveLength(0);
    const before = pipeline.fired.length;
    const missing = pipeline.tick(true);
    expect(missing.output.phase).toBe('tracking-lost');
    pipeline.hold(1100); expect(pipeline.fired.length).toBe(before);
    expect(pipeline.controller.state.scene.solids).toHaveLength(0);
    pipeline.hold(600); await pipeline.settleExecution();
    expect(pipeline.fired.slice(before)).toEqual(['tool:commit']);
    expect(pipeline.controller.state.scene.solids).toHaveLength(1);
    // A replacement target under the unchanged cursor cannot auto-execute after Commit.
    for (let index = 0; index < Math.ceil(fps * 2); index++) {
      expect(pipeline.tick(false, 'tool:box').output.phase).toBe('leave-targets');
    }
    expect(pipeline.controller.state.draft).toBeNull(); expect(pipeline.fired.length).toBe(before + 1);
    await pipeline.choose('tool:box'); expect(pipeline.controller.state.draft?.kind).toBe('create');
  });
});
