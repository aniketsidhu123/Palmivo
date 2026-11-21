import type { GeometryMesh, Solid } from '../shared/types';
import { measureSolid, type SolidMeasurements } from './solidMeasurements';
import { colorByte, hexToRgb } from './meshColors';

export interface SolidSTLExport {
  data: ArrayBuffer;
  filename: string;
  measurements: SolidMeasurements;
}

/** Write millimetre geometry and optional Magics colour attributes for each facet. */
export function exportSolidSTL(solid: Solid, mesh: GeometryMesh, includeColor = true): SolidSTLExport {
  const measurements = measureSolid(solid, mesh);
  const data = new ArrayBuffer(84 + measurements.triangles * 50);
  const view = new DataView(data);
  const header = new TextEncoder().encode('Palmivo binary STL; coordinates in millimetres (mm)');
  const bodyColor = hexToRgb(solid.color);
  const colors = mesh.colors;
  const headerBytes = new Uint8Array(data, 0, 80);
  headerBytes.set(header);
  if (includeColor) {
    const marker = new TextEncoder().encode(' COLOR=');
    headerBytes.set(marker, header.length);
    headerBytes.set([...bodyColor, 255], header.length + marker.length);
  }
  view.setUint32(80, measurements.triangles, true);
  let offset = 84;
  for (let triangle = 0; triangle < mesh.indices.length; triangle += 3) {
    // Compute normals from the actual float32 coordinates stored in the file.
    const a = meshWorldVertex(solid, mesh, mesh.indices[triangle]);
    const b = meshWorldVertex(solid, mesh, mesh.indices[triangle + 1]);
    const c = meshWorldVertex(solid, mesh, mesh.indices[triangle + 2]);
    const abX = b[0] - a[0], abY = b[1] - a[1], abZ = b[2] - a[2];
    const acX = c[0] - a[0], acY = c[1] - a[1], acZ = c[2] - a[2];
    const x = abY * acZ - abZ * acY, y = abZ * acX - abX * acZ, z = abX * acY - abY * acX;
    const length = Math.hypot(x, y, z);
    if (!Number.isFinite(length) || length === 0) throw Error('Solid geometry contains a degenerate triangle that cannot be exported.');
    write(x / length); write(y / length); write(z / length);
    for (const point of [a, b, c]) for (const coordinate of point) write(coordinate);
    let attribute = 0;
    if (includeColor) {
      const rgb = colors ? bodyColor.map((_, channel) => colorByte(
        (colors[mesh.indices[triangle] * 3 + channel] + colors[mesh.indices[triangle + 1] * 3 + channel] +
          colors[mesh.indices[triangle + 2] * 3 + channel]) / 3,
      )) : bodyColor;
      attribute = rgb.every((value, channel) => value === bodyColor[channel])
        ? 0x8000 : rgb.reduce((bits, value, channel) => bits | (Math.round(value * 31 / 255) << (5 * channel)), 0);
    }
    view.setUint16(offset, attribute, true); offset += 2;
  }
  return { data, filename: exportMeshFilename(solid, 'stl'), measurements };
  function write(value: number): void { view.setFloat32(offset, value, true); offset += 4; }
}

export function exportMeshFilename(solid: Solid, format: 'stl' | 'obj') {
  const name = solid.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'solid';
  return `${name}_mm.${format}`;
}

export function meshWorldVertex(solid: Solid, mesh: GeometryMesh, index: number): [number, number, number] {
  const result: [number, number, number] = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    result[axis] = Math.fround(mesh.positions[index * 3 + axis] * solid.scale + solid.position[axis]);
    if (!Number.isFinite(result[axis])) throw Error('Solid coordinates exceed the supported float32 range.');
  }
  return result;
}
