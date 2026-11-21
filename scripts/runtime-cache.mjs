import { readFileSync } from 'node:fs';
import path from 'node:path';

const immutable = 'public, max-age=31536000, immutable';

export function runtimeCacheControl(root) {
  let versions = new Map();
  try {
    const manifest = JSON.parse(readFileSync(path.join(root, 'asset-manifest.json'), 'utf8'));
    versions = new Map(manifest.files.map(asset => [asset.path, asset.sha256]));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  return url => {
    const version = url.searchParams.get('v');
    const expected = versions.get(url.pathname);
    if (expected && version !== null) {
      // Reject outdated URLs so that older pages cannot cache bytes from a different build.
      return version === expected ? immutable : null;
    }
    return /^\/assets\/[^/]+-[a-zA-Z0-9_-]{8}\.[a-z0-9]+$/.test(url.pathname) ? immutable : 'no-cache';
  };
}
