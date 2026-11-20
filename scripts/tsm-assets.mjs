import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const modelName = 'mit-tsm-jester-streaming.onnx';
const modelPath = `tsm/${modelName}`;
const manifestPath = 'tsm/manifest.json';

// Fixed export of the official MIT HAN Lab Jester checkpoint, using ONNX opset 17.
const pinned = {
  version: 1,
  source: 'mit-han-lab-online-tsm',
  modelBytes: 9012233,
  modelSha256: 'e4142cece680362eec7b5ce2571bc7b763b841830942b30c51cb9b21ccfd1ebb',
  parameterCount: 2258459,
  checkpointSha256: 'da56d12597699a34c51834d059669679049cd9d530876279259a1eed8bb34688',
};

async function readIfPresent(file) {
  try { return await readFile(file); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

function verifyModel(bytes) {
  if (bytes.length !== pinned.modelBytes || createHash('sha256').update(bytes).digest('hex') !== pinned.modelSha256) {
    throw Error('MIT TSM ONNX does not match the pinned export. Restore it from the Palmivo Hybrid source archive.');
  }
}

/** Use the previously exported local model or the verified copy in a source archive. */
export async function stageTsmAssets(root) {
  const publicDir = path.join(root, 'public');
  const staged = path.join(publicDir, modelPath);
  const exportPath = path.join(root, 'ml', 'artifacts', 'pretrained-evaluation', modelName);
  const alreadyStaged = await readIfPresent(staged);
  const bytes = alreadyStaged ?? await readIfPresent(exportPath);
  if (!bytes) {
    if (await readIfPresent(path.join(publicDir, manifestPath))) throw Error('MIT TSM manifest is present but its ONNX file is missing.');
    return [];
  }
  verifyModel(bytes);
  await mkdir(path.dirname(staged), { recursive: true });
  if (!alreadyStaged) await writeFile(staged, bytes);
  await writeFile(path.join(publicDir, manifestPath), JSON.stringify(pinned, null, 2) + '\n');
  return [modelPath, manifestPath];
}

/** Require both files together, and validate against the pinned export, not only each other. */
export async function verifyTsmAssets(assetDir, required = false) {
  const manifestBytes = await readIfPresent(path.join(assetDir, manifestPath));
  const bytes = await readIfPresent(path.join(assetDir, modelPath));
  if (!manifestBytes && !bytes && !required) return false;
  if (!manifestBytes || !bytes) throw Error('MIT TSM model and manifest are required for the Palmivo Hybrid package. Run the asset build with the pinned local export.');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (!manifest || Object.entries(pinned).some(([key, value]) => manifest[key] !== value)) {
    throw Error('MIT TSM asset manifest does not match the pinned export.');
  }
  verifyModel(bytes);
  return true;
}
