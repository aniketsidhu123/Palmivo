import { env, InferenceSession, Tensor } from 'onnxruntime-web/wasm';
import type { TsmReply, TsmRequest } from './runtime';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<TsmRequest>) => void) | null;
  postMessage(reply: TsmReply, transfer?: Transferable[]): void;
};
const cropSize = 224;
const scaleSize = 256;
const pixelCount = cropSize * cropSize;
const frameShape = [1, 3, cropSize, cropSize];
const cacheShapes = [[3, 56], [4, 28], [4, 28], [8, 14], [8, 14], [8, 14], [12, 14], [12, 14], [20, 7], [20, 7]]
  .map(([channels, size]) => [1, channels, size, size]);
const inputNames = ['frame', ...cacheShapes.map((_, index) => `cache${index}`)];
const outputNames = ['logits', ...cacheShapes.map((_, index) => `next${index}`)];
const frame = new Float32Array(3 * pixelCount);
let session: InferenceSession | null = null;
let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;
let state = freshState();
let timestamp = -Infinity;
let busy = false;

function freshState(): Tensor[] {
  return cacheShapes.map(shape => new Tensor('float32', new Float32Array(shape.reduce((a, b) => a * b, 1)), shape));
}

function resetState(): void {
  for (const cache of state) cache.dispose();
  state = freshState();
  timestamp = -Infinity;
}

function requireFloatTensor(value: Tensor | undefined, shape: readonly number[]): Tensor {
  if (!value || value.type !== 'float32' || value.dims.length !== shape.length ||
      shape.some((size, index) => size !== value.dims[index])) {
    throw new Error('The TSM graph returned an unexpected tensor shape.');
  }
  return value;
}

function prepareFrame(bitmap: ImageBitmap): void {
  if (!bitmap.width || !bitmap.height) throw new Error('The TSM camera frame is empty.');
  const landscape = bitmap.width >= bitmap.height;
  const width = landscape ? Math.floor(bitmap.width * scaleSize / bitmap.height) : scaleSize;
  const height = landscape ? scaleSize : Math.floor(bitmap.height * scaleSize / bitmap.width);
  // Match the MIT reference scale, crop and OpenCV BGR input. Mirror once so
  // swipe directions in the model input match Palmivo's camera preview.
  canvas ??= new OffscreenCanvas(width, height);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  context ??= canvas.getContext('2d', { willReadFrequently: true, alpha: false });
  if (!context) throw new Error('This browser cannot resize camera frames in the TSM worker.');
  context.imageSmoothingQuality = 'high';
  context.setTransform(-1, 0, 0, 1, width, 0);
  context.drawImage(bitmap, 0, 0, width, height);
  const cropX = Math.round((width - cropSize) / 2);
  const cropY = Math.round((height - cropSize) / 2);
  const data = context.getImageData(cropX, cropY, cropSize, cropSize).data;
  for (let index = 0; index < pixelCount; ++index) {
    const pixel = index * 4;
    frame[index] = (data[pixel + 2] / 255 - .485) / .229;
    frame[pixelCount + index] = (data[pixel + 1] / 255 - .456) / .224;
    frame[2 * pixelCount + index] = (data[pixel] / 255 - .406) / .225;
  }
}

async function infer(): Promise<Float32Array> {
  if (!session) throw new Error('The TSM model has not loaded.');
  const tensor = new Tensor('float32', frame, frameShape);
  const feeds: Record<string, Tensor> = { frame: tensor };
  state.forEach((cache, index) => { feeds[inputNames[index + 1]] = cache; });
  let outputs: InferenceSession.ReturnType | null = null;
  let nextState: Tensor[] | null = null;
  try {
    outputs = await session.run(feeds, outputNames);
    const result = requireFloatTensor(outputs.logits, [1, 27]);
    const logits = new Float32Array(result.data as Float32Array);
    if (!logits.every(Number.isFinite)) throw new Error('The TSM model produced invalid scores.');
    nextState = cacheShapes.map((shape, index) => requireFloatTensor(outputs![outputNames[index + 1]], shape));
    for (const cache of state) cache.dispose();
    state = nextState;
    return logits;
  } finally {
    tensor.dispose();
    if (outputs) for (const value of Object.values(outputs)) {
      if (value instanceof Tensor && !nextState?.includes(value)) value.dispose();
    }
  }
}

async function requireAsset(url: URL): Promise<Response> {
  if (url.origin !== location.origin) throw new Error('The TSM model must be served from this application.');
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) throw new Error('The pretrained TSM model is unavailable.');
  return response;
}

async function load(baseUrl: string): Promise<void> {
  const modelBase = new URL('tsm/', baseUrl);
  const wasmBase = new URL('learned/wasm/', baseUrl);
  const manifestResponse = await requireAsset(new URL('manifest.json', modelBase));
  const manifest = await manifestResponse.json();
  if (manifest?.version !== 1 || manifest?.source !== 'mit-han-lab-online-tsm' ||
      !Number.isSafeInteger(manifest.modelBytes) || manifest.modelBytes <= 0 ||
      typeof manifest.modelSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(manifest.modelSha256)) {
    throw new Error('The local TSM model manifest is invalid.');
  }
  const response = await requireAsset(new URL('mit-tsm-jester-streaming.onnx', modelBase));
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== manifest.modelBytes) throw new Error('The TSM model size does not match its manifest.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  if (hex !== manifest.modelSha256) throw new Error('The TSM model checksum does not match its manifest.');
  env.wasm.numThreads = 1;
  env.wasm.proxy = false;
  env.wasm.wasmPaths = {
    mjs: new URL('ort-wasm-simd-threaded.mjs', wasmBase).href,
    wasm: new URL('ort-wasm-simd-threaded.wasm', wasmBase).href,
  };
  session = await InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  if (session.inputNames.length !== inputNames.length || !inputNames.every(name => session!.inputNames.includes(name)) ||
      session.outputNames.length !== outputNames.length || !outputNames.every(name => session!.outputNames.includes(name))) {
    throw new Error('The TSM model tensors do not match the expected contract.');
  }
  await infer();
  resetState();
}

scope.onmessage = event => {
  const request = event.data;
  if (busy) {
    if (request.type === 'frame') request.bitmap.close();
    scope.postMessage({ id: request.id, type: 'error', message: 'TSM inference is already processing a request.' });
    return;
  }
  busy = true;
  void (async () => {
    try {
      if (request.type === 'load') {
        await load(request.baseUrl);
        scope.postMessage({ id: request.id, type: 'ready' });
        return;
      }
      const started = performance.now();
      try {
        if (!Number.isFinite(request.timestamp)) throw new Error('The TSM camera timestamp is invalid.');
        if (request.reset || (Number.isFinite(timestamp) && request.timestamp - timestamp > 250)) resetState();
        if (request.timestamp <= timestamp) throw new Error('The TSM camera timestamp is out of order.');
        prepareFrame(request.bitmap);
      } finally {
        request.bitmap.close();
      }
      const preprocessMs = performance.now() - started;
      const inferStart = performance.now();
      const logits = await infer();
      timestamp = request.timestamp;
      scope.postMessage({
        id: request.id, type: 'prediction', logits, timestamp, preprocessMs, inferenceMs: performance.now() - inferStart,
      }, [logits.buffer]);
    } catch (error) {
      scope.postMessage({ id: request.id, type: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      busy = false;
    }
  })();
};
