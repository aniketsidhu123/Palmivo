const CONFIG = '/api/inspection/config';
const RUNS = '/api/inspections';
const POLL_INTERVAL_MS = 1000;
const INSPECTION_TIMEOUT_MS = 90_000;
const MAX_AUDIO_BASE64_LENGTH = 4 * Math.ceil(256 * 1024 / 3);

export interface InspectionResult {
  revision: number;
  dimensionsMm: [number, number, number];
  triangles: number;
  closed: boolean;
  centerPassage: boolean;
  caption: string;
  audioBase64: string | null;
  audioStatus: 'ready' | 'unavailable';
}

export async function inspectionAvailable(signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(CONFIG, { signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
    return response.ok && (await response.json() as { enabled?: unknown }).enabled === true;
  } catch { return false; }
}

function parseResult(value: unknown, revision: number): InspectionResult {
  if (!value || typeof value !== 'object') throw new Error('Inspection returned no findings.');
  const result = value as Partial<InspectionResult>;
  if (result.revision !== revision) throw new Error('Inspection revision changed. Inspect the selected solid again.');
  const audioValid = result.audioStatus === 'unavailable' ? result.audioBase64 === null :
    result.audioStatus === 'ready' && typeof result.audioBase64 === 'string' &&
    result.audioBase64.length > 0 && result.audioBase64.length <= MAX_AUDIO_BASE64_LENGTH;
  if (!Array.isArray(result.dimensionsMm) || result.dimensionsMm.length !== 3 ||
      !result.dimensionsMm.every(number => typeof number === 'number' && Number.isFinite(number) && number >= 0) ||
      !Number.isSafeInteger(result.triangles) || (result.triangles ?? 0) < 1 || typeof result.closed !== 'boolean' ||
      typeof result.centerPassage !== 'boolean' || typeof result.caption !== 'string' || !result.caption.trim() || result.caption.length > 2048 ||
      !audioValid) {
    throw new Error('Inspection returned incomplete findings.');
  }
  return result as InspectionResult;
}

function waitForPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const cancel = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, POLL_INTERVAL_MS);
    signal.addEventListener('abort', cancel, { once: true });
  });
}

export async function runInspection(
  stl: ArrayBuffer,
  revision: number,
  signal: AbortSignal,
  onStatus: (runId: string, status: 'queued' | 'running') => void,
): Promise<{ runId: string; result: InspectionResult }> {
  const expired = new AbortController();
  const timeout = setTimeout(() => expired.abort(new Error('Inspection took too long. Please try again.')), INSPECTION_TIMEOUT_MS);
  const combined = AbortSignal.any([signal, expired.signal]);
  try {
    const request = { signal: combined, cache: 'no-store' as const, credentials: 'same-origin' as const, redirect: 'error' as const };
    const response = await fetch(`${RUNS}?revision=${encodeURIComponent(revision)}`, {
      ...request, method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: stl,
    });
    if (!response.ok) throw await requestError(response, 'Inspection could not start.');
    const started = await response.json() as { runId?: unknown };
    if (typeof started.runId !== 'string' || !/^[a-z0-9_-]{1,128}$/i.test(started.runId)) throw new Error('Inspection returned an invalid run ID.');
    const runId = started.runId;
    let phase: 'queued' | 'running' = 'queued';
    onStatus(runId, phase);
    for (;;) {
      await waitForPoll(combined);
      const reply = await fetch(`${RUNS}/${runId}`, request);
      if (!reply.ok) throw await requestError(reply, 'Inspection is temporarily unavailable.');
      const run = await reply.json() as { runId?: unknown; status?: unknown; result?: unknown; error?: unknown };
      if (run.runId !== runId) throw new Error('Inspection returned an unexpected run ID.');
      if (run.status === 'succeeded') return { runId, result: parseResult(run.result, revision) };
      if (run.status === 'failed') throw new Error(safeError(run.error, 'The inspection could not finish.'));
      if (run.status !== 'queued' && run.status !== 'running') throw new Error('Inspection returned an unknown status.');
      if (run.status !== phase) {
        phase = run.status;
        onStatus(runId, phase);
      }
    }
  } catch (error) {
    if (combined.aborted) throw combined.reason;
    throw error;
  } finally { clearTimeout(timeout); }
}

function safeError(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() && value.length <= 250 ? value : fallback;
}

async function requestError(response: Response, fallback: string): Promise<Error> {
  try { return new Error(safeError((await response.json() as { error?: unknown }).error, fallback)); }
  catch { return new Error(fallback); }
}
