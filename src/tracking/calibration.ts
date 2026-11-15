import type { CalibrationProfile, TrackingFrame } from '../shared/types';
import { DEFAULT_PROFILE, isOpenHand, pinchRatio, sanitizeProfile, TRACKING_GAP_MS } from './gestures';

export interface CalibrationProgress {
  samples: number;
  pinchCycles: number;
  bothHandsVisible: boolean;
  rangeReady: boolean;
  otherHandVerified: boolean;
}

/** Collects only local landmark features. No camera images are retained. */
export class CalibrationSession {
  private profile: CalibrationProfile;
  private samples = 0;
  private cycles = 0;
  private pinched = false;
  private candidate: boolean | null = null;
  private candidateCount = 0;
  private minX = 1;
  private maxX = 0;
  private minY = 1;
  private maxY = 0;
  private lastValid: number | null = null;
  private verified = false;

  constructor(profile: CalibrationProfile = DEFAULT_PROFILE) { this.profile = sanitizeProfile(profile); }
  reset(): void {
    this.samples = 0; this.cycles = 0; this.pinched = false; this.candidate = null;
    this.candidateCount = 0; this.minX = 1; this.maxX = 0; this.minY = 1; this.maxY = 0;
    this.lastValid = null; this.verified = false;
  }
  update(frame: TrackingFrame): CalibrationProgress {
    const dominant = frame.hands.filter(hand => hand.handedness === this.profile.dominantHand);
    const other = frame.hands.filter(hand => hand.handedness !== this.profile.dominantHand);
    if (dominant.length !== 1 || !Number.isFinite(frame.timestamp) || frame.width <= 0 || frame.height <= 0) return this.progress(false);
    const ratio = pinchRatio(dominant[0], frame.width, frame.height);
    if (!Number.isFinite(ratio)) return this.progress(false);
    const tip = dominant[0].landmarks[8];
    this.samples++;
    const x = Math.min(1, Math.max(0, 1 - tip.x)), y = Math.min(1, Math.max(0, tip.y));
    this.minX = Math.min(this.minX, x); this.maxX = Math.max(this.maxX, x);
    this.minY = Math.min(this.minY, y); this.maxY = Math.max(this.maxY, y);
    // Keep collecting a comfortable pointer range if the other hand momentarily drops out.
    // Pinch verification still requires both valid hands.
    if (other.length !== 1 || !Number.isFinite(pinchRatio(other[0], frame.width, frame.height))) {
      this.candidate = null; this.candidateCount = 0;
      return this.progress(false);
    }
    if (this.lastValid !== null && frame.timestamp <= this.lastValid) return this.progress(false);
    if (this.lastValid !== null && frame.timestamp - this.lastValid >= TRACKING_GAP_MS) {
      this.pinched = false; this.candidate = null; this.candidateCount = 0;
    }
    this.lastValid = frame.timestamp;
    this.verified ||= isOpenHand(other[0], frame.width, frame.height, this.profile.pinchOpen);
    const next = this.pinched ? ratio < this.profile.pinchOpen : ratio < this.profile.pinchClose;
    if (next !== this.pinched) {
      if (next === this.candidate) this.candidateCount++;
      else { this.candidate = next; this.candidateCount = 1; }
      if (this.candidateCount >= 2) {
        if (this.pinched && !next) this.cycles++;
        this.pinched = next; this.candidateCount = 0; this.candidate = null;
      }
    } else { this.candidate = null; this.candidateCount = 0; }
    return this.progress(true);
  }
  finish(): CalibrationProfile {
    const progress = this.progress(true);
    if (this.samples < 12 || this.cycles < 3 || !progress.rangeReady || !this.verified) {
      throw new Error('Show both hands, move across your comfortable area, open the other hand, and perform three pinch-and-release cycles.');
    }
    const bounds = (min: number, max: number): [number, number] => {
      const span = Math.max(0.25, Math.min(1, max - min + 0.05));
      const low = Math.max(0, Math.min(1 - span, (min + max - span) / 2));
      return [low, low + span];
    };
    const [minX, maxX] = bounds(this.minX, this.maxX), [minY, maxY] = bounds(this.minY, this.maxY);
    return sanitizeProfile({
      ...this.profile, minX, maxX, minY, maxY,
      // Preserve the presenter's chosen sensitivity. Most calibration frames are open-hand
      // sweeps, so their ratio distribution is not a reliable estimate of pinch thresholds.
    });
  }
  private progress(bothHandsVisible: boolean): CalibrationProgress {
    return { samples: this.samples, pinchCycles: this.cycles, bothHandsVisible,
      rangeReady: this.samples > 0 && this.maxX - this.minX >= 0.18 && this.maxY - this.minY >= 0.18,
      otherHandVerified: this.verified };
  }
}
