import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeometryClient } from './GeometryClient';
import type { GeometryMesh, SolidRecipe } from '../shared/types';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { preventDefault(): void }) => void) | null = null;
  lastRequest: { id: number; recipe: SolidRecipe } | null = null;
  terminated = false;
  constructor() { FakeWorker.instances.push(this); }
  postMessage(value: { id: number; recipe: SolidRecipe }) { this.lastRequest = value; }
  terminate() { this.terminated = true; }
  respond(data: unknown) { this.onmessage?.({ data }); }
}
const recipe: SolidRecipe = { kind:'box', dimensions:[20,20,20] };
const mesh = (): GeometryMesh => ({positions:new Float32Array([0,0,0]),indices:new Uint32Array([0,0,0]),volume:8000});

beforeEach(()=>{ FakeWorker.instances=[]; vi.stubGlobal('Worker',FakeWorker); vi.useFakeTimers(); });
afterEach(()=>{ vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('geometry worker lifecycle',()=>{
  it('matches results by job ID and ignores unknown packets',async()=>{
    const client=new GeometryClient(); const job=client.build(recipe); const worker=FakeWorker.instances[0];
    worker.respond({id:999,mesh:mesh()}); expect(worker.lastRequest?.id).toBe(1);
    worker.respond({id:1,mesh:mesh()}); expect((await job).volume).toBe(8000); client.dispose();
  });
  it('terminates stalled workers and ignores their late results after restart',async()=>{
    const client=new GeometryClient(); const first=client.build(recipe); const rejected=expect(first).rejects.toThrow(/three seconds/); const oldWorker=FakeWorker.instances[0];
    await vi.advanceTimersByTimeAsync(3001); await rejected; expect(oldWorker.terminated).toBe(true);
    const next=client.build(recipe); const newWorker=FakeWorker.instances[1]; oldWorker.respond({id:2,mesh:mesh()}); newWorker.respond({id:2,mesh:mesh()});
    expect((await next).volume).toBe(8000); client.dispose();
  });
  it('rejects pending work when disposed and never restarts',async()=>{
    const client=new GeometryClient(); const job=client.build(recipe); const rejected=expect(job).rejects.toThrow(/closed/); client.dispose(); await rejected;
    expect(FakeWorker.instances[0].terminated).toBe(true); await expect(client.build(recipe)).rejects.toThrow(/closed/); expect(FakeWorker.instances).toHaveLength(1);
  });
});
