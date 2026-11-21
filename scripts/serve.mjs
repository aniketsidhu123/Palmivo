import http from 'node:http';
import path from 'node:path';
import { stat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { runtimeCacheControl } from './runtime-cache.mjs';
const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const cacheControl = runtimeCacheControl(root);
// Retain the previous environment variable for existing local launch configurations.
const candidate = process.argv.includes('--candidate');
const port = Number(process.env.PALMIVO_PORT || process.env.SIGNTOAST_PORT || (candidate ? 4181 : 4173));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.task': 'application/octet-stream', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === '/api/inspection/config') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ enabled: false }));
      return;
    }
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const info = await stat(file);
    if (!info.isFile()) throw Error('Not a file');
    const cache = cacheControl(url);
    if (cache === null) { res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Permissions-Policy': 'camera=(self), microphone=()' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch { res.writeHead(404); res.end('File not found'); }
});
server.on('error', error => { console.error(`Cannot start Palmivo: ${error.message}`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`Palmivo is running locally at ${url}\nKeep this window open. Press Ctrl+C to stop.`);
  if (process.argv.includes('--open') && process.platform === 'win32') execFile('rundll32.exe', ['url.dll,FileProtocolHandler', url], () => {});
});
