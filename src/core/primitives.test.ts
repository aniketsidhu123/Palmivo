import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { Controller } from './controller';
import { SIZE_PRESETS } from './presets';
import { validateDocument } from './validation';
import { parseProjectFile } from './projectFile';
import { buildMesh, initializeKernel } from '../geometry/kernel';
import type { GeometryAdapter, Primitive } from '../shared/types';

let module: ManifoldToplevel;
beforeAll(async () => {
  const location = decodeURIComponent(new URL('../../node_modules/manifold-3d/manifold.wasm', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
  module = await initializeKernel(location);
});
const adapter: GeometryAdapter = { build: async recipe => buildMesh(module, recipe) };
const shapes = [
  { primitive: 'Sphere' as const, recipe: { kind: 'sphere', radius: 10, segments: 32 }, dimensions: [10], halfExtents: [10,10,10] },
  { primitive: 'Cone' as const, recipe: { kind: 'cone', radius: 10, height: 20, segments: 32 }, dimensions: [10,20], halfExtents: [10,10,10] },
  { primitive: 'Pyramid' as const, recipe: { kind: 'pyramid', base: 20, height: 20 }, dimensions: [20,20], halfExtents: [10,10,10] },
];
const create = async (controller: Controller, primitive: Primitive) => { controller.beginCreate(primitive); expect(await controller.commit()).toBe(true); return controller.state.selectedId!; };

describe('additional primitive compiler and actual WASM solids', () => {
  it.each(shapes)('previews $primitive defaults, commits valid v3, and round-trips its real geometry', async shape => {
    const controller = new Controller(adapter); controller.beginCreate(shape.primitive);
    expect(controller.state.draft).toMatchObject({ kind: 'create', solid: { recipe: shape.recipe } });
    expect(controller.getDraftAST()).toMatchObject({ type: 'Create', primitive: shape.primitive, dimensions: shape.dimensions });
    expect(controller.state.scene.schemaVersion).toBe(1); expect(controller.state.scene.solids).toHaveLength(0);
    expect(await controller.commit()).toBe(true); expect(controller.state.scene.schemaVersion).toBe(3);
    const saved = controller.exportDocument(); expect(() => validateDocument(saved)).not.toThrow();
    const mesh = controller.meshes.get(controller.state.selectedId!)!;
    for (const [axis, extent] of shape.halfExtents.entries()) {
      const values = Array.from(mesh.positions).filter((_, index) => index % 3 === axis);
      expect(Math.min(...values)).toBeCloseTo(-extent, 4); expect(Math.max(...values)).toBeCloseTo(extent, 4);
    }
    if (shape.primitive === 'Cone') expect(mesh.volume).toBeCloseTo(32 * .5 * 100 * Math.sin(2*Math.PI/32) * 20 / 3, 4);
    else if (shape.primitive === 'Pyramid') expect(mesh.volume).toBeCloseTo(20 * 20 * 20 / 3, 4);
    else { const exactSphere = 4 / 3 * Math.PI * 10 ** 3; expect(mesh.volume).toBeGreaterThan(exactSphere * .97); expect(mesh.volume).toBeLessThan(exactSphere); }
    const reopened = new Controller(adapter); expect(await reopened.restore(parseProjectFile(JSON.stringify(saved)))).toBe(true);
    expect(reopened.exportDocument()).toEqual(saved); expect(reopened.meshes.get(saved.solids[0].id)!.volume).toBeCloseTo(mesh.volume, 6);
    expect(reopened.state.historyCount).toBe(0);
  });

  it.each(SIZE_PRESETS.filter(preset => !['Box','Cylinder'].includes(preset.primitive)))('applies $key without altering shape identity, then commits exact dimensions', async preset => {
    const controller = new Controller(adapter); controller.beginCreate(preset.primitive);
    const original = controller.state.draft; if (original?.kind !== 'create') throw Error('Missing creation draft');
    controller.applySizePreset(preset.key);
    const next = controller.state.draft; if (next?.kind !== 'create') throw Error('Missing preset draft');
    expect(next.solid.id).toBe(original.solid.id); expect(next.solid.position).toEqual(original.solid.position);
    const recipe = next.solid.recipe;
    if (recipe.kind === 'sphere') expect(recipe.radius).toBe(preset.value);
    else if (recipe.kind === 'cone' && preset.primitive === 'Cone') expect(recipe[preset.field]).toBe(preset.value);
    else if (recipe.kind === 'pyramid' && preset.primitive === 'Pyramid') expect(recipe[preset.field]).toBe(preset.value);
    else throw Error('Wrong primitive recipe');
    const ast = controller.getDraftAST(); expect(await controller.commit()).toBe(true);
    expect(controller.state.lastCommand!.ast).toEqual(ast); expect(controller.state.scene.solids[0].recipe).toEqual(recipe);
  });

  it.each(shapes)('preserves committed state when a $primitive draft is cancelled and restores it on Undo', async shape => {
    const controller = new Controller(adapter); await create(controller, 'Box'); const before = controller.exportDocument();
    controller.beginCreate(shape.primitive); controller.cancel(); expect(controller.exportDocument()).toEqual(before);
    await create(controller, shape.primitive); expect(controller.state.scene.solids).toHaveLength(2);
    controller.undo(); expect(controller.state.scene.solids).toEqual(before.solids); expect(controller.state.scene.commands).toEqual(before.commands); expect(controller.state.scene.schemaVersion).toBe(1);
  });

  it.each(shapes)('requires schema v3 for $primitive recipes and saved ASTs', async shape => {
    const controller = new Controller(adapter); await create(controller, shape.primitive); const saved = controller.exportDocument();
    for (const version of [1,2] as const) {
      const legacy = structuredClone(saved); legacy.schemaVersion = version; expect(() => validateDocument(legacy)).toThrow(/version 3/);
      legacy.solids = []; expect(() => validateDocument(legacy)).toThrow(/version 3/);
    }
  });

  it('preserves v3 when a new primitive participates in Union and Subtract', async () => {
    const controller = new Controller(adapter); const sphere = await create(controller, 'Sphere'); const cone = await create(controller, 'Cone');
    controller.select(sphere); controller.beginUnion(); controller.chooseUnionOperand(cone); expect(await controller.commit()).toBe(true);
    expect(controller.state.scene.schemaVersion).toBe(3); expect(() => validateDocument(controller.exportDocument())).not.toThrow();
    const joined = controller.state.selectedId!; const cylinder = await create(controller, 'Cylinder');
    controller.select(joined); controller.beginSubtract(); controller.chooseCutter(cylinder); expect(await controller.commit()).toBe(true);
    expect(controller.state.scene.schemaVersion).toBe(3); expect(() => validateDocument(controller.exportDocument())).not.toThrow();
    expect(controller.meshes.get(controller.state.selectedId!)!.volume).toBeGreaterThan(0);
  });
});
