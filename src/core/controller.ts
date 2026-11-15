import type { CommandAST, ControllerState, Draft, ExecutionRequest, GeometryAdapter, GeometryMesh, SceneDocument, Solid, Vec3 } from '../shared/types';
import { MAX_SOLIDS, MAX_SCALE, MIN_SCALE, validateCommand, validateDocument, validatePosition } from './validation';

const copy = <T>(value: T): T => structuredClone(value);
const emptyScene = (): SceneDocument => ({ schemaVersion: 1, units: 'mm', revision: 0, solids: [], commands: [] });
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
interface Snapshot { scene: SceneDocument; selectedId: string | null }

export class Controller {
  state: ControllerState = { scene: emptyScene(), draft: null, selectedId: null, busy: false, paused: false, message: 'Create a box to begin.', lastCommand: null, historyCount: 0 };
  readonly meshes = new Map<string, GeometryMesh>();
  private listeners = new Set<(state: ControllerState) => void>();
  private history: Snapshot[] = [];
  private generation = 0;
  private draftRevision = 0;
  constructor(private readonly geometry: GeometryAdapter) {}
  subscribe(listener: (state: ControllerState) => void): () => void { this.listeners.add(listener); listener(this.state); return () => this.listeners.delete(listener); }
  private emit(): void { this.state.historyCount = this.history.length; for (const listener of this.listeners) listener(this.state); }
  private ready(): boolean {
    if (this.state.busy) return false;
    if (this.state.paused) { this.state.message = 'Editing is paused. Resume to continue.'; this.emit(); return false; }
    return true;
  }
  private canBegin(): boolean {
    if (!this.ready()) return false;
    if (this.state.draft) { this.state.message = 'Commit or cancel the current draft first.'; this.emit(); return false; }
    return true;
  }
  private selected(): Solid | undefined { return this.state.scene.solids.find(solid => solid.id === this.state.selectedId); }
  private start(draft: Draft, message: string): void { this.state.draft = draft; this.draftRevision = this.state.scene.revision; this.state.message = message; this.emit(); }
  beginCreate(primitive: 'Box' | 'Cylinder'): void {
    if (!this.canBegin()) return;
    if (this.state.scene.solids.length >= MAX_SOLIDS) { this.state.message = 'The demo supports 10 visible solids. Undo or reset to free space.'; this.emit(); return; }
    const number = this.state.scene.commands.filter(command => command.ast.type === 'Create' && command.ast.primitive === primitive).length + 1;
    const solid: Solid = { id: id(primitive.toLowerCase()), name: `${primitive} ${number}`, recipe: primitive === 'Box' ? { kind: 'box', dimensions: [20,20,20] } : { kind: 'cylinder', radius: 5, height: 60, segments: 32 }, position: [0,0,0], scale: 1, color: primitive === 'Box' ? '#b8d7b3' : '#e5a96d' };
    this.start({ kind: 'create', solid }, `${primitive} preview ready. Commit to create it, or cancel.`);
  }
  beginMove(): void { if (!this.canBegin()) return; const solid = this.selected(); if (!solid) return this.notify('Select a solid before moving.'); this.start({ kind:'move', targetId:solid.id, position:[...solid.position] }, 'Pinch and drag the selected solid. Release freezes the preview.'); }
  beginScale(): void { if (!this.canBegin()) return; const solid = this.selected(); if (!solid) return this.notify('Select a solid before scaling.'); this.start({ kind:'scale', targetId:solid.id, uniformScale:solid.scale }, 'Pinch both hands and change their separation. Commit when ready.'); }
  beginSubtract(): void { if (!this.canBegin()) return; const solid = this.selected(); if (!solid) return this.notify('Select the target solid first.'); if (this.state.scene.solids.length < 2) return this.notify('Create a second solid to use as a cutter.'); this.start({ kind:'subtract', targetId:solid.id, cutterId:null, resultId:id('difference') }, `Target: ${solid.name}. Select a different solid as the cutter.`); }
  select(solidId: string): void { if (!this.ready() || this.state.draft || solidId === this.state.selectedId) return; const solid = this.state.scene.solids.find(s => s.id === solidId); if (!solid) return; this.state.selectedId = solidId; this.notify(`${solid.name} selected.`); }
  chooseCutter(solidId: string): void { if (!this.ready() || this.state.draft?.kind !== 'subtract') return; const draft=this.state.draft; if (draft.cutterId === solidId) return; if (solidId === draft.targetId) return this.notify('Choose a different solid as cutter.'); const cutter=this.state.scene.solids.find(s=>s.id===solidId); if (!cutter) return; draft.cutterId=solidId; const target=this.state.scene.solids.find(s=>s.id===draft.targetId); this.notify(`Preview: ${target?.name} − ${cutter.name}. Commit to subtract.`); }
  updateMove(position: Vec3): void {
    if (!this.ready() || this.state.draft?.kind !== 'move') return;
    try {
      validatePosition(position);
      const snapped = position.map(n => Math.round(n)) as Vec3;
      const previous = this.state.draft.position;
      if (snapped.every((value, axis) => value === previous[axis])) return;
      this.state.draft.position = snapped;
      this.emit();
    } catch { /* Ignore invalid tracking samples. */ }
  }
  updateScale(value: number): void {
    if (!this.ready() || this.state.draft?.kind !== 'scale' || !Number.isFinite(value)) return;
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
    if (Math.abs(scale - this.state.draft.uniformScale) <= 1e-6) return;
    this.state.draft.uniformScale = scale;
    this.emit();
  }
  private astForDraft(draft: Draft): CommandAST {
    switch(draft.kind) {
      case 'create': return { type:'Create', objectId:draft.solid.id, primitive:draft.solid.recipe.kind==='box'?'Box':'Cylinder', dimensions:draft.solid.recipe.kind==='box'?[...draft.solid.recipe.dimensions]:draft.solid.recipe.kind==='cylinder'?[draft.solid.recipe.radius,draft.solid.recipe.height]:[], position:[...draft.solid.position] };
      case 'move': return { type:'Move', targetId:draft.targetId, position:[...draft.position] };
      case 'scale': return { type:'Scale', targetId:draft.targetId, uniformScale:draft.uniformScale };
      case 'subtract': if (!draft.cutterId) throw new Error('Select a cutter before committing.'); return { type:'Subtract', targetId:draft.targetId, cutterId:draft.cutterId, resultId:draft.resultId };
    }
  }
  getDraftAST(): CommandAST | null { if (!this.state.draft) return null; try { return this.astForDraft(this.state.draft); } catch { return null; } }
  async commit(source: ExecutionRequest['source'] = 'pointer'): Promise<boolean> {
    if (!this.ready() || !this.state.draft) return false;
    const draft=copy(this.state.draft); let request: ExecutionRequest;
    try { request={ commandId:id('cmd'), baseSceneRevision:this.draftRevision, source, ast:this.astForDraft(draft) }; validateCommand(request,this.state.scene); }
    catch(error) { this.notify(error instanceof Error?error.message:'Invalid command.'); return false; }
    const snapshot: Snapshot={scene:copy(this.state.scene),selectedId:this.state.selectedId};
    const next=copy(this.state.scene); const job=++this.generation; this.state.busy=true; this.notify('Compiling and executing command…');
    let nextSelected=this.state.selectedId; let mesh: GeometryMesh|undefined; let meshId:string|undefined;
    try {
      if(draft.kind==='create') { mesh=await this.geometry.build(draft.solid.recipe); meshId=draft.solid.id; next.solids.push(draft.solid); nextSelected=draft.solid.id; }
      else if(draft.kind==='move') { next.solids.find(s=>s.id===draft.targetId)!.position=[...draft.position]; }
      else if(draft.kind==='scale') { next.solids.find(s=>s.id===draft.targetId)!.scale=draft.uniformScale; }
      else { const target=copy(next.solids.find(s=>s.id===draft.targetId)!); const cutter=copy(next.solids.find(s=>s.id===draft.cutterId)!); const result: Solid={ id:draft.resultId, name:`${target.name} − ${cutter.name}`, color:target.color, position:[0,0,0], scale:1, recipe:{kind:'subtract',target,cutter} }; mesh=await this.geometry.build(result.recipe); meshId=result.id; next.solids=next.solids.filter(s=>s.id!==target.id&&s.id!==cutter.id); next.solids.push(result); nextSelected=result.id; }
      if(job!==this.generation) return false;
      if(mesh && (!Number.isFinite(mesh.volume)||mesh.volume<=1e-6||mesh.indices.length===0)) throw new Error('The operation produced an empty solid. Move the cutter and try again.');
      next.revision++; next.commands.push(request); this.history.push(snapshot); if(this.history.length>20) this.history.shift();
      if(mesh&&meshId) this.meshes.set(meshId,mesh);
      this.state.scene=next; this.state.selectedId=nextSelected; this.state.lastCommand=request; this.state.draft=null; this.state.busy=false; this.pruneMeshes(); this.notify(`${request.ast.type} committed. The scene is saved locally.`); return true;
    } catch(error) { if(job!==this.generation) return false; this.state.busy=false; this.notify(error instanceof Error?error.message:'Geometry execution failed. Previous scene preserved.'); return false; }
  }
  cancel(): void { if(this.state.busy) return; this.state.draft=null; this.notify('Draft cancelled. Committed scene preserved.'); }
  undo(): void { if(!this.ready()) return; if(this.state.draft) return this.notify('Cancel or commit the draft before Undo.'); const previous=this.history.pop(); if(!previous) return this.notify('Nothing to undo.'); const revision=this.state.scene.revision+1; this.state.scene=copy(previous.scene); this.state.scene.revision=revision; this.state.selectedId=previous.selectedId; this.state.lastCommand=this.state.scene.commands.at(-1)??null; this.pruneMeshes(); this.notify('Undo restored the previous scene.'); }
  setPaused(paused: boolean): void { this.state.paused=paused; this.notify(paused?'Editing paused. Resume when ready.':'Editing resumed.'); }
  reset(): void { ++this.generation; this.state={scene:emptyScene(),draft:null,selectedId:null,busy:false,paused:false,message:'Workspace reset. Create a box to begin.',lastCommand:null,historyCount:0}; this.history=[]; this.meshes.clear(); this.emit(); }
  async restore(document: SceneDocument): Promise<boolean> {
    if(this.state.busy) return false;
    try { validateDocument(document); } catch(error) { this.notify(error instanceof Error?error.message:'Saved project is invalid.'); return false; }
    const job=++this.generation; this.state.busy=true; this.notify('Restoring local project…');
    try { const saved=copy(document); const meshes=await Promise.all(saved.solids.map(async solid=>[solid.id,await this.geometry.build(solid.recipe)] as const)); if(job!==this.generation) return false; this.meshes.clear(); meshes.forEach(([solidId,mesh])=>this.meshes.set(solidId,mesh)); this.history=[]; this.state.scene=saved; this.state.selectedId=saved.solids.at(-1)?.id??null; this.state.draft=null; this.state.lastCommand=saved.commands.at(-1)??null; this.state.busy=false; this.notify('Local project restored.'); return true; }
    catch(error) { if(job!==this.generation) return false; this.state.busy=false; this.notify(`Could not restore project: ${error instanceof Error?error.message:'geometry error'}`); return false; }
  }
  exportDocument(): SceneDocument { return copy(this.state.scene); }
  private pruneMeshes(): void { const retained=new Set(this.state.scene.solids.map(s=>s.id)); for(const snapshot of this.history) for(const solid of snapshot.scene.solids) retained.add(solid.id); for(const meshId of this.meshes.keys()) if(!retained.has(meshId)) this.meshes.delete(meshId); }
  private notify(message:string): void { this.state.message=message; this.emit(); }
}
