import type { MeshAsset } from '../shared/types';

export const MAX_MESH_TRIANGLES = 40_000;
export const MAX_MESH_VERTICES = MAX_MESH_TRIANGLES * 3;
export const MAX_MESH_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_PROJECT_FILE_BYTES = 8 * 1024 * 1024;
const isLittleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

function asLittleEndian(bytes: Uint8Array): Uint8Array {
  if (isLittleEndian) return bytes;
  const swapped = bytes.slice();
  for (let i = 0; i < swapped.length; i += 4) swapped.subarray(i, i + 4).reverse();
  return swapped;
}
function encodeBytes(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 16384) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 16384)));
  return btoa(chunks.join(''));
}
function encode(array: Float32Array | Uint32Array): string {
  return encodeBytes(asLittleEndian(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)));
}
function decodeBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function decode(value: string): ArrayBuffer {
  return asLittleEndian(decodeBytes(value)).buffer as ArrayBuffer;
}
async function contentId(positions: string, indices: string, colors?: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
    colors === undefined ? positions + ':' + indices : positions + ':' + indices + ':' + colors,
  ));
  return 'mesh-' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function makeMeshAsset(positions: Float32Array, indices: Uint32Array, cornerColors?: Uint8Array): Promise<MeshAsset> {
  const xyz = encode(positions);
  const faces = encode(indices);
  const colors = cornerColors && encodeBytes(cornerColors);
  return { id: await contentId(xyz, faces, colors), positions: xyz, indices: faces, ...(colors === undefined ? {} : { colors }) };
}
export async function verifyAssetId(asset: MeshAsset): Promise<void> {
  if (await contentId(asset.positions, asset.indices, asset.colors) !== asset.id) throw Error('Stored mesh contents do not match the asset ID.');
}
export function validateAssetEnvelope(value: unknown): asserts value is MeshAsset {
  if (!value || typeof value !== 'object') throw Error('Invalid mesh asset.');
  const asset = value as Partial<MeshAsset>;
  const hasColors = Object.hasOwn(asset, 'colors');
  if (Object.keys(asset).length !== (hasColors ? 4 : 3) || typeof asset.id !== 'string' || !/^mesh-[0-9a-f]{64}$/.test(asset.id)) throw Error('Invalid mesh asset ID.');
  for (const [data, max] of [[asset.positions, MAX_MESH_VERTICES], [asset.indices, MAX_MESH_TRIANGLES]] as const) {
    // xyz/faces are triples of four-byte values, so their base64 length is a multiple of 16 with no padding.
    if (typeof data !== 'string' || data.length < 64 || data.length > max * 16 || data.length % 16 !== 0 || /[^A-Za-z0-9+/]/.test(data)) {
      throw Error('Invalid or oversized mesh asset buffer.');
    }
  }
  if (hasColors && (typeof asset.colors !== 'string' || asset.colors.length * 4 !== asset.indices!.length * 3 || /[^A-Za-z0-9+/]/.test(asset.colors))) {
    throw Error('Invalid mesh colour buffer.');
  }
}
export function unpackMeshAsset(asset: MeshAsset) {
  validateAssetEnvelope(asset);
  const positions = new Float32Array(decode(asset.positions));
  const indices = new Uint32Array(decode(asset.indices));
  if (!positions.every(Number.isFinite) || !indices.every(index => index < positions.length / 3)) throw Error('Stored mesh has invalid coordinates or triangle indices.');
  return { positions, indices, colors: asset.colors && decodeBytes(asset.colors) || undefined };
}
