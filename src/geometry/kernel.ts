import Module, { type Manifold, type ManifoldToplevel } from 'manifold-3d';
import type { GeometryMesh, Solid, SolidRecipe } from '../shared/types';

/** One module per worker, shared across all jobs. Never returns WASM-owned buffers. */
export async function initializeKernel(wasmLocation: string): Promise<ManifoldToplevel> {
  const module = await Module({ locateFile: () => wasmLocation });
  module.setup();
  return module;
}

export function buildMesh(module: ManifoldToplevel, recipe: SolidRecipe): GeometryMesh {
  const handles: Manifold[] = [];
  const own = (solid: Manifold): Manifold => { handles.push(solid); return solid; };
  const resolveSolid = (solid: Solid, depth: number): Manifold => {
    const local = resolve(solid.recipe, depth);
    const scaled = own(local.scale(solid.scale));
    return own(scaled.translate(solid.position));
  };
  const resolve = (current: SolidRecipe, depth: number): Manifold => {
    if (depth > 32) throw new Error('Solid recipe is too deeply nested.');
    switch (current.kind) {
      case 'box': return own(module.Manifold.cube(current.dimensions, true));
      case 'cylinder': return own(module.Manifold.cylinder(current.height, current.radius, current.radius, current.segments, true));
      case 'subtract': return own(resolveSolid(current.target, depth + 1).subtract(resolveSolid(current.cutter, depth + 1)));
      case 'union': return own(resolveSolid(current.target, depth + 1).add(resolveSolid(current.other, depth + 1)));
      default: throw new Error('Unsupported geometry recipe.');
    }
  };
  try {
    const solid = resolve(recipe, 0);
    const status = solid.status();
    if (status !== 'NoError') throw new Error(`Solid geometry failed: ${status}`);
    const volume = solid.volume();
    if (!Number.isFinite(volume) || volume <= 1e-6) throw new Error('The operation produced an empty solid. Check the input solids and try again.');
    const mesh = solid.getMesh();
    const count = mesh.vertProperties.length / mesh.numProp;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = mesh.vertProperties[i * mesh.numProp];
      positions[i * 3 + 1] = mesh.vertProperties[i * mesh.numProp + 1];
      positions[i * 3 + 2] = mesh.vertProperties[i * mesh.numProp + 2];
    }
    return { positions, indices: new Uint32Array(mesh.triVerts), volume };
  } finally {
    // Transforms and booleans return new handles. Free every one, including on failure.
    for (let i = handles.length - 1; i >= 0; i--) handles[i].delete();
  }
}
