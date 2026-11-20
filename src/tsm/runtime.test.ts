import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TsmRuntime, type TsmReply, type TsmRequest } from './runtime';

class FakeWorker {
  static workers: FakeWorker[] = [];
  messages: TsmRequest[] = [];
  onmessage: ((event: { data: TsmReply }) => void) | null = null;
  terminate = vi.fn();

  constructor() { FakeWorker.workers.push(this); }
  postMessage(message: TsmRequest) { this.messages.push(message); }
  reply(message: TsmReply) { this.onmessage?.({ data: message }); }
}

function bitmap() {
  return { close: vi.fn() } as unknown as ImageBitmap;
}

async function open(runtime: TsmRuntime) {
  const ready = runtime.load();
  const worker = FakeWorker.workers.at(-1)!;
  worker.reply({ type: 'ready', id: worker.messages[0].id });
  await ready;
  return worker;
}

beforeEach(() => {
  FakeWorker.workers.length = 0;
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('location', { href: 'http://localhost:4173/' });
});
afterEach(() => vi.unstubAllGlobals());

describe('TSM inference worker lifecycle', () => {
  it('shares a single in-progress load and discards a late reply after cancellation', async () => {
    const runtime = new TsmRuntime();
    const loading = runtime.load();
    expect(runtime.load()).toBe(loading);
    const first = FakeWorker.workers[0];
    expect(runtime.processing).toBe(true);
    const cancelled = expect(loading).rejects.toThrow('closed');
    runtime.close();
    const reloading = runtime.load();
    first.reply({ type: 'ready', id: first.messages[0].id });
    expect(runtime.processing).toBe(true);
    const second = FakeWorker.workers[1];
    second.reply({ type: 'ready', id: second.messages[0].id });
    await reloading;
    await cancelled;
    expect(runtime.processing).toBe(false);
    expect(first.terminate).toHaveBeenCalledOnce();
    runtime.close();
  });

  it('does not queue a second frame, and takes ownership of rejected bitmaps', async () => {
    const runtime = new TsmRuntime();
    const early = bitmap();
    await expect(runtime.step(early, 10)).rejects.toThrow('unavailable');
    expect(early.close).toHaveBeenCalledOnce();
    const worker = await open(runtime);
    const first = bitmap();
    const prediction = runtime.step(first, 20, true);
    const second = bitmap();
    await expect(runtime.step(second, 30)).rejects.toThrow('unavailable');
    expect(second.close).toHaveBeenCalledOnce();
    expect(worker.messages).toHaveLength(2);
    const request = worker.messages[1];
    expect(request).toMatchObject({ type: 'frame', timestamp: 20, reset: true, bitmap: first });
    worker.reply({ type: 'prediction', id: request.id, logits: new Float32Array(27), timestamp: 20, preprocessMs: 1, inferenceMs: 10 });
    await expect(prediction).resolves.toMatchObject({ timestamp: 20, preprocessMs: 1, inferenceMs: 10 });
    expect(first.close).not.toHaveBeenCalled();
    runtime.close();
  });

  it('invalidates the cached worker after inference fails', async () => {
    const runtime = new TsmRuntime();
    const worker = await open(runtime);
    const prediction = runtime.step(bitmap(), 100);
    worker.reply({ type: 'error', id: worker.messages[1].id, message: 'bad tensor' });
    await expect(prediction).rejects.toThrow('bad tensor');
    expect(worker.terminate).toHaveBeenCalledOnce();
    const restarted = await open(runtime);
    expect(restarted).not.toBe(worker);
    runtime.close();
  });
});
