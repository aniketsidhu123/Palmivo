import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrackingClient, type TrackingStatus } from './client';

class FakeWorker {
  static instances: FakeWorker[] = [];
  static autoReady = true;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: { type: string; [key: string]: unknown }[] = [];
  terminated = false;
  constructor(readonly url: URL) { FakeWorker.instances.push(this); }
  postMessage(message: { type: string; [key: string]: unknown }): void {
    this.messages.push(message);
    if (message.type === 'init' && FakeWorker.autoReady) queueMicrotask(() => this.send({ type: 'ready', backend: 'GPU worker' }));
  }
  terminate(): void { this.terminated = true; }
  send(data: unknown): void { this.onmessage?.({ data } as MessageEvent); }
}

describe('tracking client lifecycle', () => {
  let statuses: TrackingStatus[];
  let frames: ReturnType<typeof vi.fn>;
  let stopTrack: ReturnType<typeof vi.fn>;
  let getUserMedia: ReturnType<typeof vi.fn>;
  let callbacks: VideoFrameRequestCallback[];
  let video: HTMLVideoElement;
  let bitmap: ImageBitmap;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    statuses = []; frames = vi.fn(); stopTrack = vi.fn(); callbacks = [];
    FakeWorker.instances = []; FakeWorker.autoReady = true;
    const track = { stop: stopTrack, addEventListener: vi.fn() };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
    getUserMedia = vi.fn().mockResolvedValue(stream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal('location', { origin: 'http://localhost:4173' });
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    bitmap = { width: 640, height: 480, close: vi.fn() } as unknown as ImageBitmap;
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    video = {
      srcObject: null, muted: false, playsInline: false, currentTime: 0,
      play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(),
      requestVideoFrameCallback: vi.fn((callback: VideoFrameRequestCallback) => { callbacks.push(callback); return callbacks.length; }),
      cancelVideoFrameCallback: vi.fn(),
    } as unknown as HTMLVideoElement;
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
  const tick = (callbacks: VideoFrameRequestCallback[], now: number, mediaTime: number) => callbacks.shift()!(now, { mediaTime } as VideoFrameCallbackMetadata);

  it('surfaces denied camera permission and leaves editing recovery available', async () => {
    getUserMedia.mockRejectedValue(new Error('Permission denied'));
    const client = new TrackingClient({ onFrame: frames, onStatus: status => statuses.push(status) });
    await expect(client.start(video)).rejects.toThrow('Permission denied');
    expect(client.active).toBe(false);
    expect(statuses.at(-1)?.state).toBe('error');
    expect(statuses.at(-1)?.message).toMatch(/mouse and keyboard/i);
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('keeps one camera frame in flight and drops stale submissions instead of queuing them', async () => {
    const client = new TrackingClient({ onFrame: frames, onStatus: status => statuses.push(status) });
    await client.start(video);
    expect(client.backend).toBe('GPU worker');
    expect(FakeWorker.instances[0].url.pathname).toBe('/tracking/worker.js');
    tick(callbacks, 10, 1); await settle();
    tick(callbacks, 20, 2); await settle();
    const worker = FakeWorker.instances[0];
    expect(worker.messages.filter(message => message.type === 'frame')).toHaveLength(1);
    expect(client.stats.droppedFrames).toBe(1);
    worker.send({ type: 'frame', frame: { timestamp: 10, width: 640, height: 480, hands: [], inferenceMs: 5 } });
    expect(frames).toHaveBeenCalledOnce();
    tick(callbacks, 30, 3); await settle();
    expect(worker.messages.filter(message => message.type === 'frame')).toHaveLength(2);
    client.stop(); expect(stopTrack).toHaveBeenCalledOnce(); expect(worker.terminated).toBe(true);
  });

  it('closes a bitmap that arrives after the camera was stopped', async () => {
    let resolveBitmap!: (value: ImageBitmap) => void;
    vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise<ImageBitmap>(resolve => { resolveBitmap = resolve; })));
    const client = new TrackingClient({ onFrame: frames, onStatus: status => statuses.push(status) });
    await client.start(video);
    const worker = FakeWorker.instances[0];
    tick(callbacks, 10, 1); client.stop();
    resolveBitmap(bitmap); await settle();
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(worker.messages.filter(message => message.type === 'frame')).toHaveLength(0);
  });

  it('invalidates an initialization result after stop without restarting capture', async () => {
    FakeWorker.autoReady = false;
    const client = new TrackingClient({ onFrame: frames, onStatus: status => statuses.push(status) });
    const starting = client.start(video); await settle();
    const worker = FakeWorker.instances[0];
    expect(worker).toBeDefined();
    client.stop(); worker.send({ type: 'ready', backend: 'GPU worker' });
    await starting;
    expect(client.active).toBe(false); expect(callbacks).toHaveLength(0);
    expect(stopTrack).toHaveBeenCalledOnce();
  });

  it('stops a stalled worker and releases the camera rather than leaving a growing queue', async () => {
    const client = new TrackingClient({ onFrame: frames, onStatus: status => statuses.push(status) });
    await client.start(video); tick(callbacks, 10, 1); await settle();
    vi.advanceTimersByTime(5001);
    expect(client.active).toBe(false); expect(stopTrack).toHaveBeenCalledOnce();
    expect(statuses.at(-1)?.state).toBe('error');
    expect(statuses.at(-1)?.message).toMatch(/stopped responding/);
  });
});
