import type { ModelManifest, WorkerReply, WorkerRequest } from './contract';

interface Pending {
  id: number;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (reply: WorkerReply) => void;
  reject: (error: Error) => void;
}

/**
 * The worker maintains temporal state. A request cannot overtake an earlier step,
 * and a timeout invalidates the worker rather than reusing an unknown state.
 */
export class LearnedBackend {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending: Pending | null = null;
  private manifest: ModelManifest | null = null;

  get processing(): boolean { return this.pending !== null; }

  async load(): Promise<ModelManifest> {
    if (this.manifest) return this.manifest;
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'gesture-inference' });
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      if (worker !== this.worker || !this.pending || this.pending.id !== event.data.id) return;
      const request = this.takePending()!;
      if (event.data.type === 'error') request.reject(new Error(event.data.message));
      else request.resolve(event.data);
    };
    worker.onerror = event => {
      event.preventDefault();
      if (worker === this.worker) this.close('The offline gesture inference worker failed.');
    };
    worker.onmessageerror = () => {
      if (worker === this.worker) this.close('The offline gesture inference worker returned an unreadable reply.');
    };
    try {
      const baseUrl = new URL(import.meta.env.BASE_URL, location.href).href;
      const reply = await this.request({ id: ++this.sequence, type: 'load', baseUrl }, 10_000);
      if (reply.type !== 'ready') throw new Error('The learned gesture worker did not initialize.');
      this.manifest = reply.manifest;
      return this.manifest;
    } catch (error) {
      this.close();
      throw error;
    }
  }

  async step(features: Float32Array, reset: boolean): Promise<Extract<WorkerReply, { type: 'logits' }>> {
    const copy = new Float32Array(features);
    const reply = await this.request({ id: ++this.sequence, type: 'step', features: copy, reset }, 1000, [copy.buffer]);
    if (reply.type !== 'logits') throw new Error('The learned gesture worker returned no logits.');
    return reply;
  }

  close(message = 'The learned gesture session closed.'): void {
    this.worker?.terminate();
    this.worker = null;
    this.manifest = null;
    this.takePending()?.reject(new Error(message));
  }

  private takePending(): Pending | null {
    const pending = this.pending;
    if (pending) clearTimeout(pending.timeout);
    this.pending = null;
    return pending;
  }

  private request(request: WorkerRequest, timeoutMs: number, transfer: Transferable[] = []): Promise<WorkerReply> {
    const worker = this.worker;
    if (!worker || this.pending) return Promise.reject(new Error('The learned gesture worker is unavailable.'));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => this.close('The learned gesture worker timed out.'), timeoutMs);
      this.pending = { id: request.id, timeout, resolve, reject };
      try {
        worker.postMessage(request, transfer);
      } catch (error) {
        this.takePending();
        reject(error);
      }
    });
  }
}
