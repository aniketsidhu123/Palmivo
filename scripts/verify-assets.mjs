import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const dist = new URL('../dist/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('asset-manifest.json', dist), 'utf8'));
for (const item of manifest.files) {
  const bytes = await readFile(new URL(item.path.slice(1), dist));
  if (bytes.length !== item.bytes || createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw Error(`Asset integrity failed: ${item.path}`);
}
const assets = await readdir(new URL('assets/', dist));
if (!assets.some(name => name.startsWith('manifold-') && name.endsWith('.wasm'))) throw Error('Geometry WASM missing');
console.log(`Offline asset verification passed: ${manifest.files.length} tracking assets and geometry WASM.`);
