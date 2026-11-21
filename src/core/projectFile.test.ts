import { describe, expect, it, vi } from 'vitest';
import exampleProject from '../../examples/through-hole-project.json';
import { Controller } from './controller';
import { MAX_PROJECT_FILE_BYTES, parseProjectFile } from './projectFile';
import { MAX_RECIPE_NODES, validateDocument } from './validation';
import type { GeometryAdapter, GeometryMesh, SceneDocument, Solid } from '../shared/types';

const box = (id = 'box-1'): Solid => ({ id, name: 'Box 1', color: '#b8d7b3', position: [3, -2, 0], scale: 1.4, recipe: { kind: 'box', dimensions: [20, 30, 40] } });
const project = (): SceneDocument => ({
  schemaVersion: 1, units: 'mm', revision: 6, solids: [box()], commands: [
    { commandId: 'cmd-create', baseSceneRevision: 0, source: 'gesture-rules', ast: { type: 'Create', objectId: 'box-1', primitive: 'Box', dimensions: [20, 30, 40], position: [0, 0, 0] } },
    { commandId: 'cmd-move', baseSceneRevision: 1, source: 'pointer', ast: { type: 'Move', targetId: 'box-1', position: [3, -2, 0] } },
    { commandId: 'cmd-scale', baseSceneRevision: 2, source: 'keyboard', ast: { type: 'Scale', targetId: 'box-1', uniformScale: 1.4 } },
  ],
});
const parse = (value: unknown) => parseProjectFile(JSON.stringify(value));
const mesh = (): GeometryMesh => ({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]), volume: 8000 });

describe('reopening exported projects', () => {
  it('round-trips exact dimensions, transforms and all saved input sources in an isolated document', () => {
    const original = project(); const reopened = parse(original);
    expect(reopened).toEqual(original);
    reopened.solids[0].position[0] = 90;
    expect(original.solids[0].position[0]).toBe(3);
    expect(parse({ ...project(), solids: [] })).toMatchObject({ solids: [] });
  });

  it('opens the existing version 1 through-hole export, including history for removed operands', () => {
    const reopened = parse(exampleProject);
    expect(reopened.solids).toHaveLength(1);
    expect(reopened.solids[0].recipe).toMatchObject({ kind: 'subtract', target: { scale: 1.4 }, cutter: { recipe: { kind: 'cylinder', radius: 5, height: 60 } } });
    expect(reopened.commands.at(-1)?.ast).toEqual({ type: 'Subtract', targetId: 'example-box', cutterId: 'example-cylinder', resultId: 'example-through-hole' });
  });
  it('reads Union recipes and commands only in version 2', () => {
    const target = box('first'), other = box('second');
    const saved = project();
    saved.schemaVersion = 2;
    saved.solids = [{ ...box('result'), recipe: { kind: 'union', target, other } }];
    saved.commands[0].ast = { type: 'Union', targetId: target.id, otherId: other.id, resultId: 'result' };
    expect(parse(saved)).toEqual(saved);
    expect(() => parse({ ...saved, schemaVersion: 1 })).toThrow(/Union recipes require.*version 2/);
    expect(() => parse({ ...saved, schemaVersion: 1, solids: [] })).toThrow(/Union commands require.*version 2/);
    other.id = target.id;
    expect(() => parse(saved)).toThrow(/different solids/);
    other.id = 'second';
    saved.commands[0].ast.resultId = target.id;
    expect(() => parse(saved)).toThrow(/result ID/);
  });

  it.each(['', '{"schemaVersion":', 'null', '[]', '{"schemaVersion":4,"units":"mm"}'])('rejects malformed or unsupported project %j', text => {
    expect(() => parseProjectFile(text)).toThrow(/JSON|format/);
  });

  it('checks UTF-8 byte size before JSON parsing', () => {
    expect(() => parseProjectFile(' '.repeat(MAX_PROJECT_FILE_BYTES + 1))).toThrow(/8 MiB/);
    expect(() => parseProjectFile('é'.repeat(MAX_PROJECT_FILE_BYTES / 2 + 1))).toThrow(/8 MiB/);
  });

  it.each([
    (doc: SceneDocument) => { doc.schemaVersion = 4 as never; },
    (doc: SceneDocument) => { doc.units = 'inch' as 'mm'; },
    (doc: SceneDocument) => { doc.revision = -1; },
    (doc: SceneDocument) => { doc.revision = 1.5; },
    (doc: SceneDocument) => { doc.solids.push(structuredClone(doc.solids[0])); },
    (doc: SceneDocument) => { doc.solids = Array.from({ length: 11 }, (_, i) => box(`box-${i}`)); },
    (doc: SceneDocument) => { doc.solids[0].position[0] = 501; },
    (doc: SceneDocument) => { doc.solids[0].scale = 2.01; },
    (doc: SceneDocument) => { doc.solids[0].recipe = { kind: 'box', dimensions: [0, 20, 20] }; },
    (doc: SceneDocument) => { doc.solids[0].recipe = { kind: 'cylinder', radius: 151, height: 20, segments: 32 }; },
    (doc: SceneDocument) => { doc.solids[0].recipe = { kind: 'cylinder', radius: 5, height: 301, segments: 32 }; },
    (doc: SceneDocument) => { doc.solids[0].recipe = { kind: 'cylinder', radius: 5, height: 60, segments: 7 }; },
    (doc: SceneDocument) => { doc.solids[0].recipe = { kind: 'mesh', url: 'https://example.test/model.stl' } as never; },
    (doc: SceneDocument) => { (doc as unknown as Record<string, unknown>).script = 'arbitrary text'; },
  ])('rejects invalid scene data without accepting another CAD format (%#)', mutate => {
    const invalid = project(); mutate(invalid); expect(() => parse(invalid)).toThrow();
  });

  it.each([
    (doc: SceneDocument) => { doc.commands[0].commandId = ''; },
    (doc: SceneDocument) => { doc.commands.push(structuredClone(doc.commands[0])); },
    (doc: SceneDocument) => { doc.commands[0].baseSceneRevision = -1; },
    (doc: SceneDocument) => { doc.commands[0].source = 'script' as never; },
    (doc: SceneDocument) => { doc.commands[0].ast = { type: 'Create' } as never; },
    (doc: SceneDocument) => { doc.commands[0].ast = { type: 'Create', objectId: 'box', primitive: 'Box', dimensions: [20, 30], position: [0, 0, 0] }; },
    (doc: SceneDocument) => { doc.commands[0].ast = { type: 'Move', targetId: '', position: [0, 0, 0] }; },
    (doc: SceneDocument) => { doc.commands[0].ast = { type: 'Scale', targetId: 'old-object', uniformScale: 100 }; },
    (doc: SceneDocument) => { doc.commands[0].ast = { type: 'Subtract', targetId: 'same', cutterId: 'same', resultId: 'result' }; },
    (doc: SceneDocument) => { doc.commands[0].ast = { type: 'Subtract', targetId: 'target', cutterId: 'cutter', resultId: 'target' }; },
    (doc: SceneDocument) => { doc.commands[0].ast = { type: 'ExecuteCode', code: 'text' } as never; },
  ])('validates complete saved command shape (%#)', mutate => {
    const invalid = project(); mutate(invalid); expect(() => parse(invalid)).toThrow();
  });

  it('rejects nonfinite runtime values and malformed record/array shapes with useful errors', () => {
    const invalid = project(); invalid.solids[0].position[0] = Infinity;
    expect(() => validateDocument(invalid)).toThrow(/finite/);
    expect(() => parse({ ...project(), solids: [null] })).toThrow(/solid/);
    expect(() => parse({ ...project(), commands: [null] })).toThrow(/command/);
    expect(() => parse({ ...project(), solids: { 0: box(), length: 1 } })).toThrow(/10 visible/);
    const stringDimension = project(); stringDimension.solids[0].recipe = { kind: 'box', dimensions: ['20', 30, 40] } as never;
    expect(() => parse(stringDimension)).toThrow(/dimensions/);
  });

  it('bounds total recipe nodes across all visible solids, not only nesting depth', () => {
    let sequence = 0;
    const tree = (depth: number): Solid => {
      const solid = box(`tree-${sequence++}`);
      if (depth > 0) solid.recipe = { kind: 'subtract', target: tree(depth - 1), cutter: tree(depth - 1) };
      return solid;
    };
    const invalid = project(); invalid.solids = [tree(10), box('extra'), box('last')];
    expect(sequence).toBe(2047); expect(MAX_RECIPE_NODES).toBe(2048);
    expect(() => parse(invalid)).toThrow(/complexity/);
  });

  it('rejects excessive depth and cyclic recipes before rebuilding geometry', () => {
    let nested = box('start');
    for (let i = 0; i < 32; i++) nested = { ...box(`layer-${i}`), recipe: { kind: 'subtract', target: nested, cutter: box(`cut-${i}`) } };
    expect(() => parse({ ...project(), solids: [nested] })).toThrow(/nested/);
    const cyclic = box('cyclic'); cyclic.recipe = { kind: 'subtract', target: cyclic, cutter: box('cut') };
    expect(() => validateDocument({ ...project(), solids: [cyclic] })).toThrow(/nested/);
  });

  it('rebuilds before replacing the current scene and clears session Undo only after success', async () => {
    const geometry: GeometryAdapter = { build: vi.fn(async () => mesh()) };
    const controller = new Controller(geometry); controller.beginCreate('Box'); await controller.commit();
    const saved = parse(project());
    expect(await controller.restore(saved)).toBe(true);
    expect(controller.exportDocument()).toEqual(saved);
    expect(controller.state.selectedId).toBe('box-1'); expect(controller.state.historyCount).toBe(0);
    expect(controller.meshes.size).toBe(1);
    saved.solids[0].position[0] = 400;
    expect(controller.state.scene.solids[0].position[0]).toBe(3);
  });

  it('preserves the existing scene, selection, meshes, draft and Undo when a reopened recipe fails', async () => {
    const geometry: GeometryAdapter = { build: vi.fn(async () => mesh()) };
    const controller = new Controller(geometry); controller.beginCreate('Box'); await controller.commit();
    controller.beginMove(); controller.updateMove([8, 0, 0]);
    const before = controller.exportDocument(); const selected = controller.state.selectedId;
    const priorMeshes = [...controller.meshes]; const draft = structuredClone(controller.state.draft);
    vi.mocked(geometry.build).mockRejectedValueOnce(new Error('Empty Boolean result'));
    expect(await controller.restore(parse(project()))).toBe(false);
    expect(controller.exportDocument()).toEqual(before); expect(controller.state.selectedId).toBe(selected);
    expect([...controller.meshes]).toEqual(priorMeshes); expect(controller.state.draft).toEqual(draft);
    expect(controller.state.historyCount).toBe(1); expect(controller.state.busy).toBe(false);
    controller.cancel(); controller.undo(); expect(controller.state.scene.solids).toHaveLength(0);
  });
});
