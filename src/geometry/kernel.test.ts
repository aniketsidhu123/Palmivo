import { beforeAll, describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import { buildMesh, initializeKernel } from './kernel';
import type { Solid } from '../shared/types';
import type { SceneDocument } from '../shared/types';
import exampleProject from '../../examples/through-hole-project.json';
import { validateDocument } from '../core/validation';

let kernel:ManifoldToplevel;
beforeAll(async()=>{ const wasmPath=decodeURIComponent(new URL('../../node_modules/manifold-3d/manifold.wasm',import.meta.url).pathname).replace(/^\/([A-Za-z]:)/,'$1'); kernel=await initializeKernel(wasmPath); });
const box=():Solid=>({id:'box',name:'Box',position:[0,0,0],scale:1,color:'#b8d7b3',recipe:{kind:'box',dimensions:[20,20,20]}});
const cylinder=():Solid=>({id:'cylinder',name:'Cylinder',position:[0,0,0],scale:1,color:'#e5a96d',recipe:{kind:'cylinder',radius:5,height:60,segments:32}});
describe('actual Manifold WASM geometry',()=>{
  it('builds a centered box with correct volume and extents',()=>{
    const mesh=buildMesh(kernel,box().recipe); expect(mesh.volume).toBeCloseTo(8000,6); expect(Math.min(...mesh.positions)).toBe(-10); expect(Math.max(...mesh.positions)).toBe(10); expect(mesh.indices.length).toBe(36);
  });
  it('builds a centered Z-axis cylinder',()=>{
    const mesh=buildMesh(kernel,cylinder().recipe); const z=Array.from(mesh.positions).filter((_,i)=>i%3===2); expect(Math.min(...z)).toBe(-30); expect(Math.max(...z)).toBe(30); expect(mesh.volume).toBeCloseTo(32*0.5*25*Math.sin(2*Math.PI/32)*60,4);
  });
  it('subtracts a real through-hole and applies operand transforms',()=>{
    const target=box(); const cutter=cylinder(); target.scale=1.4; target.position=[10,2,0]; cutter.position=[10,2,0];
    const result=buildMesh(kernel,{kind:'subtract',target,cutter}); const holeVolume=32*0.5*25*Math.sin(2*Math.PI/32)*28;
    expect(result.volume).toBeCloseTo(8000*1.4**3-holeVolume,3); expect(result.indices.length).toBeGreaterThan(36);
    const x=Array.from(result.positions).filter((_,i)=>i%3===0); expect(Math.min(...x)).toBeCloseTo(-4); expect(Math.max(...x)).toBeCloseTo(24);
  });
  it('preserves a target when a cutter is disjoint',()=>{
    const cutter=cylinder(); cutter.position=[100,0,0]; const result=buildMesh(kernel,{kind:'subtract',target:box(),cutter}); expect(result.volume).toBeCloseTo(8000,5);
  });
  it('rejects an empty Boolean result',()=>{
    const cutter=box(); cutter.scale=2; expect(()=>buildMesh(kernel,{kind:'subtract',target:box(),cutter})).toThrow(/empty solid/);
  });
  it('returns independent mesh buffers across subsequent operations',()=>{
    const first=buildMesh(kernel,box().recipe); const before=Array.from(first.positions); for(let i=0;i<25;i++) buildMesh(kernel,{kind:'subtract',target:box(),cutter:cylinder()}); expect(Array.from(first.positions)).toEqual(before);
  });
  it('validates and rebuilds the distributed example project',()=>{
    const document=exampleProject as SceneDocument;
    expect(()=>validateDocument(document)).not.toThrow();
    const result=buildMesh(kernel,document.solids[0].recipe);
    expect(result.volume).toBeGreaterThan(19000);
    expect(document.commands.at(-1)?.ast.type).toBe('Subtract');
  });
  it('builds a non-cubic precise preset box with independent X/Y/Z extents', () => {
    const mesh = buildMesh(kernel, { kind: 'box', dimensions: [20, 30, 40] });
    expect(mesh.volume).toBeCloseTo(24000, 6);
    for (const [axis, halfExtent] of [10, 15, 20].entries()) {
      const values = Array.from(mesh.positions).filter((_, index) => index % 3 === axis);
      expect(Math.min(...values)).toBe(-halfExtent); expect(Math.max(...values)).toBe(halfExtent);
    }
  });
  it.each([[3, 20], [5, 40], [8, 60]])('builds a precise cylinder of radius %i and height %i', (radius, height) => {
    const mesh = buildMesh(kernel, { kind: 'cylinder', radius, height, segments: 32 });
    const expectedVolume = 32 * 0.5 * radius ** 2 * Math.sin(2 * Math.PI / 32) * height;
    expect(mesh.volume).toBeCloseTo(expectedVolume, 4);
    const z = Array.from(mesh.positions).filter((_, index) => index % 3 === 2);
    expect(Math.min(...z)).toBe(-height / 2); expect(Math.max(...z)).toBe(height / 2);
  });
});
