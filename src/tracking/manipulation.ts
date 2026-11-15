import type { GestureOutput } from '../shared/types';
import { MAX_SCALE, MIN_SCALE } from '../core/validation';
import { TRACKING_GAP_MS } from './gestures';

export type ScalePhase = 'ready' | 'active' | 'held' | 'paused';
export interface ScaleUpdate { value: number; changed: boolean; phase: ScalePhase }
export interface ScaleSessionOptions { filterMs?: number; deadband?: number; minSeparation?: number; settleMs?: number }

const finite = (value: number | undefined, fallback: number) => value !== undefined && Number.isFinite(value) ? value : fallback;
const clampScale = (value: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, finite(value, 1)));

/**
 * A reversible scale preview. Recognition supplies already-debounced pinch states.
 * Missing input freezes the visible value; it never invents motion or an action edge.
 */
export class ScaleSession {
  private currentValue: number;
  private currentPhase: ScalePhase = 'ready';
  private readonly filterMs: number;
  private readonly deadband: number;
  private readonly minSeparation: number;
  private readonly settleMs: number;
  private baseline: { separation: number; scale: number } | null = null;
  private filteredSeparation = 0;
  private lastGoodTime: number | null = null;
  private lastFilterTime: number | null = null;
  private lastValidInputTime: number | null = null;
  private lastInvalidInputTime: number | null = null;
  private interrupted = false;
  private requireRelease = false;
  private releasePendingHeld = false;
  private hasManipulated = false;
  private steadyTarget: number | null = null;
  private steadySince = 0;
  private settled = false;

  constructor(initialScale: number, options: ScaleSessionOptions = {}) {
    this.currentValue = clampScale(initialScale);
    this.filterMs = Math.max(1, finite(options.filterMs, 70));
    this.deadband = Math.max(0, finite(options.deadband, 0.003));
    this.minSeparation = Math.max(0.01, finite(options.minSeparation, 0.12));
    this.settleMs = Math.max(this.filterMs, finite(options.settleMs, 210));
  }

  get value(): number { return this.currentValue; }
  get phase(): ScalePhase { return this.currentPhase; }

  /** Call for a new draft or a mouse/keyboard override; old hand baselines are discarded. */
  reset(initialScale: number): void {
    this.currentValue = clampScale(initialScale); this.currentPhase = 'ready';
    this.baseline = null; this.filteredSeparation = 0;
    this.lastGoodTime = null; this.lastFilterTime = null; this.lastValidInputTime = null; this.lastInvalidInputTime = null;
    this.interrupted = false; this.requireRelease = false; this.releasePendingHeld = false; this.hasManipulated = false;
    this.clearSteady();
  }

  update(input: GestureOutput): ScaleUpdate {
    const now = input.timestamp;
    if (!Number.isFinite(now)) return this.result(false);
    const trackingValid = input.trackingReady && !input.trackingLost;
    const previousValidInputTime = this.lastValidInputTime;
    // Valid packets carry capture time; a watchdog uses the later wall-clock time. A new
    // in-flight capture can therefore precede the most recent watchdog timestamp without
    // being a replay. Validate each clock independently and never reject that recovery.
    if (trackingValid) {
      if (this.lastValidInputTime !== null && now <= this.lastValidInputTime) return this.result(false);
      this.lastValidInputTime = now;
    } else {
      if (this.lastValidInputTime !== null && now <= this.lastValidInputTime ||
          this.lastInvalidInputTime !== null && now <= this.lastInvalidInputTime) return this.result(false);
      this.lastInvalidInputTime = now;
    }
    const baselineLost = this.baseline && this.lastGoodTime !== null && now - this.lastGoodTime >= TRACKING_GAP_MS;
    const pendingReleaseLost = this.releasePendingHeld && previousValidInputTime !== null && now - previousValidInputTime >= TRACKING_GAP_MS;
    if (baselineLost || pendingReleaseLost) {
      this.baseline = null; this.requireRelease = true; this.releasePendingHeld = false; this.clearSteady();
    }
    if (!trackingValid) return this.pause();

    // False latched pinch means recognition has already observed a deliberate release.
    if (!input.dominantPinched || !input.otherPinched) {
      this.baseline = null; this.lastGoodTime = null; this.lastFilterTime = null;
      this.requireRelease = false; this.releasePendingHeld = false; this.interrupted = false; this.clearSteady();
      this.currentPhase = this.hasManipulated ? 'held' : 'ready';
      return this.result(false);
    }
    if (this.requireRelease && !this.releasePendingHeld) return this.pause();
    // Separation changes as fingers open. Freeze on that first raw opening sample rather
    // than applying its geometry while the two-observation pinch latch is still closed.
    if (input.pinchOpening || input.otherPinchOpening) {
      this.baseline = null; this.requireRelease = true; this.releasePendingHeld = true;
      this.interrupted = false; this.clearSteady(); this.currentPhase = 'held';
      return this.result(false);
    }
    if (this.requireRelease) {
      if (this.releasePendingHeld) { this.currentPhase = 'held'; return this.result(false); }
      return this.pause();
    }
    if (!input.bothPinched || !Number.isFinite(input.separation) || input.separation < this.minSeparation) return this.pause();

    if (!this.baseline) {
      this.baseline = { separation: input.separation, scale: this.currentValue };
      this.filteredSeparation = input.separation; this.lastGoodTime = now; this.lastFilterTime = now;
      this.hasManipulated = true; this.interrupted = false; this.currentPhase = 'active';
      this.beginSteady(this.currentValue, now);
      return this.result(false);
    }
    if (this.interrupted) {
      // Keep the same baseline but do not compress motion hidden by a tracking gap into
      // one large resume-frame step. Filtering resumes from the next valid sample.
      this.interrupted = false; this.lastGoodTime = now; this.lastFilterTime = now;
      this.currentPhase = 'active'; this.clearSteady();
      return this.result(false);
    }

    const elapsed = Math.max(0, now - (this.lastFilterTime ?? now));
    const alpha = 1 - Math.exp(-elapsed / this.filterMs);
    this.filteredSeparation += alpha * (input.separation - this.filteredSeparation);
    this.lastGoodTime = now; this.lastFilterTime = now; this.currentPhase = 'active';
    const rawTarget = clampScale(this.baseline.scale * input.separation / this.baseline.separation);
    const target = clampScale(this.baseline.scale * this.filteredSeparation / this.baseline.separation);
    let next = Math.abs(target - this.currentValue) >= this.deadband ? target : this.currentValue;

    // A quiet, precise endpoint may sit inside the output deadband. Snap once after the
    // filter has settled; ordinary frame-to-frame noise never gets an unfiltered shortcut.
    if (this.steadyTarget === null || Math.abs(rawTarget - this.steadyTarget) > 0.0001) this.beginSteady(rawTarget, now);
    else if (!this.settled && now - this.steadySince >= this.settleMs && Math.abs(target - this.steadyTarget) <= Math.max(0.00001, this.deadband / 4)) {
      next = this.steadyTarget; this.settled = true;
    }
    const changed = Math.abs(next - this.currentValue) > 1e-10;
    if (changed) this.currentValue = next;
    return this.result(changed);
  }

  private pause(): ScaleUpdate {
    this.currentPhase = 'paused'; this.interrupted = true; this.clearSteady();
    return this.result(false);
  }
  private beginSteady(target: number, timestamp: number): void { this.steadyTarget = target; this.steadySince = timestamp; this.settled = false; }
  private clearSteady(): void { this.steadyTarget = null; this.steadySince = 0; this.settled = false; }
  private result(changed: boolean): ScaleUpdate { return { value: this.currentValue, changed, phase: this.currentPhase }; }
}
