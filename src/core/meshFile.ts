import type { GeometryMesh, ImportedMesh, Solid } from '../shared/types';
import { MAX_MESH_FILE_BYTES } from './meshAsset';
import { objMaterialNames, type MeshUnit } from './meshParsing';
import { measureSolid } from './solidMeasurements';
import { exportMeshFilename, meshWorldVertex } from './stlExport';
import { hexToRgb } from './meshColors';

export { MAX_MESH_FILE_BYTES };

export async function readSiblingMaterials(file: File, folder: FileSystemDirectoryHandle): Promise<File[]> {
  if (!/\.obj$/i.test(file.name) || file.size > MAX_MESH_FILE_BYTES) return [];
  const names = new Set(objMaterialNames(await file.text()).map(name => name.split(/[\\/]/).at(-1)!));
  const files: File[] = [];
  for (const name of names) {
    try {
      const handle = await folder.getFileHandle(name);
      files.push(await handle.getFile());
    } catch { /* A missing sidecar leaves the geometry usable. */ }
  }
  return files;
}

export async function readMeshFile(file: File, unit: MeshUnit = 'mm', materialFiles: readonly File[] = []): Promise<ImportedMesh> {
  if (file.size === 0 || file.size > MAX_MESH_FILE_BYTES) throw Error('Choose a non-empty mesh file up to 4 MiB.');
  const format = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  if (format !== 'stl' && format !== 'obj') throw Error('Choose an STL or OBJ mesh.');
  const bytes = await file.arrayBuffer();
  const materials = new Map<string, string>();
  if (format === 'obj' && materialFiles.length) {
    const supplied = new Map(materialFiles.map(material => [material.name.toLowerCase(), material]));
    let remaining = 1024 * 1024;
    for (const name of objMaterialNames(new TextDecoder().decode(bytes))) {
      const material = supplied.get(name.split(/[\\/]/).at(-1)!.toLowerCase());
      if (!material || material.size > remaining) continue;
      remaining -= material.size;
      materials.set(name, await material.text());
    }
  }
  const worker = new Worker(new URL('../geometry/meshImport.worker.ts', import.meta.url), { type: 'module', name: 'mesh-import' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<ImportedMesh>((resolve, reject) => {
      timer = setTimeout(() => reject(Error('Mesh verification timed out. Try a simpler mesh.')), 6000);
      worker.onmessage = ({ data }: MessageEvent<ImportedMesh | { error: string }>) =>
        'error' in data ? reject(Error(data.error)) : resolve(data);
      worker.onerror = event => { event.preventDefault(); reject(Error('Mesh verification could not start.')); };
      worker.postMessage({ bytes, format, unit, materials }, [bytes]);
    });
  } finally {
    clearTimeout(timer);
    worker.terminate();
  }
}

export function exportSolidOBJ(solid: Solid, mesh: GeometryMesh) {
  const measurements = measureSolid(solid, mesh);
  const filename = exportMeshFilename(solid, 'obj');
  const lines = ['# Palmivo mesh · coordinates in millimetres (mm)', `o ${filename.slice(0, -4)}`];
  const bodyColor = hexToRgb(solid.color);
  for (let index = 0; index < mesh.positions.length / 3; index++) {
    const rgb = mesh.colors?.subarray(index * 3, index * 3 + 3) ?? bodyColor;
    lines.push(`v ${meshWorldVertex(solid, mesh, index).join(' ')} ${Array.from(rgb, value => (value / 255).toFixed(4)).join(' ')}`);
  }
  for (let face = 0; face < mesh.indices.length; face += 3) {
    lines.push(`f ${mesh.indices[face] + 1} ${mesh.indices[face + 1] + 1} ${mesh.indices[face + 2] + 1}`);
  }
  return { data: lines.join('\n') + '\n', filename, measurements };
}
