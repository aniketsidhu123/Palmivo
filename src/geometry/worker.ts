import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { buildMesh, initializeKernel } from './kernel';
import type { SolidRecipe } from '../shared/types';

const kernel = initializeKernel(wasmUrl);
self.onmessage = async (event: MessageEvent<{ id: number; recipe: SolidRecipe }>) => {
  const { id, recipe } = event.data;
  try {
    const mesh = buildMesh(await kernel, recipe);
    self.postMessage({ id, mesh }, { transfer: [mesh.positions.buffer, mesh.indices.buffer] });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Geometry worker failed.' });
  }
};
