import type { ControllerState, SceneDocument } from '../shared/types';

interface PresentationCallbacks {
  full(state: ControllerState): void;
  renderPreview(state: ControllerState): void;
  preview(state: ControllerState): void;
  persist(scene: SceneDocument): void;
}

/** Keep expensive structural UI and persistence off the continuous preview path. */
export class PresentationCoordinator {
  readonly diagnostics = { fullUpdates: 0, renderPreviews: 0, inspectorPreviews: 0, persistenceWrites: 0 };
  private key: unknown[] = [];
  private savedScene: SceneDocument | null = null;
  private savedRevision = -1;
  private pending: ControllerState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly callbacks: PresentationCallbacks, private readonly inspectorIntervalMs = 100) {}

  update(state: ControllerState, initialized: boolean, persistenceReady: boolean): void {
    const draft = state.draft;
    // Scalar preview values deliberately do not participate in this structural key.
    const key = [state.scene, state.scene.revision, draft, state.selectedId, state.busy, state.paused, state.message,
      draft?.kind === 'subtract' ? draft.cutterId : draft?.kind === 'union' ? draft.otherId : null, initialized];
    const structural = key.length !== this.key.length || key.some((value, index) => value !== this.key[index]);
    this.key = key;
    if (structural) {
      this.cancelPending();
      this.diagnostics.fullUpdates++;
      this.callbacks.full(state);
    } else if (draft?.kind === 'move' || draft?.kind === 'scale') {
      this.diagnostics.renderPreviews++;
      this.callbacks.renderPreview(state);
      this.pending = state;
      if (this.timer === null) this.timer = setTimeout(() => {
        this.timer = null;
        const latest = this.pending; this.pending = null;
        if (latest) { this.diagnostics.inspectorPreviews++; this.callbacks.preview(latest); }
      }, this.inspectorIntervalMs);
    }
    if (persistenceReady && !state.busy && (this.savedScene !== state.scene || this.savedRevision !== state.scene.revision)) {
      this.savedScene = state.scene; this.savedRevision = state.scene.revision;
      this.diagnostics.persistenceWrites++;
      this.callbacks.persist(state.scene);
    }
  }

  private cancelPending(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null; this.pending = null;
  }
  dispose(): void { this.cancelPending(); }
}
