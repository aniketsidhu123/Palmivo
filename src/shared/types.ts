export type Vec3 = [number, number, number];
export type SolidRecipe =
  | { kind: 'box'; dimensions: Vec3 }
  | { kind: 'cylinder'; radius: number; height: number; segments: number }
  | { kind: 'subtract'; target: Solid; cutter: Solid };
export interface Solid { id: string; name: string; recipe: SolidRecipe; position: Vec3; scale: number; color: string }
export type CommandAST =
  | { type: 'Create'; objectId: string; primitive: 'Box' | 'Cylinder'; dimensions: number[]; position: Vec3 }
  | { type: 'Move'; targetId: string; position: Vec3 }
  | { type: 'Scale'; targetId: string; uniformScale: number }
  | { type: 'Subtract'; targetId: string; cutterId: string; resultId: string };
export interface ExecutionRequest { commandId: string; baseSceneRevision: number; source: 'gesture-rules' | 'pointer' | 'keyboard'; ast: CommandAST }
export interface SceneDocument { schemaVersion: 1; units: 'mm'; revision: number; solids: Solid[]; commands: ExecutionRequest[] }
export interface GeometryMesh { positions: Float32Array; indices: Uint32Array; normals?: Float32Array; volume: number }
export interface GeometryAdapter { build(recipe: SolidRecipe): Promise<GeometryMesh>; dispose?(): void }
export type Draft =
  | { kind: 'create'; solid: Solid }
  | { kind: 'move'; targetId: string; position: Vec3 }
  | { kind: 'scale'; targetId: string; uniformScale: number }
  | { kind: 'subtract'; targetId: string; cutterId: string | null; resultId: string };
export interface ControllerState { scene: SceneDocument; draft: Draft | null; selectedId: string | null; busy: boolean; paused: boolean; message: string; lastCommand: ExecutionRequest | null; historyCount: number }
export type Tool = 'box' | 'cylinder' | 'select' | 'move' | 'scale' | 'subtract' | 'undo' | 'commit' | 'cancel' | 'pause';
export interface Landmark { x: number; y: number; z: number }
export interface TrackedHand { handedness: 'Left' | 'Right'; score: number; landmarks: Landmark[] }
export interface TrackingFrame { timestamp: number; width: number; height: number; hands: TrackedHand[]; inferenceMs: number }
export interface CalibrationProfile { dominantHand: 'Left' | 'Right'; minX: number; maxX: number; minY: number; maxY: number; pinchClose: number; pinchOpen: number }
export interface GestureOutput { timestamp: number; cursor: { x: number; y: number } | null; dominantPinched: boolean; otherPinched: boolean; pinchStarted: boolean; pinchReleased: boolean; toolbarArmed: boolean; bothPinched: boolean; separation: number; trackingReady: boolean; trackingLost: boolean; otherOpen: boolean; dominantRatio?: number; otherRatio?: number; pinchClosing?: boolean; pinchOpening?: boolean; otherPinchOpening?: boolean; rawCursor?: { x: number; y: number } }
