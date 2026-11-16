import type { GeometryMesh, Solid } from '../shared/types';
import { measureSolid, type SolidMeasurements } from './solidMeasurements';

export interface SolidSTLExport {
  data: ArrayBuffer;
  filename: string;
  measurements: SolidMeasurements;
}

/** STL stores unitless surface coordinates. Palmivo writes its CAD coordinates in mm. */
export function exportSolidSTL(solid: Solid, mesh: GeometryMesh): SolidSTLExport {
  const measurements = measureSolid(solid, mesh);
  const data = new ArrayBuffer(84 + measurements.triangles * 50);
  const view = new DataView(data);
  new Uint8Array(data, 0, 80).set(new TextEncoder().encode('Palmivo binary STL; coordinates in millimetres (mm)'));
  view.setUint32(80, measurements.triangles, true);
  let offset = 84;
  for (let triangle = 0; triangle < mesh.indices.length; triangle += 3) {
    // Compute normals from the actual float32 coordinates stored in the file.
    const a = vertex(mesh.indices[triangle]);
    const b = vertex(mesh.indices[triangle + 1]);
    const c = vertex(mesh.indices[triangle + 2]);
    const abX = b[0] - a[0], abY = b[1] - a[1], abZ = b[2] - a[2];
    const acX = c[0] - a[0], acY = c[1] - a[1], acZ = c[2] - a[2];
    const x = abY * acZ - abZ * acY, y = abZ * acX - abX * acZ, z = abX * acY - abY * acX;
    const length = Math.hypot(x, y, z);
    if (!Number.isFinite(length) || length === 0) throw Error('Solid geometry contains a degenerate triangle that cannot be exported.');
    write(x / length); write(y / length); write(z / length);
    for (const point of [a, b, c]) for (const coordinate of point) write(coordinate);
    view.setUint16(offset, 0, true); offset += 2;
  }
  const name = solid.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'solid';
  return { data, filename: `${name}_mm.stl`, measurements };

  function vertex(index: number): [number, number, number] {
    const result: [number, number, number] = [0, 0, 0];
    for (let axis = 0; axis < 3; axis++) {
      result[axis] = Math.fround(mesh.positions[index * 3 + axis] * solid.scale + solid.position[axis]);
      if (!Number.isFinite(result[axis])) throw Error('Solid coordinates exceed the STL float32 range.');
    }
    return result;
  }
  function write(value: number): void { view.setFloat32(offset, value, true); offset += 4; }
}
