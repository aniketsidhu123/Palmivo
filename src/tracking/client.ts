import type { TrackingFrame } from '../shared/types';

export interface TrackingStatus {
  state: 'loading' | 'running' | 'stopped' | 'error';
  message: string;
  backend: 'GPU worker' | 'CPU worker' | 'uninitialized';
  cameraFps: number;
  trackingFps: number;
  droppedFrames: number;
}
export interface TrackingOptions { onFrame(frame: TrackingFrame): void; onStatus(status: TrackingStatus): void }

/** Keeps a single bitmap in flight. start/stop invalidates every older asynchronous operation. */
export class TrackingClient {
  backend: TrackingStatus['backend'] = 'uninitialized';
  active = false;
  stats = { cameraFps: 0, trackingFps: 0, droppedFrames: 0 };
  private worker: Worker | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private callbackId: number | null = null;
  private animationId: number | null = null;
  private pending = false;
  private generation = 0;
  private frameId = 0;
  private cameraCount = 0;
  private processedCount = 0;
  private reportTime = 0;
  private lastMediaTime = -1;
  private lastTimestamp = -1;
  private frameTimeout: ReturnType<typeof setTimeout> | null = null;
  private rejectInitialization: ((error: Error) => void) | null = null;
  private options: TrackingOptions;

  constructor(options: TrackingOptions) { this.options = options; }

  async start(video: HTMLVideoElement): Promise<void> {
    this.stop();
    const generation = ++this.generation;
    this.video = video;
    this.report('loading', 'Requesting camera permission…');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires localhost or HTTPS and a supported browser.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60, max: 60 }, facingMode: 'user' } });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
        if (generation === this.generation) this.fail('Camera disconnected or permission was revoked.');
      }, { once: true }));
      video.srcObject = stream; video.muted = true; video.playsInline = true;
      await video.play();
      if (generation !== this.generation) return;
      this.report('loading', 'Loading local hand model and tracking worker…');
      // A prebundled classic worker lets MediaPipe's pinned UMD WASM loader use importScripts.
      // The same local file works in Vite development and the offline production build.
      const workerUrl = new URL('tracking/worker.js', new URL(import.meta.env.BASE_URL, location.origin));
      const worker = new Worker(workerUrl);
      this.worker = worker;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Tracking initialization timed out. Check that all local model and WASM assets are present.')), 45000);
        this.rejectInitialization = error => { clearTimeout(timer); reject(error); };
        worker.onerror = event => {
          clearTimeout(timer);
          const error = new Error(event.message || 'Tracking worker failed.');
          if (!this.active) reject(error);
          else this.fail(error.message);
        };
        worker.onmessage = event => {
          if (generation !== this.generation) return;
          const data = event.data;
          if (data.type === 'ready') { clearTimeout(timer); this.rejectInitialization = null; this.backend = data.backend; resolve(); }
          else if (data.type === 'status') this.report('loading', data.message);
          else if (data.type === 'frame') {
            this.clearPending(); this.processedCount++;
            this.options.onFrame(data.frame as TrackingFrame);
          } else if (data.type === 'skipped') this.clearPending();
          else if (data.type === 'error') {
            this.clearPending();
            if (data.fatal) { clearTimeout(timer); reject(new Error(data.error)); }
            else this.fail(`Hand tracking stopped: ${data.error}`);
          }
        };
        worker.postMessage({ type: 'init', baseUrl: new URL(import.meta.env.BASE_URL, location.origin).href });
      });
      if (generation !== this.generation) return;
      this.active = true;
      this.reportTime = performance.now();
      this.report('running', 'Show both hands with fingers relaxed, then release both pinches to arm.');
      this.schedule(generation);
    } catch (error) {
      if (generation !== this.generation) return;
      this.stop();
      const message = error instanceof Error ? error.message : String(error);
      this.report('error', `Camera/tracking unavailable: ${message}. You can continue with mouse and keyboard.`);
      throw error;
    }
  }

  stop(): void {
    ++this.generation; this.active = false;
    this.rejectInitialization?.(new Error('Tracking initialization cancelled.')); this.rejectInitialization = null;
    if (this.video && this.callbackId !== null && 'cancelVideoFrameCallback' in this.video) this.video.cancelVideoFrameCallback(this.callbackId);
    if (this.animationId !== null) cancelAnimationFrame(this.animationId);
    this.callbackId = null; this.animationId = null;
    this.clearPending(); this.worker?.terminate(); this.worker = null;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    if (this.video) { this.video.pause(); this.video.srcObject = null; }
    this.video = null; this.backend = 'uninitialized';
    this.cameraCount = 0; this.processedCount = 0; this.lastMediaTime = -1; this.lastTimestamp = -1;
    this.stats = { cameraFps: 0, trackingFps: 0, droppedFrames: 0 };
    this.report('stopped', 'Camera is off. Mouse and keyboard controls remain available.');
  }

  private schedule(generation: number): void {
    const video = this.video;
    if (!this.active || !video || generation !== this.generation) return;
    if (typeof video.requestVideoFrameCallback === 'function') {
      this.callbackId = video.requestVideoFrameCallback((now, metadata) => {
        this.submit(generation, now, metadata.mediaTime);
        this.schedule(generation);
      });
    } else {
      this.animationId = requestAnimationFrame(now => {
        if (video.currentTime !== this.lastMediaTime) this.submit(generation, now, video.currentTime);
        this.schedule(generation);
      });
    }
  }

  private submit(generation: number, now: number, mediaTime: number): void {
    const video = this.video;
    if (!video || !this.active || generation !== this.generation || mediaTime === this.lastMediaTime) return;
    this.lastMediaTime = mediaTime; this.cameraCount++;
    if (now - this.reportTime >= 1000) {
      const seconds = (now - this.reportTime) / 1000;
      this.stats.cameraFps = this.cameraCount / seconds;
      this.stats.trackingFps = this.processedCount / seconds;
      this.cameraCount = 0; this.processedCount = 0; this.reportTime = now;
      this.report('running', 'Two-hand tracking active.');
    }
    if (this.pending) { this.stats.droppedFrames++; return; }
    this.pending = true;
    const timestamp = Math.max(now, this.lastTimestamp + 0.001); this.lastTimestamp = timestamp;
    void createImageBitmap(video).then(bitmap => {
      if (generation !== this.generation || !this.worker || !this.active) { bitmap.close(); return; }
      this.frameTimeout = setTimeout(() => this.fail('Tracking worker stopped responding. Restart the camera to recover.'), 5000);
      try { this.worker.postMessage({ type: 'frame', id: ++this.frameId, bitmap, timestamp }, [bitmap]); }
      catch (error) { bitmap.close(); throw error; }
    }).catch(error => {
      if (generation !== this.generation) return;
      this.clearPending(); this.fail(`Camera frame could not be read: ${String(error)}`);
    });
  }

  private clearPending(): void { this.pending = false; if (this.frameTimeout) clearTimeout(this.frameTimeout); this.frameTimeout = null; }
  private fail(message: string): void { this.stop(); this.report('error', `${message} Mouse and keyboard remain available.`); }
  private report(state: TrackingStatus['state'], message: string): void { this.options.onStatus({ state, message, backend: this.backend, ...this.stats }); }
}
