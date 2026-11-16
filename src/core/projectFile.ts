import type { SceneDocument } from '../shared/types';
import { validateDocument } from './validation';

export const MAX_PROJECT_FILE_BYTES = 8 * 1024 * 1024;

/** Parse only the local, versioned project format. The command log is data, never executed. */
export function parseProjectFile(text: string): SceneDocument {
  if (new TextEncoder().encode(text).byteLength > MAX_PROJECT_FILE_BYTES) {
    throw new Error('Project is larger than the 8 MiB limit. Choose a smaller Palmivo project.');
  }
  let document: unknown;
  try { document = JSON.parse(text); }
  catch { throw new Error('Could not read project JSON. Choose an exported Palmivo .json file.'); }
  validateDocument(document);
  return document;
}
