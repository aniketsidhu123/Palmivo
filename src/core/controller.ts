import type { CommandAST, ControllerState, Draft, ExecutionRequest, GeometryAdapter, GeometryMesh, Primitive, SceneDocument, Solid, Vec3 } from '../shared/types';
import { MAX_SOLIDS, MAX_SCALE, MIN_SCALE, validateCommand, validateDocument, validatePosition } from './validation';
import { getSizePreset } from './presets';
import type { ImportedMesh, MeshAsset, SolidRecipe } from '../shared/types';
import { validateAssetEnvelope, verifyAssetId } from './meshAsset';
import { checkExportableSize } from './projectFile';
import { DEFAULT_IMPORT_COLOR, rgbToHex } from './meshColors';

const copy = <T>(value: T): T => structuredClone(value);
const emptyScene = (): SceneDocument => ({ schemaVersion: 1, units: 'mm', revision: 0, solids: [], commands: [] });
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
interface Snapshot { scene: SceneDocument; selectedId: string | null }

function copyScene(scene: SceneDocument): SceneDocument {
  const { assets, ...metadata } = scene;
  const result: SceneDocument = copy(metadata);
  if (assets) result.assets = [...assets];
  return result;
}

function requiredAssets(recipe: SolidRecipe, assets: readonly MeshAsset[] = []): MeshAsset[] {
  if (!assets.length) return [];
  const ids = new Set<string>();
  function visit(node: SolidRecipe): void {
    if (node.kind === 'mesh') ids.add(node.assetId);
    if (node.kind === 'subtract' || node.kind === 'union') {
      visit(node.target.recipe);
      visit(node.kind === 'union' ? node.other.recipe : node.cutter.recipe);
    }
  }
  visit(recipe);
  return assets.filter(asset => ids.has(asset.id));
}

export class Controller {
  state: ControllerState = { scene: emptyScene(), draft: null, selectedId: null, busy: false, paused: false, message: 'Create a box to begin.', lastCommand: null, historyCount: 0 };
  readonly meshes = new Map<string, GeometryMesh>();
  private listeners = new Set<(state: ControllerState) => void>();
  private history: Snapshot[] = [];
  private generation = 0;
  private draftRevision = 0;
  private pendingAsset: MeshAsset | null = null;
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
  beginCreate(primitive: Primitive): void {
    if (!this.canBegin()) return;
    if (this.state.scene.solids.length >= MAX_SOLIDS) { this.state.message = 'The demo supports 10 visible solids. Undo or reset to free space.'; this.emit(); return; }
    const number = this.state.scene.commands.filter(command => command.ast.type === 'Create' && command.ast.primitive === primitive).length + 1;
    const recipes: Record<Primitive, Solid['recipe']> = {
      Box: { kind: 'box', dimensions: [20,20,20] }, Cylinder: { kind: 'cylinder', radius: 5, height: 60, segments: 32 },
      Sphere: { kind: 'sphere', radius: 10, segments: 32 }, Cone: { kind: 'cone', radius: 10, height: 20, segments: 32 },
      Pyramid: { kind: 'pyramid', base: 20, height: 20 },
    };
    const colors: Record<Primitive, string> = { Box: '#b8d7b3', Cylinder: '#e5a96d', Sphere: '#84b8ee', Cone: '#d9ad86', Pyramid: '#b9a7dd' };
    const solid: Solid = { id: id(primitive.toLowerCase()), name: `${primitive === 'Pyramid' ? 'Square pyramid' : primitive} ${number}`, recipe: recipes[primitive], position: [0,0,0], scale: 1, color: colors[primitive] };
    this.start({ kind: 'create', solid }, `${primitive} preview ready. Commit to create it, or cancel.`);
  }
  beginImport(filename: string, imported: ImportedMesh): boolean {
    if (!this.canBegin()) return false;
    if (this.state.scene.solids.length >= MAX_SOLIDS) { this.notify('The workspace already has 10 visible solids.'); return false; }
    try { validateAssetEnvelope(imported.asset); }
    catch (error) { this.notify(error instanceof Error ? error.message : 'Invalid imported mesh.'); return false; }
    const label = filename.replace(/\.(?:stl|obj)$/i, '').replace(/[^\p{L}\p{N} _().-]/gu, '_').trim().slice(0, 120) || 'Imported solid';
    const color = imported.mesh.colors ? rgbToHex(imported.mesh.colors) : DEFAULT_IMPORT_COLOR;
    const solid: Extract<Draft, { kind: 'import' }>['solid'] = { id: id('import'), name: label, recipe: { kind: 'mesh', assetId: imported.asset.id }, position: [0, 0, 0], scale: 1, color };
    this.pendingAsset = Object.freeze({ ...imported.asset });
    this.meshes.set(solid.id, imported.mesh);
    this.start({ kind: 'import', solid }, `Previewing ${solid.name}. Commit to add the imported solid or Cancel to discard it.`);
    return true;
  }
  applyImportColor(value: string): boolean {
    const draft = this.state.draft;
    if (this.state.busy || this.state.paused || draft?.kind !== 'import' ||
        this.meshes.get(draft.solid.id)?.colors || !/^#[0-9a-f]{6}$/i.test(value)) return false;
    const color = value.toLowerCase();
    if (draft.solid.color === color) return false;
    this.state.draft = { ...draft, solid: { ...draft.solid, color } };
    this.notify('Body colour updated. Choose Commit to add the solid.');
    return true;
  }
  applySizePreset(key: string): boolean {
    const draft = this.state.draft;
    if (this.state.busy || this.state.paused || draft?.kind !== 'create') return false;
    const preset = getSizePreset(key);
    if (!preset) return false;
    const recipe = draft.solid.recipe;
    let nextRecipe: Solid['recipe'];
    if (recipe.kind === 'box' && preset.primitive === 'Box') {
      const axis = { x: 0, y: 1, z: 2 }[preset.field];
      if (recipe.dimensions[axis] === preset.value) return false;
      const dimensions: Vec3 = [...recipe.dimensions];
      dimensions[axis] = preset.value;
      nextRecipe = { ...recipe, dimensions };
    } else if (recipe.kind === 'cylinder' && preset.primitive === 'Cylinder') {
      if (recipe[preset.field] === preset.value) return false;
      nextRecipe = { ...recipe, [preset.field]: preset.value };
    } else if (recipe.kind === 'sphere' && preset.primitive === 'Sphere') {
      if (recipe.radius === preset.value) return false;
      nextRecipe = { ...recipe, radius: preset.value };
    } else if (recipe.kind === 'cone' && preset.primitive === 'Cone') {
      if (recipe[preset.field] === preset.value) return false;
      nextRecipe = { ...recipe, [preset.field]: preset.value };
    } else if (recipe.kind === 'pyramid' && preset.primitive === 'Pyramid') {
      if (recipe[preset.field] === preset.value) return false;
      nextRecipe = { ...recipe, [preset.field]: preset.value };
    } else return false;
    // New identities invalidate the native preview geometry and structural UI key.
    // The object ID, spatial placement, and committed document remain unchanged.
    this.state.draft = { ...draft, solid: { ...draft.solid, recipe: nextRecipe } };
    this.notify(`${preset.primitive} size updated: ${preset.label}. Commit to create it.`);
    return true;
  }
  beginMove(): void { if (!this.canBegin()) return; const solid = this.selected(); if (!solid) return this.notify('Select a solid before moving.'); this.start({ kind:'move', targetId:solid.id, position:[...solid.position] }, 'Pinch and drag the selected solid. Release freezes the preview.'); }
  beginScale(): void { if (!this.canBegin()) return; const solid = this.selected(); if (!solid) return this.notify('Select a solid before scaling.'); this.start({ kind:'scale', targetId:solid.id, uniformScale:solid.scale }, 'Pinch both hands and change their separation. Commit when ready.'); }
  beginSubtract(): void { if (!this.canBegin()) return; const solid = this.selected(); if (!solid) return this.notify('Select the target solid first.'); if (this.state.scene.solids.length < 2) return this.notify('Create a second solid to use as a cutter.'); this.start({ kind:'subtract', targetId:solid.id, cutterId:null, resultId:id('difference') }, `Target: ${solid.name}. Select a different solid as the cutter.`); }
  beginUnion(): void {
    if (!this.canBegin()) return;
    const solid = this.selected();
    if (!solid) return this.notify('Select the first solid to join.');
    if (this.state.scene.solids.length < 2) return this.notify('Create a second solid to join.');
    this.start({ kind: 'union', targetId: solid.id, otherId: null, resultId: id('union') }, `First solid: ${solid.name}. Select the second solid to join.`);
  }
  select(solidId: string): void { if (!this.ready() || this.state.draft || solidId === this.state.selectedId) return; const solid = this.state.scene.solids.find(s => s.id === solidId); if (!solid) return; this.state.selectedId = solidId; this.notify(`${solid.name} selected.`); }
  chooseCutter(solidId: string): void { if (!this.ready() || this.state.draft?.kind !== 'subtract') return; const draft=this.state.draft; if (draft.cutterId === solidId) return; if (solidId === draft.targetId) return this.notify('Choose a different solid as cutter.'); const cutter=this.state.scene.solids.find(s=>s.id===solidId); if (!cutter) return; draft.cutterId=solidId; const target=this.state.scene.solids.find(s=>s.id===draft.targetId); this.notify(`Preview: ${target?.name} − ${cutter.name}. Commit to subtract.`); }
  chooseUnionOperand(solidId: string): void {
    if (!this.ready() || this.state.draft?.kind !== 'union') return;
    const draft = this.state.draft;
    if (draft.otherId === solidId) return;
    if (draft.targetId === solidId) return this.notify('Choose a different solid to join.');
    const other = this.state.scene.solids.find(solid => solid.id === solidId);
    if (!other) return;
    draft.otherId = solidId;
    const target = this.state.scene.solids.find(solid => solid.id === draft.targetId);
    this.notify(`Preview: ${target?.name} + ${other.name}. Commit to join.`);
  }
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
      case 'import':
        return { type: 'ImportMesh', objectId: draft.solid.id, assetId: draft.solid.recipe.assetId };
      case 'create': {
        const recipe = draft.solid.recipe;
        const shape = recipe.kind === 'box' ? { primitive: 'Box' as const, dimensions: [...recipe.dimensions] }
          : recipe.kind === 'cylinder' ? { primitive: 'Cylinder' as const, dimensions: [recipe.radius, recipe.height] }
          : recipe.kind === 'sphere' ? { primitive: 'Sphere' as const, dimensions: [recipe.radius] }
          : recipe.kind === 'cone' ? { primitive: 'Cone' as const, dimensions: [recipe.radius, recipe.height] }
          : recipe.kind === 'pyramid' ? { primitive: 'Pyramid' as const, dimensions: [recipe.base, recipe.height] } : null;
        if (!shape) throw new Error('Unsupported primitive creation draft.');
        return { type: 'Create', objectId: draft.solid.id, ...shape, position: [...draft.solid.position] };
      }
      case 'move': return { type:'Move', targetId:draft.targetId, position:[...draft.position] };
      case 'scale': return { type:'Scale', targetId:draft.targetId, uniformScale:draft.uniformScale };
      case 'subtract': if (!draft.cutterId) throw new Error('Select a cutter before committing.'); return { type:'Subtract', targetId:draft.targetId, cutterId:draft.cutterId, resultId:draft.resultId };
      case 'union':
        if (!draft.otherId) throw new Error('Select a second solid before committing.');
        return { type: 'Union', targetId: draft.targetId, otherId: draft.otherId, resultId: draft.resultId };
    }
  }
  getDraftAST(): CommandAST | null { if (!this.state.draft) return null; try { return this.astForDraft(this.state.draft); } catch { return null; } }
  async commit(source: ExecutionRequest['source'] = 'pointer'): Promise<boolean> {
    if (!this.ready() || !this.state.draft) return false;
    const draft=copy(this.state.draft); let request: ExecutionRequest;
    try { request={ commandId:id('cmd'), baseSceneRevision:this.draftRevision, source, ast:this.astForDraft(draft) }; validateCommand(request,this.state.scene); }
    catch(error) { this.notify(error instanceof Error?error.message:'Invalid command.'); return false; }
    const snapshot: Snapshot={scene:copyScene(this.state.scene),selectedId:this.state.selectedId};
    const next=copyScene(this.state.scene); const job=++this.generation; this.state.busy=true; this.notify('Compiling and executing command…');
    let nextSelected=this.state.selectedId; let mesh: GeometryMesh|undefined; let meshId:string|undefined;
    try {
      if(draft.kind==='create') { mesh=await this.geometry.build(draft.solid.recipe); meshId=draft.solid.id; next.solids.push(draft.solid); nextSelected=draft.solid.id; }
      else if (draft.kind === 'import') {
        const asset = this.pendingAsset;
        mesh = this.meshes.get(draft.solid.id);
        if (!mesh || !asset || draft.solid.recipe.kind !== 'mesh' || draft.solid.recipe.assetId !== asset.id) throw Error('The imported preview is unavailable. Reopen the mesh.');
        next.assets ??= [];
        if (!next.assets.some(item => item.id === asset.id)) next.assets.push(asset);
        next.schemaVersion = 3;
        next.solids.push(draft.solid);
        meshId = nextSelected = draft.solid.id;
      }
      else if(draft.kind==='move') { next.solids.find(s=>s.id===draft.targetId)!.position=[...draft.position]; }
      else if(draft.kind==='scale') { next.solids.find(s=>s.id===draft.targetId)!.scale=draft.uniformScale; }
      else {
        const isUnion = draft.kind === 'union';
        const secondId = isUnion ? draft.otherId : draft.cutterId;
        const target = next.solids.find(solid => solid.id === draft.targetId)!;
        const second = next.solids.find(solid => solid.id === secondId)!;
        const result: Solid = {
          id: draft.resultId, name: `${target.name} ${isUnion ? '+' : '−'} ${second.name}`.slice(0, 128),
          color: target.color, position: [0, 0, 0], scale: 1,
          recipe: isUnion ? { kind: 'union', target, other: second } : { kind: 'subtract', target, cutter: second },
        };
        mesh = await this.build(result.recipe, next.assets);
        meshId = result.id;
        next.solids = next.solids.filter(solid => solid.id !== target.id && solid.id !== second.id);
        next.solids.push(result);
        nextSelected = result.id;
        if (isUnion && next.schemaVersion === 1) next.schemaVersion = 2;
      }
      if(job!==this.generation) return false;
      if(mesh && (!Number.isFinite(mesh.volume)||mesh.volume<=1e-6||mesh.indices.length===0)) throw new Error('The operation produced an empty solid. Check the input solids and try again.');
      if (draft.kind === 'create' && ['sphere', 'cone', 'pyramid'].includes(draft.solid.recipe.kind)) next.schemaVersion = 3;
      next.revision++; next.commands.push(request);
      checkExportableSize(next);
      this.history.push(snapshot); if(this.history.length>20) this.history.shift();
      this.pendingAsset = null;
      if(mesh&&meshId) this.meshes.set(meshId,mesh);
      this.state.scene=next; this.state.selectedId=nextSelected; this.state.lastCommand=request; this.state.draft=null; this.state.busy=false; this.pruneMeshes(); this.notify(`${request.ast.type} committed.`); return true;
    } catch(error) { if(job!==this.generation) return false; this.state.busy=false; this.notify(error instanceof Error?error.message:'Geometry execution failed. Previous scene preserved.'); return false; }
  }
  cancel(): void { if(this.state.busy) return; this.pendingAsset=null; this.state.draft=null; this.pruneMeshes(); this.notify('Draft cancelled. Committed scene preserved.'); }
  undo(): void { if(!this.ready()) return; if(this.state.draft) return this.notify('Cancel or commit the draft before Undo.'); const previous=this.history.pop(); if(!previous) return this.notify('Nothing to undo.'); const revision=this.state.scene.revision+1; this.state.scene=copyScene(previous.scene); this.state.scene.revision=revision; this.state.selectedId=previous.selectedId; this.state.lastCommand=this.state.scene.commands.at(-1)??null; this.pruneMeshes(); this.notify('Undo restored the previous scene.'); }
  setPaused(paused: boolean): void { this.state.paused=paused; this.notify(paused?'Editing paused. Resume when ready.':'Editing resumed.'); }
  reset(): void { ++this.generation; this.pendingAsset=null; this.state={scene:emptyScene(),draft:null,selectedId:null,busy:false,paused:false,message:'Workspace reset. Create a box to begin.',lastCommand:null,historyCount:0}; this.history=[]; this.meshes.clear(); this.emit(); }
  async restore(document: SceneDocument): Promise<boolean> {
    if(this.state.busy) return false;
    try { validateDocument(document); } catch(error) { this.notify(error instanceof Error?error.message:'Saved project is invalid.'); return false; }
    const job=++this.generation; this.state.busy=true; this.notify('Restoring local project…');
    try {
      const saved = copyScene(document);
      if (saved.assets?.length) {
        saved.assets = saved.assets.map(asset => Object.freeze({ ...asset }));
        checkExportableSize(saved);
        await Promise.all(saved.assets.map(verifyAssetId));
      }
      // Start a geometry watchdog only when the worker is available for this solid.
      const meshes = new Map<string, GeometryMesh>();
      for (const solid of saved.solids) {
        if (job !== this.generation) return false;
        meshes.set(solid.id, await this.build(solid.recipe, saved.assets));
      }
      if (job !== this.generation) return false;
      this.meshes.clear(); meshes.forEach((mesh, solidId) => this.meshes.set(solidId, mesh));
      this.history=[]; this.pendingAsset=null; this.state.scene=saved; this.state.selectedId=saved.solids.at(-1)?.id??null; this.state.draft=null; this.state.lastCommand=saved.commands.at(-1)??null; this.state.busy=false; this.notify('Local project restored.'); return true;
    }
    catch(error) { if(job!==this.generation) return false; this.state.busy=false; this.notify(`Could not restore project: ${error instanceof Error?error.message:'geometry error'}`); return false; }
  }
  exportDocument(): SceneDocument {
    const document = copyScene(this.state.scene);
    if (document.assets) document.assets = document.assets.map(asset => ({ ...asset }));
    return document;
  }
  private build(recipe: SolidRecipe, assets?: readonly MeshAsset[]): Promise<GeometryMesh> {
    const required = requiredAssets(recipe, assets);
    return required.length ? this.geometry.build(recipe, required) : this.geometry.build(recipe);
  }
  private pruneMeshes(): void { const retained=new Set(this.state.scene.solids.map(s=>s.id)); for(const snapshot of this.history) for(const solid of snapshot.scene.solids) retained.add(solid.id); for(const meshId of this.meshes.keys()) if(!retained.has(meshId)) this.meshes.delete(meshId); }
  private notify(message:string): void { this.state.message=message; this.emit(); }
}
