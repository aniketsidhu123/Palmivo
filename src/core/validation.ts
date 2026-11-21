import type { CommandAST, ExecutionRequest, SceneDocument, Vec3 } from '../shared/types';
import { MAX_PROJECT_FILE_BYTES, validateAssetEnvelope } from './meshAsset';

export const MAX_SOLIDS = 10;
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 2;
export const MAX_RECIPE_NODES = 2048;
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function record(value: unknown, message: string): asserts value is Record<string, unknown> {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), message);
}
function fields(value: Record<string, unknown>, names: string[], label: string): void {
  assert(Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)), `Invalid ${label} fields.`);
}
function positive(value: unknown, maximum: number): boolean { return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= maximum; }
function identifier(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && value.length > 0 && value.length <= 128, `Invalid ${label} ID.`);
}
export function validatePosition(value: unknown): asserts value is Vec3 {
  assert(Array.isArray(value) && value.length === 3 && [...value].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 500), 'Position must contain three finite values within ±500 mm.');
}
export function validateScale(value: unknown): asserts value is number {
  assert(typeof value === 'number' && Number.isFinite(value) && value >= MIN_SCALE && value <= MAX_SCALE, 'Uniform scale must be between 0.5 and 2.0.');
}
function validatePrimitiveDimensions(primitive: unknown, dimensions: unknown, schemaVersion?: SceneDocument['schemaVersion']): void {
  assert(typeof primitive === 'string' && ['Box', 'Cylinder', 'Sphere', 'Cone', 'Pyramid'].includes(primitive), 'Unknown primitive.');
  if (['Sphere', 'Cone', 'Pyramid'].includes(primitive) && schemaVersion !== undefined) assert(schemaVersion === 3, 'These primitives require a Palmivo version 3 project.');
  const length = primitive === 'Box' ? 3 : primitive === 'Sphere' ? 1 : 2;
  assert(Array.isArray(dimensions) && dimensions.length === length && [...dimensions].every(n => positive(n, 300)), 'Incomplete primitive dimensions.');
  if (primitive === 'Cylinder' || primitive === 'Cone' || primitive === 'Sphere') assert(positive(dimensions[0], 150), 'Invalid primitive radius.');
}
interface RecipeValidation { remaining: number; schemaVersion: SceneDocument['schemaVersion']; assetIds: ReadonlySet<string> }
function validateRecipe(recipe: unknown, depth: number, budget: RecipeValidation): void {
  record(recipe, 'Invalid solid recipe.');
  assert(depth < 32, 'Invalid or excessively nested solid recipe.');
  assert(--budget.remaining >= 0, `Project recipes exceed the ${MAX_RECIPE_NODES}-node complexity limit.`);
  switch (recipe.kind) {
    case 'mesh':
      fields(recipe, ['kind', 'assetId'], 'mesh recipe');
      assert(budget.schemaVersion === 3 && typeof recipe.assetId === 'string' && budget.assetIds.has(recipe.assetId), 'Missing mesh asset or unsupported project version.');
      break;
    case 'box':
      fields(recipe, ['kind', 'dimensions'], 'box recipe');
      assert(Array.isArray(recipe.dimensions) && recipe.dimensions.length === 3 && [...recipe.dimensions].every(n => positive(n, 300)), 'Box dimensions must be positive and at most 300 mm.');
      break;
    case 'cylinder':
      fields(recipe, ['kind', 'radius', 'height', 'segments'], 'cylinder recipe');
      assert(positive(recipe.radius, 150) && positive(recipe.height, 300), 'Invalid cylinder dimensions.');
      assert(typeof recipe.segments === 'number' && Number.isInteger(recipe.segments) && recipe.segments >= 8 && recipe.segments <= 128, 'Invalid cylinder resolution.');
      break;
    case 'sphere':
      assert(budget.schemaVersion === 3, 'Sphere recipes require a Palmivo version 3 project.');
      fields(recipe, ['kind', 'radius', 'segments'], 'sphere recipe');
      assert(positive(recipe.radius, 150), 'Invalid sphere radius.');
      assert(typeof recipe.segments === 'number' && Number.isInteger(recipe.segments) && recipe.segments >= 8 && recipe.segments <= 128, 'Invalid sphere resolution.');
      break;
    case 'cone':
      assert(budget.schemaVersion === 3, 'Cone recipes require a Palmivo version 3 project.');
      fields(recipe, ['kind', 'radius', 'height', 'segments'], 'cone recipe');
      assert(positive(recipe.radius, 150) && positive(recipe.height, 300), 'Invalid cone dimensions.');
      assert(typeof recipe.segments === 'number' && Number.isInteger(recipe.segments) && recipe.segments >= 8 && recipe.segments <= 128, 'Invalid cone resolution.');
      break;
    case 'pyramid':
      assert(budget.schemaVersion === 3, 'Pyramid recipes require a Palmivo version 3 project.');
      fields(recipe, ['kind', 'base', 'height'], 'pyramid recipe');
      assert(positive(recipe.base, 300) && positive(recipe.height, 300), 'Invalid pyramid dimensions.');
      break;
    case 'subtract':
      fields(recipe, ['kind', 'target', 'cutter'], 'subtraction recipe');
      validateSolid(recipe.target, depth + 1, budget); validateSolid(recipe.cutter, depth + 1, budget);
      assert(recipe.target.id !== recipe.cutter.id, 'The cutter must be a different solid.');
      break;
    case 'union':
      assert(budget.schemaVersion >= 2, 'Union recipes require a Palmivo version 2 or newer project.');
      fields(recipe, ['kind', 'target', 'other'], 'union recipe');
      validateSolid(recipe.target, depth + 1, budget); validateSolid(recipe.other, depth + 1, budget);
      assert(recipe.target.id !== recipe.other.id, 'Union requires two different solids.');
      break;
    default: throw new Error('Unknown solid recipe.');
  }
}
function validateSolid(solid: unknown, depth: number, budget: RecipeValidation): asserts solid is { id: string } {
  record(solid, 'Invalid solid.');
  fields(solid, ['id', 'name', 'recipe', 'position', 'scale', 'color'], 'solid');
  identifier(solid.id, 'solid');
  assert(typeof solid.name === 'string' && solid.name.length <= 128, 'Invalid solid label.');
  assert(typeof solid.color === 'string' && /^#[0-9a-f]{6}$/i.test(solid.color), 'Invalid solid color.');
  validatePosition(solid.position); validateScale(solid.scale); validateRecipe(solid.recipe, depth, budget);
}
function validateSavedAST(ast: unknown, schemaVersion: SceneDocument['schemaVersion']): void {
  record(ast, 'Invalid saved command.');
  switch (ast.type) {
    case 'ImportMesh':
      fields(ast, ['type', 'objectId', 'assetId'], 'ImportMesh command');
      assert(schemaVersion === 3, 'Imported meshes require a Palmivo version 3 project.');
      identifier(ast.objectId, 'object'); identifier(ast.assetId, 'asset'); break;
    case 'Create':
      fields(ast, ['type', 'objectId', 'primitive', 'dimensions', 'position'], 'Create command');
      identifier(ast.objectId, 'object');
      validatePrimitiveDimensions(ast.primitive, ast.dimensions, schemaVersion);
      validatePosition(ast.position); break;
    case 'Move':
      fields(ast, ['type', 'targetId', 'position'], 'Move command');
      identifier(ast.targetId, 'target'); validatePosition(ast.position); break;
    case 'Scale':
      fields(ast, ['type', 'targetId', 'uniformScale'], 'Scale command');
      identifier(ast.targetId, 'target'); validateScale(ast.uniformScale); break;
    case 'Subtract':
      fields(ast, ['type', 'targetId', 'cutterId', 'resultId'], 'Subtract command');
      identifier(ast.targetId, 'target'); identifier(ast.cutterId, 'cutter'); identifier(ast.resultId, 'result');
      assert(ast.targetId !== ast.cutterId, 'The cutter must be a different solid.');
      assert(ast.resultId !== ast.targetId && ast.resultId !== ast.cutterId, 'Invalid result ID.'); break;
    case 'Union':
      assert(schemaVersion >= 2, 'Union commands require a Palmivo version 2 or newer project.');
      fields(ast, ['type', 'targetId', 'otherId', 'resultId'], 'Union command');
      identifier(ast.targetId, 'first operand'); identifier(ast.otherId, 'second operand'); identifier(ast.resultId, 'result');
      assert(ast.targetId !== ast.otherId, 'Union requires two different solids.');
      assert(ast.resultId !== ast.targetId && ast.resultId !== ast.otherId, 'Invalid result ID.'); break;
    default: throw new Error('Invalid saved command.');
  }
}
export function validateDocument(document: unknown): asserts document is SceneDocument {
  record(document, 'Unsupported project format.');
  assert((document.schemaVersion === 1 || document.schemaVersion === 2 || document.schemaVersion === 3) && document.units === 'mm', 'Unsupported project format. Use a Palmivo version 1, 2 or 3 project in mm.');
  const assetIds = new Set<string>();
  const projectFields = ['schemaVersion', 'units', 'revision', 'solids', 'commands'];
  if (document.schemaVersion === 3 && Object.hasOwn(document, 'assets')) {
    projectFields.push('assets');
    assert(Array.isArray(document.assets) && document.assets.length <= MAX_RECIPE_NODES, 'Invalid mesh asset list.');
    let encodedBytes = 0;
    for (const asset of document.assets) {
      validateAssetEnvelope(asset);
      assert(!assetIds.has(asset.id), 'Duplicate mesh asset ID.');
      assetIds.add(asset.id);
      encodedBytes += asset.positions.length + asset.indices.length + (asset.colors?.length ?? 0);
      assert(encodedBytes <= MAX_PROJECT_FILE_BYTES, 'Mesh assets exceed the project file limit.');
    }
  }
  fields(document, projectFields, 'project');
  assert(typeof document.revision === 'number', 'Invalid scene revision.');
  assert(Number.isSafeInteger(document.revision) && document.revision >= 0, 'Invalid scene revision.');
  assert(Array.isArray(document.solids) && document.solids.length <= MAX_SOLIDS, 'A project can contain at most 10 visible solids.');
  assert(Array.isArray(document.commands) && document.commands.length <= 10000, 'Invalid command history.');
  const ids = new Set<string>();
  const budget: RecipeValidation = { remaining: MAX_RECIPE_NODES, schemaVersion: document.schemaVersion, assetIds };
  for (const solid of document.solids) { validateSolid(solid, 0, budget); assert(!ids.has(solid.id), 'Duplicate solid IDs.'); ids.add(solid.id); }
  const commandIds = new Set<string>();
  for (const command of document.commands) {
    record(command, 'Invalid saved command.');
    fields(command, ['commandId', 'baseSceneRevision', 'source', 'ast'], 'saved command');
    identifier(command.commandId, 'command');
    assert(!commandIds.has(command.commandId), 'Duplicate command ID.');
    assert(typeof command.baseSceneRevision === 'number' && Number.isSafeInteger(command.baseSceneRevision) && command.baseSceneRevision >= 0, 'Invalid saved command revision.');
    assert(command.source === 'gesture-rules' || command.source === 'pointer' || command.source === 'keyboard', 'Invalid saved command source.');
    validateSavedAST(command.ast, document.schemaVersion);
    const ast = command.ast as CommandAST;
    if (ast.type === 'ImportMesh') assert(assetIds.has(ast.assetId), 'A saved import command references a missing mesh asset.');
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
    case 'ImportMesh':
      assert(document.solids.length < MAX_SOLIDS, 'The demo supports at most 10 visible solids.');
      identifier(ast.objectId, 'object');
      assert(!exists(ast.objectId) && /^mesh-[0-9a-f]{64}$/.test(ast.assetId), 'Invalid mesh import command.');
      break;
    case 'Create':
      assert(document.solids.length < MAX_SOLIDS, 'The demo supports at most 10 visible solids.');
      assert(typeof ast.objectId === 'string' && ast.objectId.length > 0 && !exists(ast.objectId), 'Invalid or duplicate object ID.');
      validatePrimitiveDimensions(ast.primitive, ast.dimensions);
      validatePosition(ast.position); break;
    case 'Move': assert(exists(ast.targetId), 'The selected object no longer exists.'); validatePosition(ast.position); break;
    case 'Scale': assert(exists(ast.targetId), 'The selected object no longer exists.'); validateScale(ast.uniformScale); break;
    case 'Subtract':
      assert(exists(ast.targetId) && exists(ast.cutterId), 'Select both a target and a cutter.');
      assert(ast.targetId !== ast.cutterId, 'The cutter must be a different solid.');
      assert(typeof ast.resultId === 'string' && ast.resultId.length > 0 && !exists(ast.resultId), 'Invalid result ID.');
      break;
    case 'Union':
      assert(exists(ast.targetId) && exists(ast.otherId), 'Select both solids to join.');
      assert(ast.targetId !== ast.otherId, 'Union requires two different solids.');
      identifier(ast.resultId, 'result');
      assert(!exists(ast.resultId), 'Invalid result ID.');
      break;
    default: throw new Error('Unknown command.');
  }
}
