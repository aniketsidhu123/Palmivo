import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrackingClient, type TrackingStatus } from './client';

class FakeWorker {
  static instances: FakeWorker[] = [];
  static autoReady = true;
  static autoProcessMs: number | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: { type: string; [key: string]: unknown }[] = [];
  terminated = false;
  constructor(readonly url: URL) { FakeWorker.instances.push(this); }
  postMessage(message: { type: string; [key: string]: unknown }): void {
    this.messages.push(message);
    if (message.type === 'init' && FakeWorker.autoReady) queueMicrotask(() => this.send({ type: 'ready', backend: 'GPU worker' }));
    if (message.type === 'frame' && FakeWorker.autoProcessMs !== null) setTimeout(() => this.send({ type: 'frame', frame: { timestamp: message.timestamp, width: 640, height: 480, hands: [], inferenceMs: FakeWorker.autoProcessMs } }), FakeWorker.autoProcessMs);
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
  let track: { stop: ReturnType<typeof vi.fn>; addEventListener: ReturnType<typeof vi.fn>; getSettings: ReturnType<typeof vi.fn>; getCapabilities: ReturnType<typeof vi.fn>; getConstraints: ReturnType<typeof vi.fn>; applyConstraints: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    statuses = []; frames = vi.fn(); stopTrack = vi.fn(); callbacks = [];
    FakeWorker.instances = []; FakeWorker.autoReady = true; FakeWorker.autoProcessMs = null;
    track = { stop: stopTrack, addEventListener: vi.fn(), getSettings: vi.fn(() => ({ width: 640, height: 480, frameRate: 30, facingMode: 'user', deviceId: 'private-camera-id' })), getCapabilities: vi.fn(() => ({ frameRate: { min: 5, max: 60 }, width: { min: 320, max: 1920 }, height: { min: 240, max: 1080 }, deviceId: 'private-camera-id' })), getConstraints: vi.fn(() => ({ frameRate: { ideal: 60, max: 60 } })), applyConstraints: vi.fn().mockResolvedValue(undefined) };
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
    expect(client.stats.droppedFrames).toBe(0); // Newest metadata is retained until the worker is free.
    worker.send({ type: 'frame', frame: { timestamp: 10, width: 640, height: 480, hands: [], inferenceMs: 5 } });
    expect(frames).toHaveBeenCalledOnce();
    tick(callbacks, 30, 3); await settle();
    expect(worker.messages.filter(message => message.type === 'frame')).toHaveLength(2);
    client.stop(); expect(stopTrack).toHaveBeenCalledOnce(); expect(worker.terminated).toBe(true);
  });

  it('prefers a supported minimum 30 FPS camera mode without changing input dimensions or exposing device identifiers', async () => {
    const client = new TrackingClient({ onFrame: frames, onStatus: status => statuses.push(status) });
    await client.start(video);
    expect(track.applyConstraints).toHaveBeenCalledWith({ width: { exact: 640 }, height: { exact: 480 }, frameRate: { min: 30, ideal: 60, max: 60 }, facingMode: 'user' });
    expect(client.cameraInfo).toMatchObject({ settings: { width: 640, height: 480, frameRate: 30 }, capabilities: { frameRate: { min: 5, max: 60 } }, ratePreference: 'applied' });
    expect(JSON.stringify(statuses)).not.toContain('private-camera-id');
    client.stop();
  });

  it('restores the previous constraints and retains tracking when a requested camera rate is rejected', async () => {
    track.applyConstraints.mockRejectedValueOnce(new Error('OverconstrainedError'));
    const client = new TrackingClient({ onFrame: frames, onStatus: status => statuses.push(status) });
    await client.start(video);
    expect(track.applyConstraints).toHaveBeenCalledTimes(2);
    expect(track.applyConstraints).toHaveBeenLastCalledWith({ frameRate: { ideal: 60, max: 60 } });
    expect(client.active).toBe(true);
    expect(client.cameraInfo?.ratePreference).toBe('fallback');
    client.stop();
  });

  it('reports a lower-rate camera capability honestly without requesting an unsupported minimum', async () => {
    track.getCapabilities.mockReturnValue({ frameRate: { min: 5, max: 15 } });
    track.getSettings.mockReturnValue({ width: 640, height: 480, frameRate: 15 });
    const client = new TrackingClient({ onFrame: frames, onStatus: status => statuses.push(status) });
    await client.start(video);
    expect(track.applyConstraints).not.toHaveBeenCalled();
    expect(client.cameraInfo).toMatchObject({ settings: { frameRate: 15 }, ratePreference: 'unsupported' });
    client.stop();
  });

  it('processes only the latest waiting frame immediately after completion, rather than building a bitmap queue', async () => {
    const client = new TrackingClient({ onFrame: frames, onStatus: status => statuses.push(status) });
    await client.start(video);
    tick(callbacks, 10, 1); await settle();
    tick(callbacks, 20, 2); tick(callbacks, 30, 3); await settle();
    const worker = FakeWorker.instances[0];
    expect(worker.messages.filter(message => message.type === 'frame')).toHaveLength(1);
    expect(client.stats.droppedFrames).toBe(1);
    worker.send({ type: 'frame', frame: { timestamp: 10, width: 640, height: 480, hands: [], inferenceMs: 35 } });
    await settle();
    expect(worker.messages.filter(message => message.type === 'frame').map(message => message.timestamp)).toEqual([10, 30]);
    expect(vi.mocked(createImageBitmap)).toHaveBeenCalledTimes(2);
    client.stop();
  });

  it('avoids halving a 30 Hz camera when processing takes slightly longer than one camera interval', async () => {
    FakeWorker.autoProcessMs = 35;
    const client = new TrackingClient({ onFrame: frames, onStatus: status => statuses.push(status) });
    await client.start(video);
    for (let sample = 1; sample <= 30; sample++) {
      await vi.advanceTimersByTimeAsync(1000 / 30);
      tick(callbacks, performance.now(), sample / 30); await settle();
    }
    expect(frames.mock.calls.length).toBeGreaterThanOrEqual(26);
    expect(frames.mock.calls.length).toBeLessThan(30);
    expect(client.stats.droppedFrames).toBeLessThanOrEqual(3);
    client.stop();
  });

  it('reports camera-copy, worker round-trip and sample age separately', async () => {
    const timings = vi.fn();
    const client = new TrackingClient({ onFrame: frames, onStatus: status => statuses.push(status), onTiming: timings });
    await client.start(video);
    await vi.advanceTimersByTimeAsync(10);
    tick(callbacks, performance.now(), 1); await settle();
    await vi.advanceTimersByTimeAsync(15);
    FakeWorker.instances[0].send({ type: 'frame', frame: { timestamp: 10, width: 640, height: 480, hands: [], inferenceMs: 12 } });
    expect(timings).toHaveBeenCalledWith({ captureMs: 0, roundTripMs: 15, sampleAgeMs: 15 });
    client.stop();
  });

  it('does not revive a camera or overwrite cleared telemetry after stop during rate negotiation', async () => {
    let finishConstraints!: () => void;
    track.applyConstraints.mockImplementationOnce(() => new Promise<void>(resolve => { finishConstraints = resolve; }));
    const client = new TrackingClient({ onFrame: frames, onStatus: status => statuses.push(status) });
    const starting = client.start(video); await settle();
    client.stop(); finishConstraints(); await starting;
    expect(client.active).toBe(false); expect(client.cameraInfo).toBeNull();
    expect(callbacks).toHaveLength(0); expect(FakeWorker.instances).toHaveLength(0);
  });

  it('does not pump a waiting sample if the onFrame consumer stops tracking', async () => {
    const client = new TrackingClient({ onFrame: () => client.stop(), onStatus: status => statuses.push(status) });
    await client.start(video);
    tick(callbacks, 10, 1); await settle(); tick(callbacks, 20, 2);
    const worker = FakeWorker.instances[0];
    worker.send({ type: 'frame', frame: { timestamp: 10, width: 640, height: 480, hands: [], inferenceMs: 5 } });
    await settle();
    expect(worker.messages.filter(message => message.type === 'frame')).toHaveLength(1);
    expect(client.active).toBe(false);
  });

  it('times out a stalled bitmap conversion and closes its eventual result', async () => {
    let finishBitmap!: (value: ImageBitmap) => void;
    vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise<ImageBitmap>(resolve => { finishBitmap = resolve; })));
    const client = new TrackingClient({ onFrame: frames, onStatus: status => statuses.push(status) });
    await client.start(video); tick(callbacks, 10, 1); await settle();
    vi.advanceTimersByTime(5001);
    expect(client.active).toBe(false);
    finishBitmap(bitmap); await settle();
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(FakeWorker.instances[0].messages.filter(message => message.type === 'frame')).toHaveLength(0);
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
