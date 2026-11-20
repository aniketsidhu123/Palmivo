export type TsmRequest =
  | { id: number; type: 'load'; baseUrl: string }
  | { id: number; type: 'frame'; bitmap: ImageBitmap; timestamp: number; reset: boolean };

export interface TsmPrediction {
  logits: Float32Array;
  timestamp: number;
  preprocessMs: number;
  inferenceMs: number;
}

export type TsmReply =
  | { id: number; type: 'ready' }
  | ({ id: number; type: 'prediction' } & TsmPrediction)
  | { id: number; type: 'error'; message: string };

interface PendingRequest {
  id: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (reply: TsmReply) => void;
  reject: (error: Error) => void;
}

/** One worker request at a time keeps temporal cache updates ordered. */
export class TsmRuntime {
  private worker: Worker | null = null;
  private requestId = 0;
  private pending: PendingRequest | null = null;
  private loading: Promise<void> | null = null;
  private ready = false;

  get processing(): boolean { return this.pending !== null; }

  load(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.loading) return this.loading;
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'tsm-inference' });
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<TsmReply>) => {
      if (this.worker !== worker || event.data.id !== this.pending?.id) return;
      const pending = this.takePending()!;
      if (event.data.type === 'error') pending.reject(new Error(event.data.message));
      else pending.resolve(event.data);
    };
    worker.onerror = event => {
      event.preventDefault();
      if (this.worker === worker) this.close('The TSM inference worker failed.');
    };
    worker.onmessageerror = () => {
      if (this.worker === worker) this.close('The TSM inference worker returned an unreadable response.');
    };

    const baseUrl = new URL(import.meta.env.BASE_URL, location.href).href;
    this.loading = this.request({ id: ++this.requestId, type: 'load', baseUrl }, 15_000).then(reply => {
      if (this.worker !== worker || reply.type !== 'ready') throw new Error('The TSM worker did not initialize.');
      this.ready = true;
    }).catch(error => {
      if (this.worker === worker) this.close();
      throw error;
    }).finally(() => {
      if (this.worker === worker) this.loading = null;
    });
    return this.loading;
  }

  /** Takes ownership of the bitmap as soon as it is passed to step. */
  async step(bitmap: ImageBitmap, timestamp: number, reset = false): Promise<TsmPrediction> {
    if (!this.ready || this.pending) {
      bitmap.close();
      throw new Error('The TSM inference worker is unavailable.');
    }
    const worker = this.worker;
    try {
      const reply = await this.request({ id: ++this.requestId, type: 'frame', bitmap, timestamp, reset }, 2000, [bitmap]);
      if (this.worker !== worker || reply.type !== 'prediction') throw new Error('The TSM worker returned no prediction.');
      return { logits: reply.logits, timestamp: reply.timestamp, preprocessMs: reply.preprocessMs, inferenceMs: reply.inferenceMs };
    } catch (error) {
      if (this.worker === worker) this.close();
      throw error;
    }
  }

  close(message = 'The TSM inference worker closed.'): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.loading = null;
    this.takePending()?.reject(new Error(message));
  }

  private takePending(): PendingRequest | null {
    const pending = this.pending;
    if (pending) clearTimeout(pending.timer);
    this.pending = null;
    return pending;
  }

  private request(message: TsmRequest, timeoutMs: number, transfer: Transferable[] = []): Promise<TsmReply> {
    const worker = this.worker!;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close('The TSM inference worker timed out.'), timeoutMs);
      this.pending = { id: message.id, timer, resolve, reject };
      try {
        worker.postMessage(message, transfer);
      } catch (error) {
        this.takePending();
        if (message.type === 'frame') message.bitmap.close();
        reject(error);
      }
    });
  }
}
