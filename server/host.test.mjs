import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createHostedServer } from './host.mjs';

const env = { RENDER_API_KEY: 'fixture-key', PALMIVO_WORKFLOW_SLUG: 'fixture-workflow', PALMIVO_INSPECT_SECRET: 'fixture-signing-key' };
const stl = Buffer.alloc(134);
stl.writeUInt32LE(1, 80);
const report = {
  revision: 5, dimensionsMm: [20, 20, 40], triangles: 400, closed: true, centerPassage: true,
  caption: 'Twenty by twenty by forty millimetres.', audioBase64: 'SUQz', audioStatus: 'ready',
};
const takeCookie = response => response.headers.get('set-cookie')?.split(';')[0];

test('only the current content-versioned runtime URL is served with immutable caching', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'palmivo-cache-'));
  const asset = 'model.onnx';
  const manifest = 'asset-manifest.json';
  const sha256 = 'a'.repeat(64);
  t.after(async () => {
    await Promise.all([unlink(path.join(directory, asset)), unlink(path.join(directory, manifest))]);
    await rmdir(directory);
  });
  await Promise.all([
    writeFile(path.join(directory, asset), 'model'),
    writeFile(path.join(directory, manifest), JSON.stringify({ version: 1, files: [{ path: '/' + asset, sha256 }] })),
  ]);

  const server = createHostedServer({ env: {}, directory });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const getHeaders = async resource => {
    const response = await fetch(url + resource, { method: 'HEAD' });
    return [response.status, response.headers.get('cache-control')];
  };
  assert.deepEqual(await getHeaders(`${asset}?v=${sha256}`), [200, 'public, max-age=31536000, immutable']);
  assert.deepEqual(await getHeaders(`${asset}?v=${'b'.repeat(64)}`), [404, 'no-store']);
  assert.deepEqual(await getHeaders(asset), [200, 'no-cache']);
  assert.deepEqual(await getHeaders(manifest), [200, 'no-cache']);
});

async function app(t, fetchImpl, config = env) {
  const server = createHostedServer({ env: config, fetchImpl });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const session = async () => takeCookie(await fetch(base + '/api/inspection/config'));
  const post = (sid, revision, buffer = stl, extra = {}) => fetch(base + '/api/inspections?revision=' + revision, {
    method: 'POST', body: buffer, headers: { cookie: sid, 'content-type': 'application/octet-stream', ...extra },
  });
  const get = (runId, cookies) => fetch(base + '/api/inspections/' + runId, { headers: { cookie: cookies } });
  return { base, session, post, get };
}

test('concurrent duplicate uploads start one workflow, and its receipt is bound to the issuing session and run', async t => {
  const calls = [];
  const service = await app(t, async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.headers.Authorization, 'Bearer fixture-key');
    if (options.method === 'POST') return Response.json({ id: 'frn-123', status: 'pending' }, { status: 202 });
    return Response.json({ id: 'frn-123', status: 'succeeded', input: ['private mesh'], results: [{ ...report, secret: 'private' }] });
  });
  const sid = await service.session();
  const [first, second] = await Promise.all([service.post(sid, 5), service.post(sid, 5)]);
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.deepEqual(await first.json(), { runId: 'frn-123', status: 'queued' });
  const receipt = takeCookie(first);
  assert.equal(receipt, takeCookie(second));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.render.com/v1/flow-runs');
  const submitted = JSON.parse(calls[0].options.body);
  assert.deepEqual(submitted.input, [{ revision: 5, stlBase64: stl.toString('base64') }]);
  assert.equal(submitted.flow, 'fixture-workflow/inspect_part');
  assert.ok(submitted.idempotencyKey);
  const result = await service.get('frn-123', sid + '; ' + receipt);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { runId: 'frn-123', status: 'succeeded', result: report });
  assert.equal((await service.get('frn-123', await service.session() + '; ' + receipt)).status, 404);
  assert.equal((await service.get('frn-other', sid + '; ' + receipt)).status, 404);
  assert.equal(calls.length, 2);
});

test('invalid uploads, revisions, missing sessions and cross-origin requests are rejected before starting a run', async t => {
  const service = await app(t, () => { assert.fail('Unexpected external request'); });
  const sid = await service.session();
  assert.equal((await service.post('', 5)).status, 403);
  assert.equal((await service.post(sid, -1)).status, 400);
  assert.equal((await service.post(sid, 5, Buffer.alloc(100))).status, 400);
  assert.equal((await service.post(sid, 5, Buffer.alloc(1_048_577))).status, 413);
  const chunked = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(1_048_577)); controller.close(); },
  });
  const oversized = await fetch(service.base + '/api/inspections?revision=5', {
    method: 'POST', duplex: 'half', body: chunked, headers: { cookie: sid, 'content-type': 'application/octet-stream' },
  });
  assert.equal(oversized.status, 413);
  assert.equal((await service.post(sid, 5, stl, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await service.post(sid, 5, stl, { origin: 'https://elsewhere.example' })).status, 403);
});

test('an unavailable voice preserves the report, wrong revision fails, and provider errors have safe messages', async t => {
  let response = 'pending';
  const service = await app(t, async (_url, options) => {
    if (options.method === 'POST') return Response.json({ id: 'frn-abc' }, { status: 202 });
    if (response === 'unavailable') return Response.json({ id: 'frn-abc', status: 'succeeded', results: [{ ...report, audioStatus: 'unavailable', audioBase64: null }] });
    if (response === 'stale') return Response.json({ id: 'frn-abc', status: 'succeeded', results: [{ ...report, revision: 4 }] });
    return Response.json({ id: 'frn-abc', status: response, error: 'private worker detail' });
  });
  const sid = await service.session();
  const auth = sid + '; ' + takeCookie(await service.post(sid, 5));
  assert.equal((await (await service.get('frn-abc', auth)).json()).status, 'queued');
  response = 'running';
  assert.equal((await (await service.get('frn-abc', auth)).json()).status, 'running');
  response = 'unavailable';
  assert.deepEqual((await (await service.get('frn-abc', auth)).json()).result, { ...report, audioStatus: 'unavailable', audioBase64: null });
  response = 'stale';
  assert.equal((await service.get('frn-abc', auth)).status, 502);
  response = 'failed';
  const failed = await (await service.get('frn-abc', auth)).json();
  assert.equal(failed.status, 'failed');
  assert.ok(!failed.error.includes('private'));
});

test('transient submit retries keep the Render idempotency key; new revisions use distinct keys and a bounded demo budget', async t => {
  const keys = [];
  const service = await app(t, async (_url, options) => {
    keys.push(JSON.parse(options.body).idempotencyKey);
    if (keys.length === 1) throw Error('network failure after upload');
    return Response.json({ id: 'frn-abc' }, { status: 202 });
  });
  const sid = await service.session();
  assert.equal((await service.post(sid, 0)).status, 503);
  for (let revision = 0; revision < 20; revision++) assert.equal((await service.post(sid, revision)).status, 202);
  assert.equal(keys[0], keys[1]);
  assert.equal(new Set(keys).size, 20);
  assert.equal((await service.post(sid, 20)).status, 429);
  assert.equal((await service.post(sid, 5)).status, 202);
  assert.equal(keys.length, 21);
});

test('hosted CAD advertises inspection availability without credentials and preserves the camera and isolation headers', async t => {
  const service = await app(t, () => assert.fail('Unexpected external request'), {});
  const response = await fetch(service.base + '/api/inspection/config');
  assert.deepEqual(await response.json(), { enabled: false });
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.equal(response.headers.get('Permissions-Policy'), 'camera=(self), microphone=()');
  assert.equal((await service.post('', 5)).status, 503);
  assert.equal((await fetch(service.base + '/healthz')).status, 200);
});
