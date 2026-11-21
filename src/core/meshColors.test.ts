import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import type { Mesh } from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { buildMesh, initializeKernel } from '../geometry/kernel';
import type { GeometryAdapter, GeometryMesh, Solid } from '../shared/types';
import { Controller } from './controller';
import { makeMeshAsset, verifyAssetId } from './meshAsset';
import { exportSolidOBJ } from './meshFile';
import { parseMeshBytes, objMaterialNames } from './meshParsing';
import { parseProjectFile } from './projectFile';
import { exportSolidSTL } from './stlExport';

const obj = `
mtllib "part colours.mtl"
v 0 0 0
v 10 0 0
v 0 10 0
v 0 0 10
usemtl red
f 1 3 2
f 1 2 4
usemtl blue
f 1 4 3
f 2 3 4
`;
const library = new Map([['part colours.mtl', 'newmtl red\nKd 1 0 0\nnewmtl blue\nKd 0 0 1']]);
const encode = (text: string) => new TextEncoder().encode(text).buffer;
const colorsIn = (array: Uint8Array) => new Set(Array.from({ length: array.length / 3 }, (_, index) => Array.from(array.subarray(index * 3, index * 3 + 3)).join(',')));
let kernel: ManifoldToplevel;
beforeAll(async () => {
  const wasm = decodeURIComponent(new URL('../../node_modules/manifold-3d/manifold.wasm', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
  kernel = await initializeKernel(wasm);
});

describe('preserving solid and face colours', () => {
  it('reads local MTL diffuse colours and honours inline vertex RGB', () => {
    expect(objMaterialNames(obj)).toEqual(['part colours.mtl']);
    expect(parseMeshBytes(encode(obj), 'obj', 'mm').colors).toBeUndefined();
    const colored = parseMeshBytes(encode(obj.replace('v 0 0 0', 'v 0 0 0 0 1 0')), 'obj', 'mm', library);
    expect(colorsIn(colored.colors!)).toEqual(new Set(['255,0,0', '0,0,255', '0,255,0']));
  });

  it('keeps seams in the validated preview, JSON reopen and both independent mesh readers', async () => {
    const parsed = parseMeshBytes(encode(obj), 'obj', 'mm', library);
    const asset = await makeMeshAsset(parsed.positions, parsed.indices, parsed.colors);
    const recipe = { kind: 'mesh' as const, assetId: asset.id };
    const mesh = buildMesh(kernel, recipe, [asset]);
    const before = colorsIn(mesh.colors!);
    expect(before).toEqual(new Set(['255,0,0', '0,0,255']));
    expect(mesh.volume).toBeCloseTo(1000 / 6);
    const geometry: GeometryAdapter = { build: async (recipe, assets) => buildMesh(kernel, recipe, assets) };
    const app = new Controller(geometry);
    expect(app.beginImport('part.obj', { asset, mesh, dimensions: [10,10,10] })).toBe(true);
    expect(app.state.draft?.kind).toBe('import');
    expect(await app.commit()).toBe(true);
    const saved = parseProjectFile(JSON.stringify(app.exportDocument()));
    expect(saved.assets?.[0].colors).toBe(asset.colors);
    const reopened = new Controller(geometry);
    expect(await reopened.restore(saved)).toBe(true);
    const solid = reopened.state.scene.solids[0];
    const rebuilt = reopened.meshes.get(solid.id)!;
    expect(colorsIn(rebuilt.colors!)).toEqual(before);
    const stl = exportSolidSTL(solid, rebuilt).data;
    const stlGeometry = new STLLoader().parse(stl);
    expect(stlGeometry.getAttribute('color').count).toBe(12);
    stlGeometry.dispose();
    expect(colorsIn(parseMeshBytes(stl, 'stl', 'mm').colors!)).toEqual(before);
    expect(parseMeshBytes(exportSolidSTL(solid, rebuilt, false).data, 'stl', 'mm').colors).toBeUndefined();
    const exported = exportSolidOBJ(solid, rebuilt).data;
    const objGroup = new OBJLoader().parse(exported);
    const objGeometry = (objGroup.children[0] as Mesh).geometry;
    expect(objGeometry.getAttribute('color').count).toBe(12);
    objGeometry.dispose();
    expect(colorsIn(parseMeshBytes(encode(exported), 'obj', 'mm').colors!)).toEqual(before);
    await expect(verifyAssetId({ ...asset, colors: asset.colors!.replace(/^./, value => value === 'A' ? 'B' : 'A') })).rejects.toThrow();
  });

  it('reimports a single native body colour exactly in both mesh formats', () => {
    const solid: Solid = { id: 'box', name: 'Box', recipe: { kind: 'box', dimensions: [10,10,10] }, color: '#13a9ef', position: [0,0,0], scale: 1 };
    const mesh: GeometryMesh = buildMesh(kernel, solid.recipe);
    const stl = parseMeshBytes(exportSolidSTL(solid, mesh).data, 'stl', 'mm');
    const exported = parseMeshBytes(encode(exportSolidOBJ(solid, mesh).data), 'obj', 'mm');
    expect(colorsIn(stl.colors!)).toEqual(new Set(['19,169,239']));
    expect(colorsIn(exported.colors!)).toEqual(colorsIn(stl.colors!));
  });

  it('gives newly exposed Boolean faces a colour while preserving coloured source faces', async () => {
    const parsed = parseMeshBytes(encode(obj), 'obj', 'mm', library);
    const asset = await makeMeshAsset(parsed.positions, parsed.indices, parsed.colors);
    const target: Solid = { id: 'stock', name: 'Stock', recipe: { kind: 'mesh', assetId: asset.id }, color: '#ff0000', position: [0,0,0], scale: 1 };
    const cutter: Solid = { id: 'cutter', name: 'Cutter', recipe: { kind: 'box', dimensions: [2,2,2] }, color: '#00ff00', position: [2,2,0], scale: 1 };
    const result = buildMesh(kernel, { kind: 'subtract', target, cutter }, [asset]);
    expect(result.volume).toBeCloseTo(1000 / 6 - 4);
    expect(colorsIn(result.colors!)).toEqual(new Set(['255,0,0', '0,0,255', '0,255,0']));
  });
});
