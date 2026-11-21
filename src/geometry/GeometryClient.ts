import type { GeometryAdapter, GeometryMesh, MeshAsset, SolidRecipe } from '../shared/types';

interface Pending { resolve: (mesh: GeometryMesh) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }
export class GeometryClient implements GeometryAdapter {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  private disposed = false;
  lastDurationMs = 0;
  private startWorker(): Worker {
    if (this.disposed) throw new Error('Geometry service is closed.');
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'solid-geometry' });
    worker.onmessage = (event: MessageEvent<{ id: number; mesh?: GeometryMesh; error?: string }>) => {
      if (worker !== this.worker) return;
      const job = this.pending.get(event.data.id); if (!job) return;
      clearTimeout(job.timeout); this.pending.delete(event.data.id);
      if (event.data.error || !event.data.mesh) job.reject(new Error(event.data.error || 'Geometry worker returned no mesh.'));
      else job.resolve(event.data.mesh);
    };
    worker.onerror = event => { event.preventDefault(); if (worker === this.worker) this.restart('Geometry worker failed. Try the command again.'); };
    this.worker = worker; return worker;
  }
  build(recipe: SolidRecipe, assets?: readonly MeshAsset[]): Promise<GeometryMesh> {
    if (this.disposed) return Promise.reject(new Error('Geometry service is closed.'));
    const worker = this.worker ?? this.startWorker();
    const id = ++this.sequence;
    const start = performance.now();
    return new Promise<GeometryMesh>((resolve, reject) => {
      const timeout = setTimeout(() => this.restart('Geometry took longer than three seconds. Previous scene preserved; try again.'), 3000);
      this.pending.set(id, { resolve: mesh => { this.lastDurationMs = performance.now() - start; resolve(mesh); }, reject, timeout });
      try { worker.postMessage(assets?.length ? { id, recipe, assets } : { id, recipe }); } catch(error) { clearTimeout(timeout); this.pending.delete(id); reject(error instanceof Error ? error : new Error('Could not submit geometry.')); }
    });
  }
  private restart(message: string): void {
    this.worker?.terminate(); this.worker = null;
    for (const job of this.pending.values()) { clearTimeout(job.timeout); job.reject(new Error(message)); }
    this.pending.clear();
  }
  dispose(): void { this.disposed = true; this.restart('Geometry service closed.'); }
}
