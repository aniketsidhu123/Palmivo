import { cp, mkdir, readdir, writeFile, readFile, unlink, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const excludedFolders = ['.git', '.agents', '.codex', 'node_modules', '.pnpm-store', '__pycache__', '.pytest_cache'];
const treeOptions = { recursive: true, filter: source => !/\.(log|pyc|pyo|tmp|temp)$/i.test(source) && !path.relative(root, source).split(path.sep).some(part => excludedFolders.includes(part.toLowerCase())) };
const out = path.join(root, 'release/SignToAST');
const source = path.join(root, 'release/SignToAST-Source');
const productionRoot = path.resolve(out, 'dist');
const managedRoots = [productionRoot, path.resolve(out, 'docs'), path.resolve(source, 'docs'), path.resolve(source, 'qa')];
function checkManagedPath(target) {
  const resolved = path.resolve(target);
  if (!managedRoots.some(managed => resolved === managed || resolved.startsWith(managed + path.sep))) throw new Error('Package cleanup must remain inside its managed release directories.');
  return resolved;
}
async function removeStaleOutput(target, entry) {
  checkManagedPath(target);
  if (['.git', '.agents', '.codex'].includes(entry.name.toLowerCase())) return;
  if (entry.isDirectory()) {
    for (const child of await readdir(target, { withFileTypes: true })) await removeStaleOutput(path.join(target, child.name), child);
    if ((await readdir(target)).length === 0) await rmdir(target);
  } else await unlink(target);
}
async function prunePackagedTree(source, target) {
  checkManagedPath(target);
  const expected = new Map((await readdir(source, { withFileTypes: true })).filter(entry => treeOptions.filter(path.join(source, entry.name))).map(entry => [entry.name, entry]));
  for (const entry of await readdir(target, { withFileTypes: true })) {
    const sourceEntry = expected.get(entry.name);
    if (!sourceEntry) await removeStaleOutput(path.join(target, entry.name), entry);
    else if (entry.isDirectory() && sourceEntry.isDirectory()) await prunePackagedTree(path.join(source, entry.name), path.join(target, entry.name));
  }
}
await mkdir(path.join(out, 'scripts'), { recursive: true });
await mkdir(path.join(out, 'runtime'), { recursive: true });
await cp(path.join(root, 'dist'), path.join(out, 'dist'), treeOptions);
// Remove obsolete application chunks and temporary QA pages after the new build is present.
await prunePackagedTree(path.join(root, 'dist'), productionRoot);
await cp(path.join(root, 'scripts/serve.mjs'), path.join(out, 'scripts/serve.mjs'));
await cp(path.join(root, 'start-demo.cmd'), path.join(out, 'start-demo.cmd'));
for (const file of ['README.md', 'THIRD_PARTY_NOTICES.md']) await cp(path.join(root, file), path.join(out, file));
await cp(path.join(root, 'docs'), path.join(out, 'docs'), treeOptions);
await prunePackagedTree(path.join(root, 'docs'), path.join(out, 'docs'));
await cp(path.join(root, 'examples'), path.join(out, 'examples'), treeOptions);
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
await mkdir(source, { recursive: true });
for (const folder of ['src', 'scripts', 'public', 'docs', 'examples', 'qa']) await cp(path.join(root, folder), path.join(source, folder), treeOptions);
for (const folder of ['docs', 'qa']) await prunePackagedTree(path.join(root, folder), path.join(source, folder));
for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts', 'index.html', '.npmrc', '.gitignore', 'README.md', 'THIRD_PARTY_NOTICES.md', 'start-demo.cmd']) await cp(path.join(root, file), path.join(source, file));
// Include the current editable deck when present, without older presentation drafts.
const currentPresentation = path.join(root, 'submission/presentation');
try {
  await readdir(currentPresentation);
  for (const bundle of [out, source]) await cp(currentPresentation, path.join(bundle, 'submission/presentation'), treeOptions);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
console.log(`Source and local model assets copied to ${source}`);
