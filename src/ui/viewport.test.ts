import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CADViewport } from './viewport';
import type { ControllerState, GeometryMesh, Solid } from '../shared/types';

type Entry = { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>; source: GeometryMesh | null; recipe: Solid['recipe'] };
type Internals = { solids: Map<string, Entry>; solidGroup: THREE.Group; scene: THREE.Scene; outline: THREE.BoxHelper | null; outlinedMesh: THREE.Object3D | null };

// Exercise real scene/geometry/material behavior without constructing a WebGL renderer.
// Renderer allocation, camera capture, and visual output remain browser-QA responsibilities.
function viewportHarness() {
  const view = Object.create(CADViewport.prototype) as CADViewport;
  const solidGroup = new THREE.Group(), scene = new THREE.Scene(); scene.add(solidGroup);
  Object.assign(view, { solids: new Map(), solidGroup, scene, outline: null, outlinedMesh: null, state: null, disposed: false, diagnostics: { structuralUpdates: 0, previewUpdates: 0, outlineCreations: 0, geometryCreations: 0 } });
  return { view, internal: view as unknown as Internals };
}
function geometrySource(): GeometryMesh {
  const geometry = new THREE.BoxGeometry(20, 20, 20);
  const source = { positions: new Float32Array(geometry.getAttribute('position').array), normals: new Float32Array(geometry.getAttribute('normal').array), indices: new Uint32Array(geometry.index!.array), volume: 8000 };
  geometry.dispose(); return source;
}
function fixture() {
  const solids: Solid[] = [
    { id: 'box-a', name: 'Box A', recipe: { kind: 'box', dimensions: [20, 20, 20] }, position: [0, 0, 0], scale: 1, color: '#b8d7b3' },
    { id: 'box-b', name: 'Box B', recipe: { kind: 'box', dimensions: [20, 20, 20] }, position: [30, 0, 0], scale: 1, color: '#e5a96d' },
  ];
  const state: ControllerState = { scene: { schemaVersion: 1, units: 'mm', revision: 2, solids, commands: [] }, selectedId: 'box-a', draft: null, busy: false, paused: false, message: '', lastCommand: null, historyCount: 2 };
  const meshes = new Map(solids.map(solid => [solid.id, geometrySource()]));
  const { view, internal } = viewportHarness(); view.update(state, meshes);
  return { state, meshes, view, internal };
}
function outlineX(outline: THREE.BoxHelper): number[] { return Array.from(outline.geometry.getAttribute('position').array).filter((_, index) => index % 3 === 0); }

describe('allocation-bounded CAD preview updates', () => {
  it('updates only the moving solid and reuses geometry, material, and outline for 100 samples', () => {
    const { state, meshes, view, internal } = fixture();
    state.draft = { kind: 'move', targetId: 'box-a', position: [0, 0, 0] }; view.update(state, meshes);
    const moving = internal.solids.get('box-a')!.mesh, other = internal.solids.get('box-b')!.mesh;
    const geometry = moving.geometry, material = moving.material, outline = internal.outline!;
    const version = material.version, counts = { ...view.diagnostics };
    for (let step = 1; step <= 100; step++) { state.draft.position = [step, step * 2, 0]; view.updatePreview(state); }
    expect(moving.position.toArray()).toEqual([100, 200, 0]); expect(other.position.toArray()).toEqual([30, 0, 0]);
    expect(moving.geometry).toBe(geometry); expect(moving.material).toBe(material); expect(material.version).toBe(version);
    expect(internal.outline).toBe(outline); expect(view.diagnostics.outlineCreations).toBe(counts.outlineCreations);
    expect(view.diagnostics.geometryCreations).toBe(counts.geometryCreations); expect(view.diagnostics.structuralUpdates).toBe(counts.structuralUpdates);
    expect(view.diagnostics.previewUpdates - counts.previewUpdates).toBe(100);
    expect(Math.min(...outlineX(outline))).toBe(90); expect(Math.max(...outlineX(outline))).toBe(110);
  });
  it('restores the exact committed transform and same outline on Cancel', () => {
    const { state, meshes, view, internal } = fixture(); const outline = internal.outline;
    state.draft = { kind: 'move', targetId: 'box-a', position: [8, -3, 0] }; view.update(state, meshes);
    state.draft.position = [13, 4, 0]; view.updatePreview(state);
    state.draft = null; view.update(state, meshes);
    expect(internal.solids.get('box-a')!.mesh.position.toArray()).toEqual([0, 0, 0]); expect(internal.outline).toBe(outline);
    expect(Math.min(...outlineX(outline!))).toBe(-10); expect(Math.max(...outlineX(outline!))).toBe(10);
  });
  it('previews and commits scale without rebuilding its authoritative mesh', () => {
    const { state, meshes, view, internal } = fixture(); const mesh = internal.solids.get('box-a')!.mesh, geometry = mesh.geometry;
    state.draft = { kind: 'scale', targetId: 'box-a', uniformScale: 1 }; view.update(state, meshes);
    state.draft.uniformScale = 1.4; view.updatePreview(state); expect(mesh.scale.toArray()).toEqual([1.4, 1.4, 1.4]);
    const geometryCount = view.diagnostics.geometryCreations;
    state.scene = structuredClone(state.scene); state.scene.solids[0].scale = 1.4; state.draft = null; view.update(state, meshes);
    expect(internal.solids.get('box-a')!.mesh.geometry).toBe(geometry); expect(view.diagnostics.geometryCreations).toBe(geometryCount);
    expect(mesh.scale.toArray()).toEqual([1.4, 1.4, 1.4]);
  });
  it('reuses one outline across selection changes and disposes it when selection disappears', () => {
    const { state, meshes, view, internal } = fixture(); const outline = internal.outline!;
    const geometryDispose = vi.spyOn(outline.geometry, 'dispose'), materialDispose = vi.spyOn(outline.material, 'dispose');
    state.selectedId = 'box-b'; view.update(state, meshes);
    expect(internal.outline).toBe(outline); expect(internal.outlinedMesh).toBe(internal.solids.get('box-b')!.mesh);
    expect(view.diagnostics.outlineCreations).toBe(1); expect(Math.min(...outlineX(outline))).toBe(20);
    state.selectedId = null; view.update(state, meshes); view.update(state, meshes);
    expect(internal.outline).toBeNull(); expect(geometryDispose).toHaveBeenCalledTimes(1); expect(materialDispose).toHaveBeenCalledTimes(1);
  });
  it('changes material program flags only when transparency/depth mode changes', () => {
    const { state, meshes, view, internal } = fixture(); const cutter = internal.solids.get('box-b')!.mesh.material;
    const originalVersion = cutter.version; view.update(state, meshes); expect(cutter.version).toBe(originalVersion);
    state.draft = { kind: 'subtract', targetId: 'box-a', cutterId: 'box-b', resultId: 'result' }; view.update(state, meshes);
    expect(cutter.transparent).toBe(true); expect(cutter.depthWrite).toBe(false); expect(cutter.opacity).toBe(.43); const cutterVersion = cutter.version;
    view.update(state, meshes); expect(cutter.version).toBe(cutterVersion); expect(cutter.flatShading).toBe(true);
    state.draft = null; view.update(state, meshes); expect(cutter.version).toBe(cutterVersion + 1); expect(cutter.transparent).toBe(false); expect(cutter.depthWrite).toBe(true); expect(cutter.opacity).toBe(1);
  });
  it('disposes replaced geometry/material once while retaining the selection outline', () => {
    const { state, meshes, view, internal } = fixture(); const old = internal.solids.get('box-a')!.mesh, outline = internal.outline;
    const geometryDispose = vi.spyOn(old.geometry, 'dispose'), materialDispose = vi.spyOn(old.material, 'dispose');
    meshes.set('box-a', geometrySource()); view.update(state, meshes);
    const next = internal.solids.get('box-a')!.mesh;
    expect(next).not.toBe(old); expect(geometryDispose).toHaveBeenCalledTimes(1); expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(internal.outline).toBe(outline); expect(internal.outlinedMesh).toBe(next); expect(view.diagnostics.outlineCreations).toBe(1);
    state.draft = { kind: 'move', targetId: 'box-a', position: [40, 0, 0] }; view.updatePreview(state);
    expect(Math.min(...outlineX(outline!))).toBe(30);
    view.update(state, meshes); expect(geometryDispose).toHaveBeenCalledTimes(1); expect(materialDispose).toHaveBeenCalledTimes(1);
  });
});
