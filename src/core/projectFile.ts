import type { SceneDocument } from '../shared/types';
import { validateDocument } from './validation';
import { MAX_PROJECT_FILE_BYTES } from './meshAsset';

export { MAX_PROJECT_FILE_BYTES };

/** Match downloadJSON's pretty output without serializing large asset strings on each edit. */
export function checkExportableSize(document: SceneDocument): void {
  if (!document.assets?.length) return;
  const manifest = { ...document, assets: document.assets.map(asset => ({ id: asset.id, positions: '', indices: '', ...(asset.colors ? { colors: '' } : {}) })) };
  const metadataBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2)).byteLength;
  const assetBytes = document.assets.reduce((sum, asset) => sum + asset.positions.length + asset.indices.length + (asset.colors?.length ?? 0), 0);
  if (metadataBytes + assetBytes > MAX_PROJECT_FILE_BYTES) throw Error('This change would exceed the 8 MiB project limit. Use a smaller mesh or a new project.');
}

/** Parse only the local, versioned project format. The command log is data, never executed. */
export function parseProjectFile(text: string): SceneDocument {
  if (new TextEncoder().encode(text).byteLength > MAX_PROJECT_FILE_BYTES) {
    throw new Error('Project is larger than the 8 MiB limit. Choose a smaller Palmivo project.');
  }
  let document: unknown;
  try { document = JSON.parse(text); }
  catch { throw new Error('Could not read project JSON. Choose an exported Palmivo .json file.'); }
  validateDocument(document);
  return document;
}
