import { beforeAll, describe, expect, it } from 'vitest';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3, type BufferGeometry } from 'three';
import type { ManifoldToplevel } from 'manifold-3d';
import { buildMesh, initializeKernel } from '../geometry/kernel';
import { Controller } from './controller';
import { parseProjectFile } from './projectFile';
import { exportSolidSTL } from './stlExport';
import type { GeometryMesh, Solid } from '../shared/types';

let kernel: ManifoldToplevel;
beforeAll(async () => {
  const wasm = decodeURIComponent(new URL('../../node_modules/manifold-3d/manifold.wasm', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
  kernel = await initializeKernel(wasm);
});
const box = (): Solid => ({ id: 'box', name: 'Box 1', color: '#b8d7b3', recipe: { kind: 'box', dimensions: [20,30,40] }, position: [10,-3,5], scale: 1.4 });
function signedVolume(geometry: BufferGeometry): number {
  const p = geometry.getAttribute('position'); let volume = 0;
  for (let i = 0; i < p.count; i += 3) {
    const ax = p.getX(i), ay = p.getY(i), az = p.getZ(i);
    const bx = p.getX(i+1), by = p.getY(i+1), bz = p.getZ(i+1);
    const cx = p.getX(i+2), cy = p.getY(i+2), cz = p.getZ(i+2);
    volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  return volume;
}
function checkSTL(solid: Solid, mesh: GeometryMesh) {
  const exported = exportSolidSTL(solid, mesh);
  const view = new DataView(exported.data);
  expect(view.getUint32(80, true)).toBe(mesh.indices.length / 3);
  expect(exported.data.byteLength).toBe(84 + 50 * mesh.indices.length / 3);
  const geometry = new STLLoader().parse(exported.data);
  geometry.computeBoundingBox();
  expect(geometry.getAttribute('position').count).toBe(mesh.indices.length);
  const box = geometry.boundingBox!;
  const dimensions = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
  dimensions.forEach((value, axis) => expect(value).toBeCloseTo(exported.measurements.dimensions[axis], 4));
  expect(signedVolume(geometry)).toBeCloseTo(exported.measurements.volume, 1);
  const normals = geometry.getAttribute('normal');
  for (let i = 0; i < normals.count; i++) expect(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i))).toBeCloseTo(1, 6);
  return { exported, geometry };
}

describe('selected committed solid binary STL export', () => {
  it('writes a transformed exact-size box that an independent STLLoader reads correctly', () => {
    const solid = box(), mesh = buildMesh(kernel, solid.recipe);
    const solidBefore = structuredClone(solid), meshBefore = structuredClone(mesh);
    const { exported, geometry } = checkSTL(solid, mesh);
    expect(exported.measurements.dimensions).toEqual([28,42,56]);
    expect(exported.filename).toBe('Box_1_mm.stl');
    const p = geometry.getAttribute('position');
    const n = geometry.getAttribute('normal');
    // Outward winding is preserved; each box face normal points away from its center.
    for (let i = 0; i < p.count; i += 3) {
      const x = (p.getX(i) + p.getX(i+1) + p.getX(i+2)) / 3 - solid.position[0];
      const y = (p.getY(i) + p.getY(i+1) + p.getY(i+2)) / 3 - solid.position[1];
      const z = (p.getZ(i) + p.getZ(i+1) + p.getZ(i+2)) / 3 - solid.position[2];
      expect(x * n.getX(i) + y * n.getY(i) + z * n.getZ(i)).toBeGreaterThan(0);
    }
    expect(solid).toEqual(solidBefore); expect(mesh).toEqual(meshBefore);
    expect(new TextDecoder().decode(new Uint8Array(exported.data, 0, 80))).toContain('coordinates in millimetres (mm)');
    geometry.dispose();
  });

  it.each([false,true])('preserves the through-hole and applies outer transforms once (precise=%s)', precise => {
    const target: Solid = { ...box(), position: [10,2,0], recipe: { kind: 'box', dimensions: precise ? [20,30,40] : [20,20,20] } };
    const cutter: Solid = { ...target, id: 'cutter', name: 'Cylinder', scale: 1, recipe: { kind: 'cylinder', radius: precise ? 3 : 5, height: 60, segments: 32 } };
    const result: Solid = { ...box(), id: 'result', name: 'Box − Cylinder', position: [-4,3,7], scale: .75, recipe: { kind: 'subtract', target, cutter } };
    const mesh = buildMesh(kernel, result.recipe);
    const { exported, geometry } = checkSTL(result, mesh);
    const radius = precise ? 3 : 5;
    const depth = (precise ? 40 : 20) * 1.4;
    const expected = ((precise ? 24000 : 8000) * 1.4 ** 3 - 32 * .5 * radius ** 2 * Math.sin(2 * Math.PI / 32) * depth) * .75 ** 3;
    expect(signedVolume(geometry)).toBeCloseTo(expected, 1);
    expect(exported.measurements.triangles).toBeGreaterThan(12);
    expect(exported.measurements.min[0]).toBeCloseTo((-4) * .75 - 4, 5);
    expect(exported.measurements.dimensions[2]).toBeCloseTo(depth * .75, 5);
    // Verify the actual opening in the independently loaded surface, not only its volume.
    const material = new MeshBasicMaterial({ side: DoubleSide });
    const loadedMesh = new Mesh(geometry, material); loadedMesh.updateMatrixWorld();
    const centerX = 10 * .75 - 4, centerY = 2 * .75 + 3;
    const throughHole = new Raycaster(new Vector3(centerX, centerY, 107), new Vector3(0,0,-1));
    const throughRim = new Raycaster(new Vector3(centerX + (radius + .8) * .75, centerY, 107), new Vector3(0,0,-1));
    expect(throughHole.intersectObject(loadedMesh)).toHaveLength(0);
    expect(throughRim.intersectObject(loadedMesh).length).toBeGreaterThan(0);
    material.dispose();
    geometry.dispose();
  });

  it('exports an authoritative rebuilt mesh after JSON reopening without changing the scene or Undo', async () => {
    const geometry = { build: async (recipe: Solid['recipe']) => buildMesh(kernel, recipe) };
    const first = new Controller(geometry); first.beginCreate('Box'); first.applySizePreset('box:y:30'); first.applySizePreset('box:z:40'); await first.commit();
    first.beginScale(); first.updateScale(1.4); await first.commit();
    const reopened = new Controller(geometry);
    await reopened.restore(parseProjectFile(JSON.stringify(first.exportDocument())));
    const before = structuredClone(reopened.state);
    const solid = reopened.state.scene.solids[0];
    const { exported, geometry: loaded } = checkSTL(solid, reopened.meshes.get(solid.id)!);
    expect(exported.measurements.dimensions).toEqual([28,42,56]);
    expect(reopened.state).toEqual(before); expect(reopened.state.historyCount).toBe(0);
    loaded.dispose();
  });

  it.each(['Cable / bracket: A?', '../CON', '🖐️', '', 'a'.repeat(200)])('creates a bounded safe download name from %j', name => {
    const solid = { ...box(), name };
    const { filename } = exportSolidSTL(solid, buildMesh(kernel, solid.recipe));
    expect(filename).toMatch(/^[A-Za-z0-9_-]{1,80}_mm\.stl$/);
  });

  it.each([
    ['duplicate vertices', (mesh: GeometryMesh) => { mesh.indices[1] = mesh.indices[0]; }],
    ['nonfinite coordinates', (mesh: GeometryMesh) => { mesh.positions[0] = Infinity; }],
    ['float32 overflow', (mesh: GeometryMesh) => { mesh.positions.fill(3e38); }],
  ] as const)('rejects %s rather than creating an unusable file', (_, mutate) => {
    const solid = box(), mesh = buildMesh(kernel, solid.recipe); mutate(mesh);
    expect(() => exportSolidSTL(solid, mesh)).toThrow();
  });

  it('does not return source-owned or shared export buffers', () => {
    const solid = box(), mesh = buildMesh(kernel, solid.recipe);
    const first = exportSolidSTL(solid, mesh), second = exportSolidSTL(solid, mesh);
    new Uint8Array(first.data).fill(0);
    expect(new DataView(second.data).getUint32(80, true)).toBe(12);
    expect(mesh.volume).toBe(24000);
  });
});
