import { describe, expect, it, vi } from 'vitest';
import { recoverProject } from './recovery';
import type { SceneDocument } from '../shared/types';
const saved: SceneDocument = { schemaVersion: 1, units: 'mm', revision: 2, solids: [], commands: [] };
describe('startup save protection', () => {
  it('allows a fresh workspace without attempting a restore', async () => {
    const restore = vi.fn(); expect(await recoverProject(async () => null, restore)).toEqual({ canAutosave: true }); expect(restore).not.toHaveBeenCalled();
  });
  it('allows autosave only after a successful saved-project rebuild', async () => {
    const restore = vi.fn(async () => true); expect(await recoverProject(async () => saved, restore)).toEqual({ canAutosave: true }); expect(restore).toHaveBeenCalledWith(saved);
  });
  it('protects the original save when geometry restoration fails', async () => {
    const result = await recoverProject(async () => saved, async () => false); expect(result.canAutosave).toBe(false); expect(result.message).toContain('original save is preserved');
  });
  it('keeps autosave disabled when storage cannot be read', async () => {
    const restore = vi.fn(); const result = await recoverProject(async () => { throw Error('Storage denied'); }, restore); expect(result.canAutosave).toBe(false); expect(restore).not.toHaveBeenCalled();
  });
});
