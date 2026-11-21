import { env, InferenceSession, Tensor } from 'onnxruntime-web/wasm';
import { readRuntimeAssets, runtimeAssetUrl } from '../shared/runtimeAssets';
import {
  FEATURE_COUNT, FRAME_LENGTH, LOGIT_COUNT, NODE_COUNT, STATE_CHANNELS, STATE_LENGTHS,
  parseManifest, type WorkerRequest, type WorkerReply,
} from './contract';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(reply: WorkerReply, transfer?: Transferable[]): void;
};
const stateShapes = STATE_LENGTHS.map(length => [1, STATE_CHANNELS, NODE_COUNT, length]);
const stateNames = ['state0', 'state1', 'state2'];
const nextNames = ['next0', 'next1', 'next2'];
const outputNames = ['logits', ...nextNames];
let session: InferenceSession | null = null;
let state = initialState();
let busy = false;

function initialState(): Tensor[] {
  return stateShapes.map(shape => new Tensor('float32', new Float32Array(shape.reduce((a, b) => a * b, 1)), shape));
}

function requireFloatTensor(value: Tensor | undefined, shape: readonly number[]): Tensor {
  if (!value || value.type !== 'float32' || value.dims.length !== shape.length ||
      shape.some((size, index) => size !== value.dims[index])) {
    throw new Error('The ONNX model output does not match the expected tensor shape.');
  }
  return value;
}

async function infer(features: Float32Array, reset: boolean): Promise<Float32Array> {
  if (!session) throw new Error('The learned gesture model has not loaded.');
  if (features.length !== FRAME_LENGTH || !features.every(Number.isFinite)) throw new Error('Invalid learned gesture features.');
  if (reset) state = initialState();
  const feeds: Record<string, Tensor> = { frame: new Tensor('float32', features, [1, NODE_COUNT, FEATURE_COUNT]) };
  stateNames.forEach((name, index) => { feeds[name] = state[index]; });
  const outputs = await session.run(feeds, outputNames);
  state = nextNames.map((name, index) => requireFloatTensor(outputs[name], stateShapes[index]));
  const logits = requireFloatTensor(outputs.logits, [1, LOGIT_COUNT]).data as Float32Array;
  return new Float32Array(logits);
}

async function requireLocalAsset(url: URL): Promise<Response> {
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) throw new Error('The local learned gesture model is unavailable.');
  return response;
}

async function load(baseUrl: string) {
  const base = new URL('learned/', baseUrl);
  if (base.origin !== location.origin) throw new Error('The learned gesture model must be served from this application.');
  const response = await requireLocalAsset(new URL('manifest.json', base));
  const manifest = parseManifest(await response.json());
  const model = await (await requireLocalAsset(new URL('gesture.onnx', base))).arrayBuffer();
  if (model.byteLength !== manifest.modelBytes) throw new Error('The local gesture model size does not match its manifest.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', model));
  const hex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  if (hex !== manifest.modelSha256) throw new Error('The local gesture model checksum does not match its manifest.');
  env.wasm.numThreads = 1;
  env.wasm.proxy = false;
  const root = new URL(baseUrl);
  const assets = await readRuntimeAssets(root);
  env.wasm.wasmPaths = {
    mjs: runtimeAssetUrl(root, assets, 'learned/wasm/ort-wasm-simd-threaded.mjs').href,
    wasm: runtimeAssetUrl(root, assets, 'learned/wasm/ort-wasm-simd-threaded.wasm').href,
  };
  session = await InferenceSession.create(model, { executionProviders: ['wasm'] });
  if (session.inputNames.length !== 4 || !['frame', ...stateNames].every(name => session!.inputNames.includes(name)) ||
      session.outputNames.length !== 4 || !outputNames.every(name => session!.outputNames.includes(name))) {
    throw new Error('The ONNX model inputs or outputs do not match the expected contract.');
  }
  await infer(new Float32Array(FRAME_LENGTH), true);
  state = initialState();
  return manifest;
}

scope.onmessage = event => {
  const request = event.data;
  if (busy) {
    scope.postMessage({ id: request.id, type: 'error', message: 'Learned gesture inference is already processing a request.' });
    return;
  }
  busy = true;
  void (async () => {
    try {
      if (request.type === 'load') {
        const manifest = await load(request.baseUrl);
        scope.postMessage({ id: request.id, type: 'ready', manifest });
      } else {
        const started = performance.now();
        const logits = await infer(request.features, request.reset);
        scope.postMessage({ id: request.id, type: 'logits', logits, inferenceMs: performance.now() - started }, [logits.buffer]);
      }
    } catch (error) {
      scope.postMessage({ id: request.id, type: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      busy = false;
    }
  })();
};
