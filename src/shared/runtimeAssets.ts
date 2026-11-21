interface RuntimeAsset {
  bytes: number;
  sha256: string;
}

export type RuntimeAssets = Map<string, RuntimeAsset>;

export async function readRuntimeAssets(base: URL): Promise<RuntimeAssets> {
  const response = await fetch(new URL('asset-manifest.json', base), {
    cache: 'no-cache', redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Could not load the local runtime asset manifest.');
  const manifest = await response.json();
  if (manifest?.version !== 1 || !Array.isArray(manifest.files)) {
    throw new Error('The local runtime asset manifest is invalid.');
  }
  return new Map(manifest.files.map((asset: RuntimeAsset & { path: string }) => [asset.path, asset]));
}

function requireAsset(assets: RuntimeAssets, path: string): RuntimeAsset {
  const asset = assets.get('/' + path);
  if (!asset || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 ||
      typeof asset.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(asset.sha256)) {
    throw new Error(`Missing or invalid runtime asset: ${path}`);
  }
  return asset;
}

export function runtimeAssetUrl(base: URL, assets: RuntimeAssets, path: string): URL {
  const url = new URL(path, base);
  url.searchParams.set('v', requireAsset(assets, path).sha256);
  return url;
}

export async function fetchVerifiedRuntimeAsset(base: URL, assets: RuntimeAssets, path: string): Promise<Uint8Array<ArrayBuffer>> {
  const asset = requireAsset(assets, path);
  const response = await fetch(runtimeAssetUrl(base, assets, path), { redirect: 'error' });
  if (!response.ok) throw new Error(`Could not load runtime asset: ${path}`);
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (bytes.byteLength !== asset.bytes || sha256 !== asset.sha256) {
    throw new Error(`Runtime asset verification failed: ${path}`);
  }
  return new Uint8Array(bytes);
}
