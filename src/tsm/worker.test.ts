import { afterEach, expect, it, vi } from 'vitest';
import type { TsmRequest } from './runtime';

const ort = vi.hoisted(() => {
  class FakeTensor {
    constructor(readonly type: string, readonly data: Float32Array, readonly dims: number[]) {}
    dispose() {}
  }
  const caches = Array.from({ length: 10 }, (_, index) => `cache${index}`);
  const next = caches.map((_, index) => `next${index}`);
  const run = vi.fn(async (feeds: Record<string, FakeTensor>) => ({
    logits: new FakeTensor('float32', new Float32Array(27), [1, 27]),
    ...Object.fromEntries(next.map((name, index) => [name, new FakeTensor('float32', feeds[caches[index]].data.slice(), feeds[caches[index]].dims)])),
  }));
  return { FakeTensor, run, session: { run, inputNames: ['frame', ...caches], outputNames: ['logits', ...next] } };
});

vi.mock('onnxruntime-web/wasm', () => ({
  Tensor: ort.FakeTensor,
  InferenceSession: { create: async () => ort.session },
  env: { wasm: {} },
}));

afterEach(() => vi.unstubAllGlobals());

it('uses the mirrored preview orientation, MIT crop dimensions, and BGR normalization', async () => {
  const scope = { postMessage: vi.fn(), onmessage: null as ((event: { data: TsmRequest }) => void) | null };
  vi.stubGlobal('self', scope);
  vi.stubGlobal('location', { origin: 'http://localhost:4173' });
  vi.stubGlobal('crypto', { subtle: { digest: async () => new ArrayBuffer(32) } });
  vi.stubGlobal('fetch', async (url: URL) => url.pathname.endsWith('/manifest.json')
    ? new Response(JSON.stringify({ version: 1, source: 'mit-han-lab-online-tsm', modelBytes: 1, modelSha256: '0'.repeat(64) }))
    : new Response(new Uint8Array(1)));

  const samples = new Uint8ClampedArray(224 * 224 * 4);
  samples.set([102, 153, 204, 255]);
  const context = { setTransform: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn(() => ({ data: samples })) };
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) {}
    getContext() { return context; }
  });
  await import('./worker');
  scope.onmessage!({ data: { type: 'load', id: 1, baseUrl: 'http://localhost:4173/' } });
  await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledWith({ id: 1, type: 'ready' }));

  const bitmap = { width: 640, height: 480, close: vi.fn() } as unknown as ImageBitmap;
  scope.onmessage!({ data: { type: 'frame', id: 2, bitmap, timestamp: 50, reset: false } });
  await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, type: 'prediction', timestamp: 50 }), expect.any(Array)));
  expect(context.setTransform).toHaveBeenCalledExactlyOnceWith(-1, 0, 0, 1, 341, 0);
  expect(context.drawImage).toHaveBeenCalledExactlyOnceWith(bitmap, 0, 0, 341, 256);
  expect(context.getImageData).toHaveBeenCalledExactlyOnceWith(59, 16, 224, 224);
  expect(bitmap.close).toHaveBeenCalledOnce();
  const frame = ort.run.mock.calls.at(-1)![0].frame.data;
  expect(frame[0]).toBeCloseTo((.8 - .485) / .229);
  expect(frame[224 * 224]).toBeCloseTo((.6 - .456) / .224);
  expect(frame[2 * 224 * 224]).toBeCloseTo((.4 - .406) / .225);
});
