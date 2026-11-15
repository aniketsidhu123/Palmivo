import type { SceneDocument } from '../shared/types';

/** Never turn a failed restore into permission to overwrite the original local save. */
export async function recoverProject(load: () => Promise<SceneDocument | null>, restore: (scene: SceneDocument) => Promise<boolean>): Promise<{ canAutosave: boolean; message?: string }> {
  try {
    const saved = await load();
    if (!saved || await restore(saved)) return { canAutosave: true };
    return { canAutosave: false, message: 'Saved project could not be restored. Its original save is preserved. Reload to retry, or Reset workspace to start a new scene.' };
  } catch {
    return { canAutosave: false, message: 'Local storage unavailable. You can still model and export this session.' };
  }
}
