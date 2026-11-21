import Module, { type Manifold, type ManifoldToplevel } from 'manifold-3d';
import type { GeometryMesh, MeshAsset, Solid, SolidRecipe } from '../shared/types';
import { unpackMeshAsset } from '../core/meshAsset';
import { colorByte, hexToRgb } from '../core/meshColors';

/** One module per worker, shared across all jobs. Never returns WASM-owned buffers. */
export async function initializeKernel(wasmLocation: string): Promise<ManifoldToplevel> {
  const module = await Module({ locateFile: () => wasmLocation });
  module.setup();
  return module;
}

/** Keep the geometric weld while allowing faces on either side of a colour seam to differ. */
function coloredMesh(module: ManifoldToplevel, positions: Float32Array, indices: Uint32Array, colors: Uint8Array) {
  const propertyVertices = new Map<number, number>();
  const firstAtPosition = new Map<number, number>();
  const properties: number[] = [];
  const mergeFrom: number[] = [], mergeTo: number[] = [];
  const faces = indices.map((position, corner) => {
    const rgb = colors.subarray(corner * 3, corner * 3 + 3);
    const key = position * 0x1000000 + rgb[0] * 0x10000 + rgb[1] * 0x100 + rgb[2];
    const existing = propertyVertices.get(key);
    if (existing !== undefined) return existing;
    const vertex = properties.length / 6;
    propertyVertices.set(key, vertex);
    properties.push(...positions.subarray(position * 3, position * 3 + 3), ...rgb);
    const first = firstAtPosition.get(position);
    if (first === undefined) firstAtPosition.set(position, vertex);
    else { mergeFrom.push(vertex); mergeTo.push(first); }
    return vertex;
  });
  return new module.Mesh({
    numProp: 6, vertProperties: Float32Array.from(properties), triVerts: faces,
    mergeFromVert: Uint32Array.from(mergeFrom), mergeToVert: Uint32Array.from(mergeTo),
  });
}

export function buildMesh(module: ManifoldToplevel, recipe: SolidRecipe, assets: readonly MeshAsset[] = []): GeometryMesh {
  const handles: Manifold[] = [];
  const own = (solid: Manifold): Manifold => { handles.push(solid); return solid; };
  const resolveSolid = (solid: Solid, depth: number): Manifold => {
    const local = resolve(solid.recipe, depth);
    const scaled = own(local.scale(solid.scale));
    return own(scaled.translate(solid.position));
  };
  const applyBodyColor = (mesh: Manifold, solid: Solid) => {
    if (mesh.numProp() >= 3) return mesh;
    const [r, g, b] = hexToRgb(solid.color);
    return own(mesh.setProperties(3, color => { color[0] = r; color[1] = g; color[2] = b; }));
  };
  const resolve = (current: SolidRecipe, depth: number): Manifold => {
    if (depth > 32) throw new Error('Solid recipe is too deeply nested.');
    switch (current.kind) {
      case 'mesh': {
        const asset = assets.find(item => item.id === current.assetId);
        if (!asset) throw Error('A mesh referenced by this solid is missing.');
        const { positions, indices, colors } = unpackMeshAsset(asset);
        const mesh = colors ? coloredMesh(module, positions, indices, colors) : new module.Mesh({ numProp: 3, vertProperties: positions, triVerts: indices });
        const result = own(module.Manifold.ofMesh(mesh));
        if (result.status() !== 'NoError' || result.volume() <= 1e-6) throw Error('Import requires a closed solid with consistent outward-facing triangles. Check the mesh in your modelling tool.');
        return result;
      }
      case 'box': return own(module.Manifold.cube(current.dimensions, true));
      case 'cylinder': return own(module.Manifold.cylinder(current.height, current.radius, current.radius, current.segments, true));
      case 'sphere': return own(module.Manifold.sphere(current.radius, current.segments));
      case 'cone': return own(module.Manifold.cylinder(current.height, current.radius, 0, current.segments, true));
      case 'pyramid': return own(own(module.Manifold.cylinder(current.height, current.base / Math.SQRT2, 0, 4, true)).rotate([0, 0, 45]));
      case 'subtract':
      case 'union': {
        const operand = current.kind === 'subtract' ? current.cutter : current.other;
        let left = resolveSolid(current.target, depth + 1), right = resolveSolid(operand, depth + 1);
        if (left.numProp() || right.numProp()) {
          left = applyBodyColor(left, current.target);
          right = applyBodyColor(right, operand);
        }
        return own(current.kind === 'subtract' ? left.subtract(right) : left.add(right));
      }
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
    const colors = mesh.numProp >= 6 ? new Uint8Array(count * 3) : undefined;
    for (let i = 0; i < count; i++) {
      for (let channel = 0; channel < 3; channel++) {
        positions[i * 3 + channel] = mesh.vertProperties[i * mesh.numProp + channel];
        if (colors) colors[i * 3 + channel] = colorByte(mesh.vertProperties[i * mesh.numProp + 3 + channel]);
      }
    }
    return { positions, indices: new Uint32Array(mesh.triVerts), volume, ...(colors ? { colors } : {}) };
  } finally {
    // Transforms and booleans return new handles. Free every one, including on failure.
    for (let i = handles.length - 1; i >= 0; i--) handles[i].delete();
  }
}
