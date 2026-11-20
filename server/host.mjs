import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createInspectionHandler } from './inspection.mjs';

const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript',
  '.mjs': 'application/javascript', '.json': 'application/json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.stl': 'application/octet-stream',
};

export function createHostedServer({ env = process.env, directory = distDir, fetchImpl = fetch } = {}) {
  const root = path.resolve(directory);
  const inspect = createInspectionHandler({
    apiKey: env.RENDER_API_KEY, workflowSlug: env.PALMIVO_WORKFLOW_SLUG,
    sessionSecret: env.PALMIVO_INSPECT_SECRET, secureCookies: Boolean(env.RENDER) || env.NODE_ENV === 'production',
    fetchImpl,
  });
  return http.createServer(async (req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=()');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) { await inspect(req, res, url); return; }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
      if (url.pathname === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : 'OK'); return;
      }
      const requested = decodeURIComponent(url.pathname);
      const file = path.resolve(root, '.' + (requested === '/' ? '/index.html' : requested));
      if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
      const info = await stat(file);
      if (!info.isFile()) throw Error('Missing file');
      const immutable = /^\/assets\/[^/]+-[a-zA-Z0-9_-]{8}\.[a-z0-9]+$/.test(url.pathname);
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
        'Content-Length': info.size, 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
      if (req.method === 'HEAD') res.end();
      else await pipeline(createReadStream(file), res);
    } catch {
      if (!res.headersSent) res.writeHead(404);
      res.end();
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 10000);
  createHostedServer().listen(port, '0.0.0.0', () => console.log('Palmivo web service listening on port ' + port));
}
