import { mkdir, cp, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.join(root, 'public/tracking');
await mkdir(target, { recursive: true });
await build({ entryPoints: [path.join(root, 'src/tracking/worker.ts')], outfile: path.join(target, 'worker.js'), bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true });
await cp(path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm'), path.join(target, 'wasm'), { recursive: true });
const model = path.join(target, 'hand_landmarker.task');
try { const b = await readFile(model); if (b.length < 1000000) throw Error('Incomplete model'); }
catch {
  const url = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
  const response = await fetch(url);
  if (!response.ok) throw Error(`Model download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1000000) throw Error('Downloaded model is incomplete');
  await writeFile(model, bytes);
}
const files = ['worker.js', 'hand_landmarker.task', 'wasm/vision_wasm_internal.js', 'wasm/vision_wasm_internal.wasm', 'wasm/vision_wasm_nosimd_internal.js', 'wasm/vision_wasm_nosimd_internal.wasm'];
const manifest = [];
for (const file of files) {
  const bytes = await readFile(path.join(target, file));
  manifest.push({ path: `/tracking/${file}`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(path.join(root, 'public/asset-manifest.json'), JSON.stringify({ version: 1, files: manifest }, null, 2));
console.log('Prepared verified local hand model and WASM assets.');
