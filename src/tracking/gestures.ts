import type { CalibrationProfile, GestureOutput, Landmark, TrackedHand, TrackingFrame } from '../shared/types';

// One dropped sample at 13 FPS spans about 154 ms; keep its held state without inventing edges.
export const TRACKING_GAP_MS = 225;

export const DEFAULT_PROFILE: CalibrationProfile = {
  dominantHand: 'Right', minX: 0.12, maxX: 0.88, minY: 0.12, maxY: 0.88,
  pinchClose: 0.32, pinchOpen: 0.52,
};

export interface GestureRecognizerOptions { singleHand?: boolean }

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const validHand = (hand: TrackedHand) => hand.score >= 0.5 && hand.landmarks.length === 21 &&
  hand.landmarks.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));

function distance(a: Landmark, b: Landmark, aspect: number): number {
  return Math.hypot(a.x - b.x, (a.y - b.y) * aspect);
}

/** Image-space distances use height/width so a non-square camera does not distort the ratio. */
export function pinchRatio(hand: TrackedHand, width: number, height: number): number {
  if (!validHand(hand)) return Infinity;
  const aspect = height / Math.max(1, width);
  const palm = distance(hand.landmarks[0], hand.landmarks[9], aspect);
  return palm > 0.015 ? distance(hand.landmarks[4], hand.landmarks[8], aspect) / palm : Infinity;
}

export function isOpenHand(hand: TrackedHand, width: number, height: number, threshold = DEFAULT_PROFILE.pinchOpen): boolean {
  if (!validHand(hand) || pinchRatio(hand, width, height) <= threshold) return false;
  const aspect = height / Math.max(width, 1);
  const extended = [5, 9, 13, 17].filter(mcp => {
    const a = hand.landmarks[mcp];
    const joint = hand.landmarks[mcp + 1];
    const tip = hand.landmarks[mcp + 3];
    const ux = a.x - joint.x, uy = (a.y - joint.y) * aspect;
    const vx = tip.x - joint.x, vy = (tip.y - joint.y) * aspect;
    const denominator = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    if (denominator < 0.00001) return false;
    const angle = Math.acos(clamp((ux * vx + uy * vy) / denominator, -1, 1));
    return angle >= 135 * Math.PI / 180 &&
      distance(tip, hand.landmarks[0], aspect) > distance(joint, hand.landmarks[0], aspect) * 1.1;
  }).length;
  // One partly folded finger is common in a relaxed offhand; it should not disarm a click.
  return extended >= 3;
}

class PinchLatch {
  pinched = false;
  private candidate = false;
  private count = 0;
  update(ratio: number, profile: CalibrationProfile): void {
    const next = this.pinched ? ratio < profile.pinchOpen : ratio < profile.pinchClose;
    if (next === this.pinched) { this.count = 0; return; }
    if (this.candidate !== next) { this.candidate = next; this.count = 1; }
    else this.count++;
    if (this.count >= 2) { this.pinched = next; this.count = 0; }
  }
  reset(): void { this.pinched = false; this.count = 0; this.candidate = false; }
  interrupt(): void { this.count = 0; }
  resume(ratio: number, profile: CalibrationProfile): void {
    // A pinch that happened while input was invalid is never a fresh activation edge.
    this.pinched = this.pinched ? ratio < profile.pinchOpen : ratio < profile.pinchClose;
    this.interrupt();
  }
}

export function sanitizeProfile(profile: CalibrationProfile): CalibrationProfile {
  const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
  const minX = clamp(finite(profile.minX, 0.12), 0, 0.7);
  const minY = clamp(finite(profile.minY, 0.12), 0, 0.7);
  const close = clamp(finite(profile.pinchClose, DEFAULT_PROFILE.pinchClose), 0.15, 0.45);
  return {
    dominantHand: profile.dominantHand === 'Left' ? 'Left' : 'Right', minX, minY,
    maxX: clamp(finite(profile.maxX, 0.88), minX + 0.25, 1),
    maxY: clamp(finite(profile.maxY, 0.88), minY + 0.25, 1),
    pinchClose: close, pinchOpen: clamp(finite(profile.pinchOpen, DEFAULT_PROFILE.pinchOpen), close + 0.1, 0.95),
  };
}

/** Stateful rule recognizer. Missing input never synthesizes a pinch-release event. */
export class GestureRecognizer {
  profile: CalibrationProfile;
  private dominant = new PinchLatch();
  private other = new PinchLatch();
  private lastValid: number | null = null;
  private stableSince: number | null = null;
  private openSince: number | null = null;
  private lastOpenAt: number | null = null;
  private ready = false;
  private interrupted = false;
  private lastProcessedFrame: number | null = null;
  private cursor: { x: number; y: number } | null = null;
  private rawCursor: { x: number; y: number } | null = null;
  private lastTime: number | null = null;
  private previousWrists: { dominant: Landmark; other: Landmark } | null = null;
  private previousPointerWrist: Landmark | null = null;
  private singleHand: boolean;

  constructor(profile: CalibrationProfile = DEFAULT_PROFILE, options: GestureRecognizerOptions = {}) {
    this.profile = sanitizeProfile(profile); this.singleHand = options.singleHand === true;
  }
  setProfile(profile: CalibrationProfile): void { this.profile = sanitizeProfile(profile); this.reset(); }
  setSingleHand(enabled: boolean): void {
    if (this.singleHand === enabled) return;
    this.singleHand = enabled; this.reset();
  }
  reset(): void {
    this.dominant.reset(); this.other.reset(); this.lastValid = null; this.stableSince = null;
    this.openSince = null; this.lastOpenAt = null; this.ready = false; this.cursor = null; this.rawCursor = null; this.lastTime = null;
    this.interrupted = false; this.lastProcessedFrame = null;
    this.previousWrists = null;
    this.previousPointerWrist = null;
  }

  missing(timestamp: number): GestureOutput {
    const lost = this.lastValid === null || timestamp - this.lastValid >= TRACKING_GAP_MS;
    this.interrupted = true; this.dominant.interrupt(); this.other.interrupt();
    // Dwell has no deliberate pinch-release gate, so even a brief loss must acquire
    // a fresh stable pointer before its countdown can begin again.
    if (lost || this.singleHand) this.suspend();
    // In the two-hand mode, one missing sample does not force another neutral hold.
    // A genuine gap still requires full reacquisition in either mode.
    return this.output(timestamp, false, false, 0, false, lost, false);
  }

  private suspend(): void {
    this.ready = false; this.stableSince = null; this.openSince = null; this.lastOpenAt = null;
    this.previousWrists = null; this.dominant.interrupt(); this.other.interrupt();
    this.previousPointerWrist = null;
  }

  process(frame: TrackingFrame): GestureOutput {
    const { timestamp } = frame;
    if (!Number.isFinite(timestamp) || !Number.isFinite(frame.width) || !Number.isFinite(frame.height) || frame.width <= 0 || frame.height <= 0) return this.missing(this.lastValid ?? 0);
    if (this.lastProcessedFrame !== null && timestamp <= this.lastProcessedFrame) {
      return this.output(timestamp, false, false, 0, false, false, false);
    }
    this.lastProcessedFrame = timestamp;
    // Timestamp gaps matter even when there was no intervening explicit missing() call.
    if (this.lastValid !== null && timestamp - this.lastValid >= TRACKING_GAP_MS) { this.suspend(); this.interrupted = true; }
    const hands = frame.hands.filter(validHand);
    // Never assign by screen x: crossings must not silently exchange hand roles.
    const dominantHands = hands.filter(hand => hand.handedness === this.profile.dominantHand);
    if (this.singleHand) return dominantHands.length === 1 ? this.processSingleHand(frame, dominantHands[0]) : this.missing(timestamp);
    const otherHands = hands.filter(hand => hand.handedness !== this.profile.dominantHand);
    if (dominantHands.length !== 1 || otherHands.length !== 1) return this.missing(timestamp);
    const dominantHand = dominantHands[0], otherHand = otherHands[0];
    const aspect = frame.height / Math.max(1, frame.width);
    const wrist = dominantHand.landmarks[0], otherWrist = otherHand.landmarks[0];
    if (this.previousWrists && this.lastValid !== null && timestamp - this.lastValid < TRACKING_GAP_MS &&
      (distance(wrist, this.previousWrists.dominant, aspect) > 0.4 ||
       distance(otherWrist, this.previousWrists.other, aspect) > 0.4)) return this.missing(timestamp);
    const dominantRatio = pinchRatio(dominantHand, frame.width, frame.height);
    const otherRatio = pinchRatio(otherHand, frame.width, frame.height);
    if (!Number.isFinite(dominantRatio) || !Number.isFinite(otherRatio)) return this.missing(timestamp);
    this.previousWrists = { dominant: { ...wrist }, other: { ...otherWrist } };
    this.lastValid = timestamp;
    this.stableSince ??= timestamp;
    const resumed = this.interrupted;
    this.interrupted = false;
    if (!this.ready && timestamp - this.stableSince >= 300 &&
      dominantRatio >= this.profile.pinchOpen && otherRatio >= this.profile.pinchOpen) {
      this.ready = true; this.dominant.reset(); this.other.reset();
    }

    const wasPinched = this.dominant.pinched;
    if (this.ready) {
      if (resumed) { this.dominant.resume(dominantRatio, this.profile); this.other.resume(otherRatio, this.profile); }
      else { this.dominant.update(dominantRatio, this.profile); this.other.update(otherRatio, this.profile); }
    }
    const rawOtherOpen = isOpenHand(otherHand, frame.width, frame.height, this.profile.pinchOpen);
    if (rawOtherOpen) { this.openSince ??= timestamp; this.lastOpenAt = timestamp; }
    else if (otherRatio < this.profile.pinchOpen || this.lastOpenAt === null || timestamp - this.lastOpenAt > 120) {
      this.openSince = null; this.lastOpenAt = null;
    }
    const otherOpen = this.openSince !== null;

    this.updateCursor(dominantHand, timestamp);
    const separation = distance(dominantHand.landmarks[8], otherHand.landmarks[8], aspect);
    return this.output(timestamp, !resumed && !wasPinched && this.dominant.pinched && this.ready,
      !resumed && wasPinched && !this.dominant.pinched && this.ready, separation, otherOpen, false, true, dominantRatio, otherRatio);
  }

  /** Optional one-hand dwell requires visibility and identity, never a finger pose. */
  private processSingleHand(frame: TrackingFrame, hand: TrackedHand): GestureOutput {
    const { timestamp } = frame;
    const wrist = hand.landmarks[0];
    // Preserve the nondegenerate-skeleton check; the ratio's value never gates a pose.
    const ratio = pinchRatio(hand, frame.width, frame.height);
    if (!Number.isFinite(ratio)) return this.missing(timestamp);
    if (this.previousPointerWrist && this.lastValid !== null && timestamp - this.lastValid < TRACKING_GAP_MS &&
      distance(wrist, this.previousPointerWrist, frame.height / frame.width) > 0.4) return this.missing(timestamp);
    this.previousPointerWrist = { ...wrist }; this.lastValid = timestamp;
    this.stableSince ??= timestamp;
    this.ready = timestamp - this.stableSince >= 300;
    this.interrupted = false;
    this.updateCursor(hand, timestamp);
    return this.output(timestamp, false, false, 0, false, false, true, ratio);
  }

  private updateCursor(hand: TrackedHand, timestamp: number): void {
    const tip = hand.landmarks[8];
    const raw = {
      x: clamp((1 - tip.x - this.profile.minX) / (this.profile.maxX - this.profile.minX)),
      y: clamp((tip.y - this.profile.minY) / (this.profile.maxY - this.profile.minY)),
    };
    this.rawCursor = raw;
    const dt = this.lastTime === null ? 90 : clamp(timestamp - this.lastTime, 0, 150);
    const alpha = 1 - Math.exp(-dt / 90);
    this.cursor = this.cursor ? { x: this.cursor.x + alpha * (raw.x - this.cursor.x), y: this.cursor.y + alpha * (raw.y - this.cursor.y) } : raw;
    this.lastTime = timestamp;
  }

  private output(timestamp: number, started: boolean, released: boolean, separation: number, otherOpen: boolean, lost: boolean, valid = true, dominantRatio?: number, otherRatio?: number): GestureOutput {
    const trackingReady = valid && this.ready;
    return {
      timestamp, cursor: this.cursor ? { ...this.cursor } : null,
      dominantPinched: !this.singleHand && this.dominant.pinched, otherPinched: !this.singleHand && this.other.pinched,
      pinchStarted: !this.singleHand && started, pinchReleased: !this.singleHand && released,
      toolbarArmed: trackingReady && (this.singleHand || this.openSince !== null && timestamp - this.openSince >= 250),
      bothPinched: !this.singleHand && trackingReady && this.dominant.pinched && this.other.pinched,
      separation, trackingReady, trackingLost: lost, otherOpen,
      dominantRatio, otherRatio, pinchClosing: !this.singleHand && trackingReady && dominantRatio !== undefined && dominantRatio < this.profile.pinchClose,
      pinchOpening: !this.singleHand && trackingReady && this.dominant.pinched && dominantRatio !== undefined && dominantRatio >= this.profile.pinchOpen,
      otherPinchOpening: !this.singleHand && trackingReady && this.other.pinched && otherRatio !== undefined && otherRatio >= this.profile.pinchOpen,
      rawCursor: valid && this.rawCursor ? { ...this.rawCursor } : undefined,
    };
  }
}
