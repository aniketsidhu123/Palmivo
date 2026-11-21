import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { makeMeshAsset } from '../core/meshAsset';
import { parseMeshBytes, type MeshFormat, type MeshUnit } from '../core/meshParsing';
import { measureSolid } from '../core/solidMeasurements';
import { buildMesh, initializeKernel } from './kernel';

self.onmessage = async ({ data }: MessageEvent<{ bytes: ArrayBuffer; format: MeshFormat; unit: MeshUnit; materials?: ReadonlyMap<string, string> }>) => {
  try {
    const { positions, indices, colors } = parseMeshBytes(data.bytes, data.format, data.unit, data.materials);
    const asset = await makeMeshAsset(positions, indices, colors);
    const recipe = { kind: 'mesh' as const, assetId: asset.id };
    const mesh = buildMesh(await initializeKernel(wasmUrl), recipe, [asset]);
    const { dimensions } = measureSolid({ id: '', name: '', color: '', recipe, position: [0, 0, 0], scale: 1 }, mesh);
    self.postMessage({ asset, mesh, dimensions }, { transfer: [mesh.positions.buffer, mesh.indices.buffer, ...(mesh.colors ? [mesh.colors.buffer] : [])] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Could not read mesh geometry.' });
  }
};
