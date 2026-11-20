import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyTsmAssets } from './tsm-assets.mjs';
const dist = new URL('../dist/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('asset-manifest.json', dist), 'utf8'));
for (const item of manifest.files) {
  const bytes = await readFile(new URL(item.path.slice(1), dist));
  if (bytes.length !== item.bytes || createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw Error(`Asset integrity failed: ${item.path}`);
}
const assets = await readdir(new URL('assets/', dist));
if (!assets.some(name => name.startsWith('manifold-') && name.endsWith('.wasm'))) throw Error('Geometry WASM missing');
try {
  const model = JSON.parse(await readFile(new URL('learned/manifest.json', dist), 'utf8'));
  const bytes = await readFile(new URL('learned/gesture.onnx', dist));
  if (model.source !== 'presenter' || model.modelBytes !== bytes.length ||
      model.modelSha256 !== createHash('sha256').update(bytes).digest('hex')) throw Error('Learned model integrity check failed.');
} catch (error) {
  if (error.code !== 'ENOENT' || !String(error.path).endsWith('manifest.json')) throw error;
  console.log('No custom presenter model bundled.');
}
const hasTsm = await verifyTsmAssets(fileURLToPath(dist));
console.log(hasTsm ? 'Verified pinned MIT TSM model.' : 'No MIT TSM model bundled. Gesture rules remain available.');
console.log(`Offline asset verification passed: ${manifest.files.length} local runtime assets and geometry WASM.`);
