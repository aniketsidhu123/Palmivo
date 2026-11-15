import { afterEach, describe, expect, it, vi } from 'vitest';
import { PresentationCoordinator } from './presentation';
import type { ControllerState } from '../shared/types';

const state = (): ControllerState => ({ scene: { schemaVersion: 1, units: 'mm', revision: 0, solids: [], commands: [] }, draft: { kind: 'scale', targetId: 'box', uniformScale: 1 }, selectedId: 'box', busy: false, paused: false, message: 'Scale', lastCommand: null, historyCount: 0 });
function setup() { const callbacks = { full: vi.fn(), renderPreview: vi.fn(), preview: vi.fn(), persist: vi.fn() }; return { callbacks, coordinator: new PresentationCoordinator(callbacks) }; }
afterEach(() => vi.useRealTimers());
describe('preview presentation scheduling', () => {
  it('renders every preview but coalesces inspector work and does not persist previews', () => {
    vi.useFakeTimers(); const { callbacks, coordinator } = setup(); const current = state();
    coordinator.update(current, true, true);
    for (let i = 0; i < 60; i++) {
      if (current.draft?.kind === 'scale') current.draft.uniformScale = 1 + i / 100;
      coordinator.update(current, true, true);
    }
    expect(callbacks.full).toHaveBeenCalledTimes(1); expect(callbacks.renderPreview).toHaveBeenCalledTimes(60);
    expect(callbacks.persist).toHaveBeenCalledTimes(1); expect(callbacks.preview).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100); expect(callbacks.preview).toHaveBeenCalledTimes(1);
    expect(callbacks.preview.mock.calls[0][0].draft?.uniformScale).toBeCloseTo(1.59);
  });
  it('cancels queued preview text when commit or cancellation changes the state', () => {
    vi.useFakeTimers(); const { callbacks, coordinator } = setup(); const current = state();
    coordinator.update(current, true, true); coordinator.update(current, true, true);
    current.draft = null; current.scene = { ...current.scene, revision: 1 }; coordinator.update(current, true, true);
    vi.advanceTimersByTime(200);
    expect(callbacks.full).toHaveBeenCalledTimes(2); expect(callbacks.preview).not.toHaveBeenCalled(); expect(callbacks.persist).toHaveBeenCalledTimes(2);
  });
  it('immediately reflects cutter changes and initial readiness without saving transient state', () => {
    const { callbacks, coordinator } = setup(); const current = state();
    coordinator.update(current, false, false); coordinator.update(current, true, false);
    current.draft = { kind: 'subtract', targetId: 'box', cutterId: null, resultId: 'result' };
    coordinator.update(current, true, false); current.draft.cutterId = 'cylinder'; coordinator.update(current, true, false);
    expect(callbacks.full).toHaveBeenCalledTimes(4); expect(callbacks.persist).not.toHaveBeenCalled();
  });
  it('disposes pending inspector work', () => {
    vi.useFakeTimers(); const { callbacks, coordinator } = setup(); const current = state();
    coordinator.update(current, true, true); coordinator.update(current, true, true); coordinator.dispose(); vi.advanceTimersByTime(200);
    expect(callbacks.preview).not.toHaveBeenCalled();
  });
});
