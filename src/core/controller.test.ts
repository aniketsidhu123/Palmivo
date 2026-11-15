import { describe, expect, it, vi } from 'vitest';
import { Controller } from './controller';
import { validateCommand } from './validation';
import type { GeometryAdapter, GeometryMesh, SceneDocument } from '../shared/types';

const mesh = (): GeometryMesh => ({ positions:new Float32Array([0,0,0,1,0,0,0,1,0]), indices:new Uint32Array([0,1,2]), volume:8000 });
const adapter = (): GeometryAdapter => ({ build:vi.fn(async()=>mesh()) });
const add = async (controller:Controller, primitive:'Box'|'Cylinder'='Box') => { controller.beginCreate(primitive); expect(await controller.commit()).toBe(true); return controller.state.selectedId!; };

describe('scene compiler and transaction controller',()=>{
  it('keeps primitive previews outside committed state, then records a typed AST',async()=>{
    const controller=new Controller(adapter()); controller.beginCreate('Box');
    expect(controller.state.scene.solids).toHaveLength(0); expect(controller.getDraftAST()?.type).toBe('Create');
    expect(await controller.commit('gesture-rules')).toBe(true);
    expect(controller.state.scene.solids[0].recipe).toEqual({kind:'box',dimensions:[20,20,20]});
    expect(controller.state.lastCommand?.source).toBe('gesture-rules'); expect(controller.state.scene.revision).toBe(1);
  });
  it('cancels move and scale without changing the committed transforms',async()=>{
    const controller=new Controller(adapter()); await add(controller); const original=controller.exportDocument();
    controller.beginMove(); controller.updateMove([7.2,8.8,0]); expect(controller.state.draft).toMatchObject({position:[7,9,0]}); controller.cancel();
    controller.beginScale(); controller.updateScale(1.8); controller.cancel();
    expect(controller.exportDocument()).toEqual(original);
  });
  it('rejects incomplete and identical subtraction operands',async()=>{
    const controller=new Controller(adapter()); const box=await add(controller); await add(controller,'Cylinder'); controller.select(box); controller.beginSubtract();
    expect(await controller.commit()).toBe(false); controller.chooseCutter(box); expect(controller.state.draft).toMatchObject({cutterId:null});
    expect(controller.state.scene.solids).toHaveLength(2);
  });
  it('captures transformed source operands and exactly restores them on undo',async()=>{
    const controller=new Controller(adapter()); const box=await add(controller); controller.beginScale(); controller.updateScale(1.4); await controller.commit();
    const cylinder=await add(controller,'Cylinder'); controller.beginMove(); controller.updateMove([2,0,0]); await controller.commit();
    controller.select(box); const before=controller.exportDocument(); controller.beginSubtract(); controller.chooseCutter(cylinder); await controller.commit();
    expect(controller.state.scene.solids).toHaveLength(1); expect(controller.state.scene.solids[0].recipe).toMatchObject({kind:'subtract',target:{scale:1.4},cutter:{position:[2,0,0]}});
    controller.undo(); expect(controller.state.scene.solids).toEqual(before.solids); expect(controller.state.scene.revision).toBeGreaterThan(before.revision);
  });
  it('preserves the scene and draft when geometry fails',async()=>{
    const geometry=adapter(); const controller=new Controller(geometry); await add(controller); const before=controller.exportDocument();
    vi.mocked(geometry.build).mockRejectedValueOnce(new Error('Invalid mesh')); controller.beginCreate('Cylinder'); expect(await controller.commit()).toBe(false);
    expect(controller.exportDocument()).toEqual(before); expect(controller.state.draft?.kind).toBe('create'); expect(controller.state.busy).toBe(false);
  });
  it('blocks duplicate commits while a geometry job is pending',async()=>{
    let resolve!:(value:GeometryMesh)=>void; const geometry:GeometryAdapter={build:vi.fn(()=>new Promise<GeometryMesh>(res=>{resolve=res;}))}; const controller=new Controller(geometry);
    controller.beginCreate('Box'); const first=controller.commit(); expect(await controller.commit()).toBe(false); controller.beginCreate('Cylinder'); resolve(mesh());
    expect(await first).toBe(true); expect(geometry.build).toHaveBeenCalledTimes(1); expect(controller.state.scene.commands).toHaveLength(1);
  });
  it('discards stale results after reset',async()=>{
    let resolve!:(value:GeometryMesh)=>void; const controller=new Controller({build:()=>new Promise(res=>{resolve=res;})}); controller.beginCreate('Box'); const pending=controller.commit(); controller.reset(); resolve(mesh());
    expect(await pending).toBe(false); expect(controller.state.scene.solids).toHaveLength(0); expect(controller.meshes.size).toBe(0);
  });
  it('rejects stale revisions, duplicate IDs, and invalid numeric values',()=>{
    const scene:SceneDocument={schemaVersion:1,units:'mm',revision:2,solids:[],commands:[]};
    const request={commandId:'one',baseSceneRevision:1,source:'pointer' as const,ast:{type:'Create' as const,objectId:'box',primitive:'Box' as const,dimensions:[20,20,20],position:[0,0,0] as [number,number,number]}};
    expect(()=>validateCommand(request,scene)).toThrow(/scene changed/); request.baseSceneRevision=2; request.ast.dimensions=[NaN,20,20]; expect(()=>validateCommand(request,scene)).toThrow(/dimensions/);
    request.ast.dimensions=[20,20,20]; scene.commands.push(request); expect(()=>validateCommand(request,scene)).toThrow(/already executed/);
  });
  it('clamps scaling and ignores nonfinite samples',async()=>{
    const controller=new Controller(adapter()); await add(controller); controller.beginScale(); controller.updateScale(100); expect(controller.state.draft).toMatchObject({uniformScale:2}); controller.updateScale(NaN); expect(controller.state.draft).toMatchObject({uniformScale:2}); controller.updateScale(0.001); expect(controller.state.draft).toMatchObject({uniformScale:0.5});
  });
  it('pauses editing and limits the scene to ten visible solids',async()=>{
    const controller=new Controller(adapter()); controller.setPaused(true); controller.beginCreate('Box'); expect(controller.state.draft).toBeNull(); controller.setPaused(false);
    for(let i=0;i<10;i++) await add(controller); controller.beginCreate('Box'); expect(controller.state.draft).toBeNull(); expect(controller.state.scene.solids).toHaveLength(10);
  });
  it('restores a saved project by rebuilding its meshes',async()=>{
    const first=new Controller(adapter()); await add(first); const saved=first.exportDocument(); const next=new Controller(adapter()); expect(await next.restore(saved)).toBe(true); expect(next.exportDocument()).toEqual(saved); expect(next.meshes.size).toBe(1);
  });
  it('rejects unsupported saved projects without replacing the scene',async()=>{
    const controller=new Controller(adapter()); await add(controller); const original=controller.exportDocument(); const invalid=controller.exportDocument(); invalid.schemaVersion=2 as 1;
    expect(await controller.restore(invalid)).toBe(false); expect(controller.exportDocument()).toEqual(original);
  });
  it('does not publish repeated Move samples within the same snapped cell', async () => {
    const controller = new Controller(adapter()); await add(controller); controller.beginMove();
    const changed = vi.fn(); const unsubscribe = controller.subscribe(changed); changed.mockClear();
    controller.updateMove([0.1, -0.1, 0]);
    expect(changed).not.toHaveBeenCalled();
    controller.updateMove([1.2, 2.1, 0]);
    expect(changed).toHaveBeenCalledTimes(1);
    controller.updateMove([1.4, 2.4, 0]); controller.updateMove([1, 2, 0]);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(controller.state.draft).toMatchObject({ position: [1, 2, 0] });
    expect(controller.state.scene.solids[0].position).toEqual([0, 0, 0]); unsubscribe();
  });
  it('does not publish effectively unchanged or repeatedly clamped Scale samples', async () => {
    const controller = new Controller(adapter()); await add(controller); controller.beginScale();
    const changed = vi.fn(); const unsubscribe = controller.subscribe(changed); changed.mockClear();
    controller.updateScale(1); controller.updateScale(1 + 0.0000005);
    expect(changed).not.toHaveBeenCalled();
    controller.updateScale(1.4); expect(changed).toHaveBeenCalledTimes(1);
    controller.updateScale(1.4000005); expect(changed).toHaveBeenCalledTimes(1);
    controller.updateScale(100); expect(changed).toHaveBeenCalledTimes(2);
    controller.updateScale(5); expect(changed).toHaveBeenCalledTimes(2);
    expect(controller.state.draft).toMatchObject({ uniformScale: 2 }); unsubscribe();
  });
  it('does not republish an already selected solid or cutter', async () => {
    const controller = new Controller(adapter()); const box = await add(controller); const cylinder = await add(controller, 'Cylinder');
    const changed = vi.fn(); const unsubscribe = controller.subscribe(changed); changed.mockClear();
    controller.select(cylinder); expect(changed).not.toHaveBeenCalled();
    controller.select(box); expect(changed).toHaveBeenCalledTimes(1);
    controller.select(box); expect(changed).toHaveBeenCalledTimes(1);
    controller.beginSubtract(); controller.chooseCutter(cylinder); changed.mockClear();
    controller.chooseCutter(cylinder); expect(changed).not.toHaveBeenCalled();
    expect(controller.state.draft).toMatchObject({ targetId: box, cutterId: cylinder }); unsubscribe();
  });
  it('keeps exact Cancel and Undo transforms after deduplicated preview updates', async () => {
    const controller = new Controller(adapter()); await add(controller);
    controller.beginMove(); controller.updateMove([8.1, -3.2, 0]); controller.updateMove([8.4, -3.4, 0]); controller.cancel();
    expect(controller.state.scene.solids[0].position).toEqual([0, 0, 0]);
    controller.beginScale(); controller.updateScale(1.4); controller.updateScale(1.4000005); await controller.commit();
    expect(controller.state.scene.solids[0].scale).toBe(1.4);
    controller.undo(); expect(controller.state.scene.solids[0].scale).toBe(1);
  });
});
