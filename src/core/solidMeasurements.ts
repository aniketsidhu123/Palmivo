import type { GeometryMesh, Solid, Vec3 } from '../shared/types';
import { validatePosition, validateScale } from './validation';

export interface SolidMeasurements {
  min: Vec3;
  max: Vec3;
  dimensions: Vec3;
  volume: number;
  triangles: number;
}

/** Measure the authoritative mesh after its outer transform, never its recipe twice. */
export function measureSolid(solid: Solid, mesh: GeometryMesh): SolidMeasurements {
  validatePosition(solid.position);
  validateScale(solid.scale);
  if (!(mesh.positions instanceof Float32Array) || mesh.positions.length < 9 || mesh.positions.length % 3 !== 0) {
    throw Error('Solid geometry has incomplete vertex coordinates.');
  }
  if (!(mesh.indices instanceof Uint32Array) || mesh.indices.length < 3 || mesh.indices.length % 3 !== 0) {
    throw Error('Solid geometry has incomplete triangles.');
  }
  if (!Number.isFinite(mesh.volume) || mesh.volume <= 0) throw Error('Solid geometry must have a positive finite volume.');
  for (const coordinate of mesh.positions) {
    if (!Number.isFinite(coordinate)) throw Error('Solid geometry contains non-finite vertex coordinates.');
  }
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const vertexCount = mesh.positions.length / 3;
  // Bounds include only vertices referenced by a rendered triangle.
  for (const index of mesh.indices) {
    if (index >= vertexCount) throw Error('Solid geometry contains an out-of-range triangle index.');
    for (let axis = 0; axis < 3; axis++) {
      const coordinate = mesh.positions[index * 3 + axis] * solid.scale + solid.position[axis];
      if (!Number.isFinite(coordinate)) throw Error('The transformed solid has invalid coordinates.');
      min[axis] = Math.min(min[axis], coordinate);
      max[axis] = Math.max(max[axis], coordinate);
    }
  }
  const dimensions: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const volume = mesh.volume * solid.scale ** 3;
  if (!Number.isFinite(volume)) throw Error('The transformed solid has invalid volume.');
  return { min, max, dimensions, volume, triangles: mesh.indices.length / 3 };
}
