import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const DAY = 86_400_000;
const MAX_STL = 1_048_576;
const MAX_AUDIO_BASE64 = 4 * Math.ceil(262_144 / 3);
const RUN_ID = /^frn-[a-zA-Z0-9-]{1,80}$/;
const SESSION_COOKIE = 'palmivo_inspect_session';
const RUN_COOKIE = 'palmivo_inspect_run';
const RENDER_API = 'https://api.render.com/v1/flow-runs';

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function cookieValue(req, name) {
  const entry = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(name + '='));
  return entry?.slice(name.length + 1);
}

function verifySignature(actual, expected) {
  if (!actual || actual.length !== expected.length || !/^[a-zA-Z0-9_-]+$/.test(actual)) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

async function readSTL(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/octet-stream') {
    throw new RequestError(415, 'Send a binary STL exported from the selected solid.');
  }
  if (Number(req.headers['content-length']) > MAX_STL) throw new RequestError(413, 'Inspection supports STL files up to 1 MiB.');
  const chunks = [];
  let size = 0;
  // Keep the response socket alive long enough to deliver a 413 on chunked uploads.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_STL) {
      req.resume();
      throw new RequestError(413, 'Inspection supports STL files up to 1 MiB.');
    }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks, size);
  if (size < 134 || 84 + 50 * bytes.readUInt32LE(80) !== size) throw new RequestError(400, 'The exported STL has incomplete triangles.');
  return bytes;
}

function publicResult(result, revision) {
  // Return only the workflow contract. The Render details response also contains its raw input.
  if (!result || result.revision !== revision ||
      !Array.isArray(result.dimensionsMm) || result.dimensionsMm.length !== 3 ||
      !result.dimensionsMm.every(n => Number.isFinite(n) && n >= 0) ||
      !Number.isSafeInteger(result.triangles) || result.triangles <= 0 ||
      typeof result.closed !== 'boolean' || typeof result.centerPassage !== 'boolean' ||
      typeof result.caption !== 'string' || !result.caption.length || result.caption.length > 180 ||
      !['ready', 'unavailable'].includes(result.audioStatus)) {
    throw new RequestError(502, 'The inspection returned an incomplete report.');
  }
  const { dimensionsMm, triangles, closed, centerPassage, caption } = result;
  const audio = result.audioBase64;
  const hasAudio = result.audioStatus === 'ready' && typeof audio === 'string' && audio.length > 0 &&
    audio.length <= MAX_AUDIO_BASE64 && audio.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(audio);
  return { revision, dimensionsMm, triangles, closed, centerPassage, caption,
    audioBase64: hasAudio ? audio : null, audioStatus: hasAudio ? 'ready' : 'unavailable' };
}

export function createInspectionHandler({
  apiKey, workflowSlug, sessionSecret, secureCookies = true, fetchImpl = fetch,
  maxStarts = 20, now = Date.now,
}) {
  const enabled = Boolean(apiKey && workflowSlug && sessionSecret);
  // Only run IDs are retained locally. Render performs durable duplicate suppression on retries.
  const submissions = new Map();
  const sign = value => createHmac('sha256', sessionSecret).update(value).digest('base64url');
  const cookie = (name, value, path) => name + '=' + value + '; Path=' + path +
    '; HttpOnly; SameSite=Strict; Max-Age=86400' + (secureCookies ? '; Secure' : '');

  function readSession(req) {
    const [issued, nonce, signature] = (cookieValue(req, SESSION_COOKIE) || '').split('.');
    if (!issued || !nonce || !/^\d+$/.test(issued) || !/^[a-f0-9-]{36}$/.test(nonce)) return null;
    const age = now() - Number(issued);
    const id = issued + '.' + nonce;
    return age >= 0 && age < DAY && verifySignature(signature, sign('session:' + id)) ? id : null;
  }

  async function renderRequest(suffix, options = {}) {
    let response;
    try {
      response = await fetchImpl(RENDER_API + suffix, {
        ...options, signal: AbortSignal.timeout(12_000), redirect: 'error',
        headers: { Authorization: 'Bearer ' + apiKey, Accept: 'application/json', 'Content-Type': 'application/json' },
      });
      if (response.ok) return await response.json();
    } catch { throw new RequestError(503, 'Render is temporarily unreachable. Please retry.'); }
    await response.body?.cancel();
    if (response.status === 429) throw new RequestError(429, 'Render is busy. Please retry shortly.');
    throw new RequestError(502, 'The inspection service could not reach its registered Render workflow.');
  }

  function start(session, revision, bytes) {
    const digest = createHash('sha256').update(bytes).digest('hex');
    const key = sign('start:' + session + ':' + revision + ':' + digest);
    const instant = now();
    for (const [id, entry] of submissions) if (instant - entry.at >= DAY) submissions.delete(id);
    const existing = submissions.get(key);
    if (existing) return existing.started;
    if (submissions.size >= maxStarts) throw new RequestError(429, 'The demo inspection budget has been reached. CAD and STL export are available.');
    const started = renderRequest('', {
      method: 'POST',
      body: JSON.stringify({ flow: workflowSlug + '/inspect_part', input: [{ stlBase64: bytes.toString('base64'), revision }], idempotencyKey: key }),
    }).then(response => {
      if (!RUN_ID.test(response.id)) throw new RequestError(502, 'Render did not return a valid run ID.');
      return response.id;
    }).catch(error => { submissions.delete(key); throw error; });
    submissions.set(key, { at: instant, started });
    return started;
  }

  return async function inspection(req, res, url) {
    try {
      if (req.headers['sec-fetch-site'] === 'cross-site' ||
          (req.headers.origin && req.headers.origin !== 'https://' + req.headers.host &&
           (secureCookies || req.headers.origin !== 'http://' + req.headers.host))) {
        throw new RequestError(403, 'Open the inspection in this Palmivo workspace.');
      }
      const session = enabled ? readSession(req) : null;
      if (url.pathname === '/api/inspection/config' && req.method === 'GET') {
        if (enabled && !session) {
          const id = now() + '.' + randomUUID();
          res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, id + '.' + sign('session:' + id), '/api/'));
        }
        return json(res, 200, { enabled });
      }
      if (!enabled) throw new RequestError(503, 'Online inspection is unavailable on this deployment.');
      if (!session) throw new RequestError(403, 'Refresh the workspace to start a new inspection session.');
      if (url.pathname === '/api/inspections' && req.method === 'POST') {
        const rawRevision = url.searchParams.get('revision');
        const revision = Number(rawRevision);
        if (!rawRevision || !/^\d+$/.test(rawRevision) || !Number.isSafeInteger(revision)) throw new RequestError(400, 'A committed scene revision is required.');
        const bytes = await readSTL(req);
        const runId = await start(session, revision, bytes);
        const path = '/api/inspections/' + runId;
        res.setHeader('Set-Cookie', cookie(RUN_COOKIE, revision + '.' + sign('read:' + session + ':' + runId + ':' + revision), path));
        return json(res, 202, { runId, status: 'queued' });
      }
      if (url.pathname.startsWith('/api/inspections/') && req.method === 'GET') {
        const runId = url.pathname.slice('/api/inspections/'.length);
        const [revision, signature] = (cookieValue(req, RUN_COOKIE) || '').split('.');
        if (!RUN_ID.test(runId) || !revision || !/^\d+$/.test(revision) ||
            !verifySignature(signature, sign('read:' + session + ':' + runId + ':' + revision))) {
          throw new RequestError(404, 'Inspection run not found in this session.');
        }
        const run = await renderRequest('/' + runId);
        if (run.id !== runId) throw new RequestError(502, 'Render returned an unexpected run.');
        if (run.status === 'succeeded') {
          return json(res, 200, { runId, status: 'succeeded', result: publicResult(run.results?.[0], Number(revision)) });
        }
        if (run.status === 'pending' || run.status === 'running') {
          return json(res, 200, { runId, status: run.status === 'pending' ? 'queued' : 'running' });
        }
        return json(res, 200, { runId, status: 'failed', error: 'The workflow could not inspect this mesh. Check the selected solid and retry.' });
      }
      throw new RequestError(404, 'Unknown inspection route.');
    } catch (error) {
      return json(res, error instanceof RequestError ? error.status : 500,
        { error: error instanceof RequestError ? error.message : 'Inspection could not be completed.' });
    }
  };
}
