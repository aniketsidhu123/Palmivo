import { cp, mkdir, readdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'release/SignToAST');
await mkdir(path.join(out, 'scripts'), { recursive: true });
await mkdir(path.join(out, 'runtime'), { recursive: true });
await cp(path.join(root, 'dist'), path.join(out, 'dist'), { recursive: true });
await cp(path.join(root, 'scripts/serve.mjs'), path.join(out, 'scripts/serve.mjs'));
await cp(path.join(root, 'start-demo.cmd'), path.join(out, 'start-demo.cmd'));
for (const file of ['README.md', 'THIRD_PARTY_NOTICES.md']) await cp(path.join(root, file), path.join(out, file));
await cp(path.join(root, 'docs'), path.join(out, 'docs'), { recursive: true });
await cp(path.join(root, 'examples'), path.join(out, 'examples'), { recursive: true });
const bin = path.dirname(process.execPath);
for (const file of await readdir(bin)) if (file === 'node.exe' || file.endsWith('.dll')) {
  const from = path.join(bin, file), to = path.join(out, 'runtime', file);
  // An unchanged runtime may already be serving the demo on Windows. Leave its loaded file intact.
  let unchanged = false;
  try { unchanged = (await readFile(from)).equals(await readFile(to)); } catch { /* First package. */ }
  if (!unchanged) await cp(from, to);
}
await writeFile(path.join(out, 'package.json'), '{"private":true,"type":"module"}\n');
console.log(`Portable offline release created at ${out}`);
const source = path.join(root, 'release/SignToAST-Source');
await mkdir(source, { recursive: true });
for (const folder of ['src', 'scripts', 'public', 'docs', 'examples']) await cp(path.join(root, folder), path.join(source, folder), { recursive: true });
for (const file of ['package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts', 'index.html', '.npmrc', '.gitignore', 'README.md', 'THIRD_PARTY_NOTICES.md', 'start-demo.cmd']) await cp(path.join(root, file), path.join(source, file));
console.log(`Source and local model assets copied to ${source}`);
