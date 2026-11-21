import { describe, expect, it, vi } from 'vitest';
import { Controller } from './controller';
import { getSizePreset, SIZE_PRESETS } from './presets';
import type { GeometryAdapter, GeometryMesh } from '../shared/types';

const mesh = (): GeometryMesh => ({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]), volume: 8000 });
const geometry = (): GeometryAdapter => ({ build: vi.fn(async () => mesh()) });

describe('precise primitive size presets', () => {
  it('exposes a unique immutable allowlist and rejects unlisted dimensions', () => {
    expect(SIZE_PRESETS).toHaveLength(30);
    expect(new Set(SIZE_PRESETS.map(preset => preset.key)).size).toBe(30);
    expect(Reflect.set(SIZE_PRESETS, 0, null)).toBe(false);
    expect(Reflect.set(SIZE_PRESETS[0], 'value', 999)).toBe(false);
    expect(getSizePreset('box:x:25')).toBeUndefined(); expect(getSizePreset('__proto__')).toBeUndefined();
    expect(getSizePreset('box:x:20')?.value).toBe(20);
  });

  it.each(SIZE_PRESETS.filter(preset => preset.primitive === 'Box' || preset.primitive === 'Cylinder'))('applies exactly $key to its corresponding draft field', preset => {
    const controller = new Controller(geometry()); controller.beginCreate(preset.primitive);
    controller.applySizePreset(preset.key);
    const draft = controller.state.draft;
    expect(draft?.kind).toBe('create'); if (draft?.kind !== 'create') throw Error('Missing create draft');
    if (draft.solid.recipe.kind === 'box' && preset.primitive === 'Box') {
      const axis = { x: 0, y: 1, z: 2 }[preset.field];
      expect(draft.solid.recipe.dimensions[axis]).toBe(preset.value);
      expect(draft.solid.recipe.dimensions.filter((_, index) => index !== axis)).toEqual([20, 20]);
    } else if (draft.solid.recipe.kind === 'cylinder' && preset.primitive === 'Cylinder') {
      expect(draft.solid.recipe[preset.field]).toBe(preset.value);
      expect(draft.solid.recipe.segments).toBe(32);
      expect(preset.field === 'radius' ? draft.solid.recipe.height : draft.solid.recipe.radius).toBe(preset.field === 'radius' ? 60 : 5);
    } else throw Error('Preset affected the wrong primitive');
    expect(controller.state.scene.solids).toHaveLength(0);
  });

  it('preserves defaults and combines independent box axes without changing earlier drafts', () => {
    const controller = new Controller(geometry()); controller.beginCreate('Box');
    const original = controller.state.draft;
    expect(original).toMatchObject({ solid: { recipe: { kind: 'box', dimensions: [20, 20, 20] } } });
    if (original?.kind !== 'create') throw Error('Missing draft');
    const oldSolid = original.solid, oldRecipe = original.solid.recipe;
    oldSolid.position = [12, -4, 0];
    expect(controller.applySizePreset('box:x:30')).toBe(true);
    expect(controller.applySizePreset('box:y:40')).toBe(true);
    expect(controller.applySizePreset('box:z:30')).toBe(true);
    expect(controller.state.draft).not.toBe(original);
    expect(controller.state.draft?.kind === 'create' && controller.state.draft.solid).not.toBe(oldSolid);
    expect(controller.state.draft).toMatchObject({ solid: { id: oldSolid.id, position: [12, -4, 0], recipe: { kind: 'box', dimensions: [30, 40, 30] } } });
    expect(oldRecipe).toEqual({ kind: 'box', dimensions: [20, 20, 20] });
    expect(controller.getDraftAST()).toMatchObject({ type: 'Create', objectId: oldSolid.id, dimensions: [30, 40, 30], position: [12, -4, 0] });
  });

  it('keeps precise cylinder radius and height in the geometry recipe and committed AST', async () => {
    const adapter = geometry(); const controller = new Controller(adapter); controller.beginCreate('Cylinder');
    expect(controller.getDraftAST()).toMatchObject({ dimensions: [5, 60] });
    controller.applySizePreset('cylinder:radius:3'); controller.applySizePreset('cylinder:height:40');
    expect(controller.getDraftAST()).toMatchObject({ primitive: 'Cylinder', dimensions: [3, 40] });
    expect(await controller.commit()).toBe(true);
    expect(adapter.build).toHaveBeenCalledWith({ kind: 'cylinder', radius: 3, height: 40, segments: 32 });
    expect(controller.state.lastCommand?.ast).toMatchObject({ primitive: 'Cylinder', dimensions: [3, 40] });
    expect(controller.state.scene.solids[0].recipe).toEqual({ kind: 'cylinder', radius: 3, height: 40, segments: 32 });
  });

  it('cancels presets without mutating committed state and undoes a preset creation exactly', async () => {
    const controller = new Controller(geometry()); controller.beginCreate('Box'); await controller.commit();
    const original = controller.exportDocument(); controller.beginCreate('Box'); controller.applySizePreset('box:x:40'); controller.cancel();
    expect(controller.exportDocument()).toEqual(original);
    controller.beginCreate('Cylinder'); controller.applySizePreset('cylinder:radius:8'); controller.applySizePreset('cylinder:height:20'); await controller.commit();
    expect(controller.state.scene.solids).toHaveLength(2); controller.undo();
    expect(controller.state.scene.solids).toEqual(original.solids); expect(controller.state.scene.commands).toEqual(original.commands);
  });

  it('rejects inactive, wrong-primitive, invalid, paused, and unchanged selections without emissions', () => {
    const controller = new Controller(geometry());
    expect(controller.applySizePreset('box:x:30')).toBe(false); controller.beginCreate('Box');
    const draft = controller.state.draft; const changed = vi.fn(); const unsubscribe = controller.subscribe(changed); changed.mockClear();
    for (const key of ['box:x:20', 'box:y:20', 'box:z:20', 'cylinder:radius:3', 'box:x:25', 'box:x:30.0', '__proto__']) expect(controller.applySizePreset(key)).toBe(false);
    expect(changed).not.toHaveBeenCalled(); expect(controller.state.draft).toBe(draft);
    controller.setPaused(true); changed.mockClear(); expect(controller.applySizePreset('box:x:40')).toBe(false);
    expect(changed).not.toHaveBeenCalled(); expect(controller.state.draft).toBe(draft); unsubscribe();
  });

  it('cannot change dimensions while a creation is committing', async () => {
    let resolve!: (mesh: GeometryMesh) => void;
    const controller = new Controller({ build: () => new Promise<GeometryMesh>(done => { resolve = done; }) });
    controller.beginCreate('Box'); controller.applySizePreset('box:x:30'); const committing = controller.commit();
    const draft = controller.state.draft; const changed = vi.fn(); const unsubscribe = controller.subscribe(changed); changed.mockClear();
    expect(controller.applySizePreset('box:x:40')).toBe(false); expect(changed).not.toHaveBeenCalled(); expect(controller.state.draft).toBe(draft);
    resolve(mesh()); expect(await committing).toBe(true);
    expect(controller.state.scene.solids[0].recipe).toEqual({ kind: 'box', dimensions: [30, 20, 20] }); unsubscribe();
  });

  it('rejects presets during a transform draft', async () => {
    const controller = new Controller(geometry()); controller.beginCreate('Box'); await controller.commit(); controller.beginScale();
    const draft = controller.state.draft; expect(controller.applySizePreset('box:x:40')).toBe(false); expect(controller.state.draft).toBe(draft);
    expect(controller.state.scene.solids[0].recipe).toEqual({ kind: 'box', dimensions: [20, 20, 20] });
  });
});
