/** DOM-independent activation of stable gesture targets. Coordinates are CSS pixels. */
export type ActivationMode = 'pinch' | 'dwell';
export type ActivationPhase = 'tracking-lost' | 'gate-closed' | 'release' | 'idle' | 'hover' | 'ready' | 'closing' | 'activated' | 'leave-targets';
export interface ActivationInput {
  timestamp: number;
  targetId: string | null;
  /** CSS pixel size of the hit control, measured in the current layout. */
  targetBounds?: { width: number; height: number };
  trackingReady: boolean;
  toolbarArmed: boolean;
  pinched: boolean;
  pinchStarted: boolean;
  pinchReleased: boolean;
  /** Raw threshold crossing, before the recognizer's two-observation pinch latch. */
  pinchClosing?: boolean;
  cursor: { x: number; y: number } | null;
}
export interface ActivationOutput {
  activate: string | null;
  /** Stable/captured target for a visual highlight. */
  targetId: string | null;
  /** 0–1 hover progress, or 1 while an eligible pinch is closing. */
  progress: number;
  phase: ActivationPhase;
}
export interface ActivationOptions {
  mode?: ActivationMode;
  hoverMs?: number;
  dwellMs?: number;
  commitDwellMs?: number;
  maxCaptureDriftPx?: number;
  /** Dwell unlock additionally requires real cursor movement, protecting DOM replacement. */
  dwellExitDistancePx?: number;
}
type Cursor = NonNullable<ActivationInput['cursor']>;

/**
 * Pinch: stable neutral hover → capture on first raw close → debounced rising edge.
 * Dwell: stable armed/released hover → one activation → leave all targets to rearm.
 * Missing tracking clears candidates immediately and requires release + fresh hover.
 */
export class TargetActivation {
  private mode: ActivationMode;
  private readonly hoverMs: number;
  private readonly dwellMs: number;
  private readonly commitDwellMs: number;
  private readonly maxCaptureDriftPx: number;
  private readonly dwellExitDistancePx: number;
  private hoverId: string | null = null;
  private hoverSince = 0;
  private lastHoverCursor: Cursor | null = null;
  private lastHoverTime = 0;
  private captureRadius = 0;
  private capture: { id: string; cursor: Cursor } | null = null;
  private closingCycle = false;
  private requireRelease = true;
  private lastTimestamp: number | null = null;
  private dwellLock: Cursor | null = null;

  constructor(options: ActivationOptions = {}) {
    this.mode = options.mode ?? 'pinch';
    this.hoverMs = Math.max(0, options.hoverMs ?? 300);
    this.dwellMs = Math.max(this.hoverMs, options.dwellMs ?? 900);
    this.commitDwellMs = Math.max(this.dwellMs, options.commitDwellMs ?? 1200);
    this.maxCaptureDriftPx = Math.max(0, options.maxCaptureDriftPx ?? 32);
    this.dwellExitDistancePx = Math.max(1, options.dwellExitDistancePx ?? 16);
  }

  setMode(mode: ActivationMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.reset();
  }

  reset(): void {
    this.clearArming();
    this.lastTimestamp = null;
    this.dwellLock = null;
  }

  private clearHover(): void {
    this.hoverId = null;
    this.hoverSince = 0;
    this.lastHoverCursor = null;
    this.lastHoverTime = 0;
  }

  private clearArming(): void {
    this.clearHover();
    this.capture = null;
    this.closingCycle = false;
    this.requireRelease = true;
  }

  private output(phase: ActivationPhase, targetId: string | null = null, progress = 0, activate: string | null = null): ActivationOutput {
    return { activate, targetId, progress: Math.max(0, Math.min(1, progress)), phase };
  }

  update(input: ActivationInput): ActivationOutput {
    const cursor = input.cursor;
    if (!input.trackingReady || !Number.isFinite(input.timestamp) || !cursor || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) {
      this.clearArming();
      this.lastTimestamp = null;
      return this.output('tracking-lost');
    }
    // A delayed or out-of-order callback cannot complete an old hover/capture.
    if (this.lastTimestamp !== null && (input.timestamp < this.lastTimestamp || input.timestamp - this.lastTimestamp > 250)) this.clearArming();
    this.lastTimestamp = input.timestamp;
    const released = !input.pinched && !input.pinchStarted && !input.pinchClosing;

    if (this.dwellLock) {
      const moved = Math.hypot(cursor.x - this.dwellLock.x, cursor.y - this.dwellLock.y) >= this.dwellExitDistancePx;
      if (input.targetId === null && moved && released) {
        this.dwellLock = null;
        this.clearArming();
      } else return this.output('leave-targets');
    }

    if (this.requireRelease) {
      if (!released) return this.output('release');
      this.requireRelease = false;
      this.capture = null;
      this.closingCycle = false;
      this.clearHover();
    }

    if (!input.toolbarArmed) {
      this.clearHover();
      this.capture = null;
      if (!released) { this.requireRelease = true; this.closingCycle = false; }
      return this.output('gate-closed');
    }

    if (released) {
      // Releasing a completed/aborted pinch starts a fresh hover, even on the same button.
      if (this.closingCycle || input.pinchReleased) { this.capture = null; this.closingCycle = false; this.clearHover(); }
      if (!input.targetId) { this.clearHover(); return this.output('idle'); }
      if (input.targetId !== this.hoverId) { this.hoverId = input.targetId; this.hoverSince = input.timestamp; }
      this.lastHoverCursor = { ...cursor };
      this.lastHoverTime = input.timestamp;
      const bounds = input.targetBounds;
      this.captureRadius = bounds && bounds.width > 0 && bounds.height > 0
        ? Math.min(this.maxCaptureDriftPx, Math.min(bounds.width, bounds.height) / 2)
        : this.maxCaptureDriftPx;
      const elapsed = input.timestamp - this.hoverSince;
      const duration = this.mode === 'dwell' ? (this.hoverId === 'tool:commit' ? this.commitDwellMs : this.dwellMs) : this.hoverMs;
      const progress = duration === 0 ? 1 : elapsed / duration;
      if (this.mode === 'dwell' && elapsed >= duration) {
        const activated = this.hoverId;
        this.dwellLock = { ...cursor };
        this.clearArming();
        return this.output('activated', activated, 1, activated);
      }
      return this.output(this.mode === 'pinch' && elapsed >= duration ? 'ready' : 'hover', this.hoverId, progress);
    }

    // Dwell only accepts a fully released pointer hand. Pinching resets its countdown.
    if (this.mode === 'dwell') {
      this.clearArming();
      return this.output('release');
    }

    if (!this.closingCycle) {
      this.closingCycle = true;
      const freshClose = input.pinchClosing === true || input.pinchStarted;
      const recent = input.timestamp - this.lastHoverTime <= 250;
      const nearPrevious = this.lastHoverCursor !== null && Math.hypot(cursor.x - this.lastHoverCursor.x, cursor.y - this.lastHoverCursor.y) <= this.captureRadius;
      if (freshClose && this.hoverId && this.lastHoverCursor && recent && input.timestamp - this.hoverSince >= this.hoverMs && (input.targetId === this.hoverId || nearPrevious)) {
        this.capture = { id: this.hoverId, cursor: { ...this.lastHoverCursor } };
      }
      this.clearHover();
    }

    if (this.capture && input.targetId !== this.capture.id) {
      const overAnotherControl = input.targetId !== null;
      const exceededRadius = Math.hypot(cursor.x - this.capture.cursor.x, cursor.y - this.capture.cursor.y) > this.captureRadius;
      // Closing in the gap may keep a target. Closing on its neighbour is ambiguous.
      if (overAnotherControl || exceededRadius) this.capture = null;
    }

    if (input.pinchStarted) {
      const activated = this.capture?.id ?? null;
      this.capture = null;
      this.requireRelease = true;
      return activated ? this.output('activated', activated, 1, activated) : this.output('release');
    }
    return this.capture ? this.output('closing', this.capture.id, 1) : this.output('release');
  }
}
