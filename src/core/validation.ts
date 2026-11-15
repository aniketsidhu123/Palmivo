import type { CommandAST, ExecutionRequest, SceneDocument, Solid, SolidRecipe, Vec3 } from '../shared/types';

export const MAX_SOLIDS = 10;
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 2;
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
export function validatePosition(value: unknown): asserts value is Vec3 {
  assert(Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 500), 'Position must contain three finite values within ±500 mm.');
}
export function validateScale(value: unknown): asserts value is number {
  assert(typeof value === 'number' && Number.isFinite(value) && value >= MIN_SCALE && value <= MAX_SCALE, 'Uniform scale must be between 0.5 and 2.0.');
}
function validateRecipe(recipe: SolidRecipe, depth = 0): void {
  assert(recipe && typeof recipe === 'object' && depth < 32, 'Invalid or excessively nested solid recipe.');
  switch (recipe.kind) {
    case 'box':
      assert(Array.isArray(recipe.dimensions) && recipe.dimensions.length === 3 && recipe.dimensions.every(n => Number.isFinite(n) && n > 0 && n <= 300), 'Box dimensions must be positive and at most 300 mm.');
      break;
    case 'cylinder':
      assert(Number.isFinite(recipe.radius) && recipe.radius > 0 && recipe.radius <= 150 && Number.isFinite(recipe.height) && recipe.height > 0 && recipe.height <= 300, 'Invalid cylinder dimensions.');
      assert(Number.isInteger(recipe.segments) && recipe.segments >= 8 && recipe.segments <= 128, 'Invalid cylinder resolution.');
      break;
    case 'subtract': validateSolid(recipe.target, depth + 1); validateSolid(recipe.cutter, depth + 1); break;
    default: throw new Error('Unknown solid recipe.');
  }
}
function validateSolid(solid: Solid, depth = 0): void {
  assert(solid && typeof solid.id === 'string' && solid.id.length > 0 && solid.id.length <= 128, 'Invalid solid ID.');
  assert(typeof solid.name === 'string' && solid.name.length <= 128, 'Invalid solid label.');
  assert(typeof solid.color === 'string' && /^#[0-9a-f]{6}$/i.test(solid.color), 'Invalid solid color.');
  validatePosition(solid.position); validateScale(solid.scale); validateRecipe(solid.recipe, depth);
}
export function validateDocument(document: SceneDocument): void {
  assert(document && document.schemaVersion === 1 && document.units === 'mm', 'Unsupported project format.');
  assert(Number.isSafeInteger(document.revision) && document.revision >= 0, 'Invalid scene revision.');
  assert(Array.isArray(document.solids) && document.solids.length <= MAX_SOLIDS, 'A project can contain at most 10 visible solids.');
  assert(Array.isArray(document.commands) && document.commands.length <= 10000, 'Invalid command history.');
  const ids = new Set<string>();
  for (const solid of document.solids) { validateSolid(solid); assert(!ids.has(solid.id), 'Duplicate solid IDs.'); ids.add(solid.id); }
  const commandIds = new Set<string>();
  for (const command of document.commands) {
    assert(command && typeof command.commandId === 'string' && !commandIds.has(command.commandId), 'Duplicate or invalid command ID.');
    assert(command.ast && ['Create', 'Move', 'Scale', 'Subtract'].includes(command.ast.type), 'Invalid saved command.');
    commandIds.add(command.commandId);
  }
}
export function validateCommand(request: ExecutionRequest, document: SceneDocument): void {
  assert(request && typeof request.commandId === 'string' && request.commandId.length > 0, 'A command ID is required.');
  assert(request.baseSceneRevision === document.revision, 'The scene changed. Start this command again.');
  assert(!document.commands.some(command => command.commandId === request.commandId), 'This command has already executed.');
  const ast: CommandAST = request.ast;
  assert(ast && typeof ast === 'object', 'Incomplete command.');
  const exists = (id: string) => document.solids.some(solid => solid.id === id);
  switch (ast.type) {
    case 'Create':
      assert(document.solids.length < MAX_SOLIDS, 'The demo supports at most 10 visible solids.');
      assert(typeof ast.objectId === 'string' && ast.objectId.length > 0 && !exists(ast.objectId), 'Invalid or duplicate object ID.');
      assert(ast.primitive === 'Box' || ast.primitive === 'Cylinder', 'Unknown primitive.');
      assert(Array.isArray(ast.dimensions) && ast.dimensions.length === (ast.primitive === 'Box' ? 3 : 2) && ast.dimensions.every(n => Number.isFinite(n) && n > 0 && n <= 300), 'Incomplete primitive dimensions.');
      validatePosition(ast.position); break;
    case 'Move': assert(exists(ast.targetId), 'The selected object no longer exists.'); validatePosition(ast.position); break;
    case 'Scale': assert(exists(ast.targetId), 'The selected object no longer exists.'); validateScale(ast.uniformScale); break;
    case 'Subtract':
      assert(exists(ast.targetId) && exists(ast.cutterId), 'Select both a target and a cutter.');
      assert(ast.targetId !== ast.cutterId, 'The cutter must be a different solid.');
      assert(typeof ast.resultId === 'string' && ast.resultId.length > 0 && !exists(ast.resultId), 'Invalid result ID.');
      break;
    default: throw new Error('Unknown command.');
  }
}
