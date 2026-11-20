import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectionAvailable, runInspection } from './inspection';

const result = {
  revision: 6, dimensionsMm: [22, 22, 44], triangles: 400, closed: true, centerPassage: true,
  caption: 'Twenty-two by twenty-two by forty-four millimetres.',
  audioBase64: null, audioStatus: 'unavailable',
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('spoken inspection client', () => {
  it('leaves the feature disabled when the local server provides no inspection API', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ enabled: false }));
    vi.stubGlobal('fetch', fetch);
    await expect(inspectionAvailable()).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledWith('/api/inspection/config', expect.objectContaining({ credentials: 'same-origin' }));
  });

  it('sends only the selected STL bytes and revision, then follows the same workflow run', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ runId: 'run-1', status: 'queued' }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ runId: 'run-1', status: 'running' }))
      .mockResolvedValueOnce(Response.json({ runId: 'run-1', status: 'succeeded', result }));
    vi.stubGlobal('fetch', fetch);
    const bytes = new ArrayBuffer(84);
    const onStatus = vi.fn();
    const inspection = runInspection(bytes, 6, new AbortController().signal, onStatus);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(inspection).resolves.toEqual({ runId: 'run-1', result });
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/inspections?revision=6', expect.objectContaining({
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes,
    }));
    expect(fetch.mock.calls.slice(1).map(call => call[0])).toEqual(['/api/inspections/run-1', '/api/inspections/run-1']);
    expect(onStatus.mock.calls).toEqual([['run-1', 'queued'], ['run-1', 'running']]);
  });

  it('rejects a result attributed to a different revision', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ runId: 'run-1', status: 'queued' }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ runId: 'run-1', status: 'succeeded', result: { ...result, revision: 5 } })));
    const outcome = expect(runInspection(new ArrayBuffer(84), 6, new AbortController().signal, vi.fn()))
      .rejects.toThrow('Inspection revision changed');
    await vi.advanceTimersByTimeAsync(1_000);
    await outcome;
  });
});
