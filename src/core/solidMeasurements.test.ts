import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { buildMesh, initializeKernel } from '../geometry/kernel';
import type { GeometryMesh, Solid } from '../shared/types';
import { measureSolid } from './solidMeasurements';

let kernel: ManifoldToplevel;
beforeAll(async () => {
  const wasm = decodeURIComponent(new URL('../../node_modules/manifold-3d/manifold.wasm', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
  kernel = await initializeKernel(wasm);
});
const box = (): Solid => ({ id: 'box', name: 'Box', color: '#b8d7b3', recipe: { kind: 'box', dimensions: [20,30,40] }, position: [10,-3,5], scale: 1.4 });

describe('final solid dimensions from authoritative geometry', () => {
  it('measures independent box dimensions, scaled volume and translated bounds without mutation', () => {
    const solid = box(), mesh = buildMesh(kernel, solid.recipe);
    const beforeSolid = structuredClone(solid), beforeMesh = structuredClone(mesh);
    expect(measureSolid(solid, mesh)).toEqual({ min: [-4,-24,-23], max: [24,18,33], dimensions: [28,42,56], volume: 24000 * 1.4 ** 3, triangles: 12 });
    expect(solid).toEqual(beforeSolid); expect(mesh).toEqual(beforeMesh);
    const first = measureSolid(solid, mesh); first.dimensions[0] = 999;
    expect(measureSolid(solid, mesh).dimensions).toEqual([28,42,56]);
  });

  it('reports the Z-axis cylinder height separately from its diameter', () => {
    const solid: Solid = { ...box(), recipe: { kind: 'cylinder', radius: 3, height: 60, segments: 32 }, scale: .5 };
    const result = measureSolid(solid, buildMesh(kernel, solid.recipe));
    expect(result.dimensions).toEqual([3,3,30]);
    expect(result.volume).toBeCloseTo(32 * .5 * 9 * Math.sin(2 * Math.PI / 32) * 60 * .5 ** 3, 5);
  });

  it('measures a Boolean result rather than assuming the target recipe bounds survive', () => {
    const target: Solid = { ...box(), scale: 1, position: [0,0,0], recipe: { kind: 'box', dimensions: [20,20,20] } };
    const cutter: Solid = { ...target, id: 'cutter', position: [10,0,0] };
    const result: Solid = { ...box(), scale: 2, position: [-5,2,3], recipe: { kind: 'subtract', target, cutter } };
    const measurements = measureSolid(result, buildMesh(kernel, result.recipe));
    expect(measurements.dimensions).toEqual([20,40,40]);
    expect(measurements.min).toEqual([-25,-18,-17]);
    expect(measurements.max).toEqual([-5,22,23]);
    expect(measurements.volume).toBeCloseTo(32000, 5);
  });

  it('ignores unused vertices when finding visible extents', () => {
    const solid = box(), mesh = buildMesh(kernel, solid.recipe);
    const positions = new Float32Array(mesh.positions.length + 3); positions.set(mesh.positions); positions.set([9999,9999,9999], mesh.positions.length);
    expect(measureSolid(solid, { ...mesh, positions }).dimensions).toEqual([28,42,56]);
  });

  it.each([
    ['empty vertices', (mesh: GeometryMesh) => { mesh.positions = new Float32Array(); }],
    ['incomplete vertices', (mesh: GeometryMesh) => { mesh.positions = new Float32Array([0,0,0,1]); }],
    ['nonfinite vertices', (mesh: GeometryMesh) => { mesh.positions[0] = NaN; }],
    ['empty triangles', (mesh: GeometryMesh) => { mesh.indices = new Uint32Array(); }],
    ['incomplete triangles', (mesh: GeometryMesh) => { mesh.indices = new Uint32Array([0,1]); }],
    ['out of range indices', (mesh: GeometryMesh) => { mesh.indices[0] = mesh.positions.length; }],
    ['invalid volume', (mesh: GeometryMesh) => { mesh.volume = Infinity; }],
    ['zero volume', (mesh: GeometryMesh) => { mesh.volume = 0; }],
    ['scaled volume overflow', (mesh: GeometryMesh) => { mesh.volume = Number.MAX_VALUE; }],
  ] as const)('rejects %s', (_, mutate) => {
    const solid = box(), mesh = buildMesh(kernel, solid.recipe); mutate(mesh);
    expect(() => measureSolid(solid, mesh)).toThrow();
  });

  it.each([
    (solid: Solid) => { solid.scale = 0; },
    (solid: Solid) => { solid.scale = -1; },
    (solid: Solid) => { solid.scale = NaN; },
    (solid: Solid) => { solid.position[1] = Infinity; },
    (solid: Solid) => { solid.position[0] = 501; },
  ])('rejects invalid outer transforms (%#)', mutate => {
    const solid = box(), mesh = buildMesh(kernel, solid.recipe); mutate(solid);
    expect(() => measureSolid(solid, mesh)).toThrow();
  });
});
