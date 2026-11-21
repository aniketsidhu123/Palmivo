import { ShapeUtils, Vector2, Vector3 } from 'three';
import { MAX_MESH_FILE_BYTES, MAX_MESH_TRIANGLES, MAX_MESH_VERTICES } from './meshAsset';
import { colorByte, DEFAULT_IMPORT_COLOR, hexToRgb } from './meshColors';
import type { Vec3 } from '../shared/types';

export type MeshUnit = 'mm' | 'cm' | 'in';
export type MeshFormat = 'stl' | 'obj';
const MM_PER_UNIT: Record<MeshUnit, number> = { mm: 1, cm: 10, in: 25.4 };
const MAX_FACE_VERTICES = 256;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/** Read the common polygon/triangle subsets and weld matching float32 positions. */
export function parseMeshBytes(bytes: ArrayBuffer, format: MeshFormat, unit: MeshUnit, materialLibraries: ReadonlyMap<string, string> = new Map()) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_MESH_FILE_BYTES) throw Error('Choose a non-empty mesh file up to 4 MiB.');
  const positions: number[] = [];
  const indices: number[] = [];
  let hasColor = false;
  const colors: number[] = [];
  const defaultColor = hexToRgb(DEFAULT_IMPORT_COLOR);
  const ids = new Map<string, number>();
  const factor = MM_PER_UNIT[unit];
  const vertex = (point: readonly number[]) => {
    const xyz = point.map(coordinate => Math.fround(coordinate * factor));
    if (!xyz.every(Number.isFinite)) throw Error('Mesh coordinates are outside the supported numeric range.');
    const key = xyz.join(',');
    const existing = ids.get(key);
    if (existing !== undefined) return existing;
    const index = positions.length / 3;
    ids.set(key, index);
    positions.push(...xyz);
    return index;
  };
  const face: FaceWriter = (a, b, c, cornerColors) => {
    if (indices.length >= MAX_MESH_TRIANGLES * 3) throw Error(`Mesh exceeds the ${MAX_MESH_TRIANGLES.toLocaleString()} triangle limit.`);
    const triplet = [vertex(a), vertex(b), vertex(c)];
    if (new Set(triplet).size !== 3) throw Error('Mesh contains a collapsed triangle. Remove degenerate faces in the source tool.');
    indices.push(...triplet);
    hasColor ||= Boolean(cornerColors?.some(Boolean));
    for (let corner = 0; corner < 3; corner++) colors.push(...(cornerColors?.[corner] ?? defaultColor));
  };
  if (format === 'stl') parseStl(bytes, face);
  else parseObj(decode(bytes), face, materialLibraries);
  if (indices.length < 12 || positions.length < 12) throw Error('The mesh needs enough triangles to enclose a solid.');
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), ...(hasColor ? { colors: Uint8Array.from(colors) } : {}) };
}

type FaceWriter = (a: readonly number[], b: readonly number[], c: readonly number[], colors?: readonly (Vec3 | undefined)[]) => void;
function decode(bytes: ArrayBuffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw Error('The mesh is neither a supported text file nor a complete binary STL.'); }
}
function number(token: string | undefined): number {
  const value = Number(token);
  if (!token || !NUMBER.test(token) || !Number.isFinite(value)) throw Error('Mesh contains a missing or invalid coordinate.');
  return value;
}
function parseStl(bytes: ArrayBuffer, emit: FaceWriter) {
  const view = new DataView(bytes);
  if (view.byteLength >= 84) {
    const count = view.getUint32(80, true);
    if (84 + count * 50 === view.byteLength) {
      if (count > MAX_MESH_TRIANGLES) throw Error('STL exceeds the supported triangle limit.');
      const point = (offset: number) => [view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)];
      const marker = String.fromCharCode(...new Uint8Array(bytes, 0, 80)).indexOf('COLOR=');
      const globalColor: Vec3 | undefined = marker >= 0 && marker <= 70
        ? [view.getUint8(marker + 6), view.getUint8(marker + 7), view.getUint8(marker + 8)] : undefined;
      for (let offset = 96; offset < view.byteLength; offset += 50) {
        const attr = view.getUint16(offset + 36, true);
        let color = globalColor;
        if (globalColor ? !(attr & 0x8000) : Boolean(attr & 0x8000)) {
          const bits = globalColor ? [0, 5, 10] : [10, 5, 0]; // Magics vs VisCAM.
          color = bits.map(shift => colorByte(((attr >> shift) & 31) * 255 / 31)) as Vec3;
        }
        emit(point(offset), point(offset + 12), point(offset + 24), color ? [color, color, color] : undefined);
      }
      return;
    }
  }
  const text = decode(bytes).trim();
  if (!/^solid(?:\s|$)/i.test(text) || !/^\s*endsolid\b/im.test(text)) throw Error('Invalid STL header or truncated binary STL.');
  const tokens = text.replace(/^\s*(?:solid|endsolid)\b[^\r\n]*/gim, '').trim().split(/\s+/);
  let cursor = 0;
  const keyword = (value: string) => {
    if (tokens[cursor++]?.toLowerCase() !== value) throw Error('Invalid ASCII STL facet structure.');
  };
  const point = () => [number(tokens[cursor++]), number(tokens[cursor++]), number(tokens[cursor++])];
  const vertex = () => { keyword('vertex'); return point(); };
  while (cursor < tokens.length) {
    keyword('facet'); keyword('normal'); point();
    keyword('outer'); keyword('loop');
    emit(vertex(), vertex(), vertex());
    keyword('endloop'); keyword('endfacet');
  }
}

function objIndex(index: string, length: number): number {
  const parsed = Number(index);
  const resolved = parsed > 0 ? parsed - 1 : length + parsed;
  if (!/^-?\d+$/.test(index) || !Number.isSafeInteger(parsed) || parsed === 0 || resolved < 0 || resolved >= length) {
    throw Error('OBJ face refers to an invalid vertex, texture or normal index.');
  }
  return resolved;
}
export function objMaterialNames(text: string): string[] {
  const names = new Set<string>();
  for (const line of text.replace(/\\\r?\n/g, ' ').split(/\r?\n/)) {
    const declaration = /^\s*mtllib\s+(.+?)(?:\s*#.*)?$/.exec(line);
    for (const name of declaration?.[1].match(/[^"]+?\.mtl(?=["\s]|$)/gi) ?? []) names.add(name.trim());
  }
  return [...names];
}

function readObjColors(text: string, libraries: ReadonlyMap<string, string>) {
  const colors = new Map<string, Vec3>();
  if (!libraries.size) return colors;
  for (const library of objMaterialNames(text)) {
    const content = libraries.get(library);
    if (!content) continue;
    let material = '';
    for (const line of content.split(/\r?\n/)) {
      const [type, ...args] = line.split('#', 1)[0].trim().split(/\s+/);
      if (type === 'newmtl') material = args.join(' ');
      if (type === 'Kd' && material && args.length >= 3 && args.slice(0, 3).every(value => NUMBER.test(value))) {
        colors.set(material, args.slice(0, 3).map(value => colorByte(Number(value) * 255)) as Vec3);
      }
    }
  }
  return colors;
}

function parseObj(text: string, emit: FaceWriter, libraries: ReadonlyMap<string, string>) {
  const points: number[][] = [];
  const vertexColors: (Vec3 | undefined)[] = [];
  const materialColors = readObjColors(text, libraries);
  let material: Vec3 | undefined;
  let textureCount = 0;
  let normalCount = 0;
  for (const line of text.replace(/\\\r?\n/g, ' ').split(/\r?\n/)) {
    const [type, ...args] = line.split('#', 1)[0].trim().split(/\s+/);
    if (type === 'v') {
      if (points.length >= MAX_MESH_VERTICES) throw Error('OBJ exceeds the supported vertex limit.');
      const xyz = [number(args[0]), number(args[1]), number(args[2])];
      const weight = args.length === 4 ? number(args[3]) : 1;
      if (weight === 0) throw Error('OBJ vertex has zero homogeneous weight.');
      points.push(xyz.map(value => value / weight));
      const rgb = args.length >= 6 ? args.slice(3, 6).map(number) : undefined;
      const factor = rgb?.some(value => value > 1) ? 1 : 255;
      vertexColors.push(rgb?.map(value => colorByte(value * factor)) as Vec3 | undefined);
    } else if (type === 'vt') {
      textureCount++;
    } else if (type === 'vn') {
      normalCount++;
    } else if (type === 'usemtl') {
      material = materialColors.get(args.join(' '));
    } else if (type === 'f') {
      if (args.length < 3 || args.length > MAX_FACE_VERTICES) throw Error('OBJ faces need 3–256 vertices. Triangulate larger faces before importing.');
      const vertices = args.map(reference => {
        if (!/^-?\d+(?:\/-?\d+|\/\/-?\d+|\/-?\d+\/-?\d+)?$/.test(reference)) throw Error('Malformed OBJ face reference.');
        const [position, texture, normal] = reference.split('/');
        if (texture) objIndex(texture, textureCount);
        if (normal) objIndex(normal, normalCount);
        return objIndex(position, points.length);
      });
      const polygon = vertices.map(index => points[index]);
      for (const triangle of triangulateFace(polygon)) {
        const [a, b, c] = triangle;
        emit(polygon[a], polygon[b], polygon[c], triangle.map(index => vertexColors[vertices[index]] ?? material));
      }
    } else if (['curv', 'curv2', 'surf', 'p', 'l'].includes(type)) {
      throw Error('OBJ contains curves, surfaces or lines. Export a polygon mesh from your source tool.');
    }
  }
}

function triangulateFace(polygon: number[][]): number[][] {
  if (polygon.length === 3) return [[0, 1, 2]];
  const vertices = polygon.map(point => new Vector3(...point));
  const relative = vertices.map(vertex => vertex.clone().sub(vertices[0]));
  const normal = new Vector3();
  for (let i = 0; i < relative.length; i++) normal.add(relative[i].clone().cross(relative[(i + 1) % relative.length]));
  const size = Math.max(...relative.map(vertex => vertex.length()));
  if (!normal.lengthSq()) throw Error('OBJ contains a zero-area or crossing polygon.');
  normal.normalize();
  if (relative.some(vertex => Math.abs(normal.dot(vertex)) > size * 1e-5)) throw Error('OBJ contains a non-planar face. Triangulate it in the source tool.');
  const axes = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)];
  const drop = axes.indexOf(Math.max(...axes));
  const contour = relative.map(vertex => new Vector2(vertex.getComponent((drop + 1) % 3), vertex.getComponent((drop + 2) % 3)));
  const signedArea = ShapeUtils.area(contour);
  const triangles = ShapeUtils.triangulateShape(contour, []);
  let covered = 0;
  for (const triangle of triangles) {
    const [a, b, c] = triangle.map(index => contour[index]);
    const area = ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
    covered += Math.abs(area);
    if (area * signedArea < 0) [triangle[1], triangle[2]] = [triangle[2], triangle[1]];
  }
  if (triangles.length !== polygon.length - 2 || Math.abs(covered - Math.abs(signedArea)) > Math.abs(signedArea) * 1e-5) {
    throw Error('OBJ contains an invalid polygon. Triangulate it in the source tool.');
  }
  return triangles;
}
