import type { Tool } from '../shared/types';

export type TsmTool = Extract<Tool, 'box' | 'cylinder' | 'union'>;
export const TSM_MAX_GAP_MS = 250;
export const TSM_SHORTCUTS = {
  16: { tool: 'box', gesture: 'Swipe left', label: 'Box' },
  17: { tool: 'cylinder', gesture: 'Swipe right', label: 'Cylinder' },
  20: { tool: 'union', gesture: 'Thumbs up', label: 'Union' },
} as const satisfies Record<number, { tool: TsmTool; gesture: string; label: string }>;

type Shortcut = typeof TSM_SHORTCUTS[keyof typeof TSM_SHORTCUTS];
export interface TsmPrediction {
  ready: boolean;
  shortcut: Shortcut | null;
  confidence: number;
  accepted: Shortcut | null;
  unionUnavailable?: true;
}

interface GestureEvidence {
  shortcut: Shortcut;
  firstMatch: number;
  matches: number;
  misses: number;
}

const SWIPE_CONFIDENCE = .68;
const THUMB_CONFIDENCE = .75;
const COMPETING_CONFIDENCE = .55;
const SWIPE_WINDOW_MS = 210;
const THUMB_WINDOW_MS = 330;

/** Each listening session must see neutral input before it can open one draft. */
export class TsmShortcutGate {
  private timestamp = -Infinity;
  private observed = 0;
  private neutral = 0;
  private ready = false;
  private accepted = false;
  private evidence: GestureEvidence | null = null;

  reset(): void {
    this.timestamp = -Infinity;
    this.observed = 0;
    this.neutral = 0;
    this.ready = false;
    this.accepted = false;
    this.evidence = null;
  }

  step(logits: Float32Array, timestamp: number, unionAvailable = true): TsmPrediction {
    if (logits.length !== 27 || !logits.every(Number.isFinite)) throw new Error('Invalid MIT TSM prediction.');
    if (!Number.isFinite(timestamp) || timestamp <= this.timestamp) {
      return { ready: this.ready, shortcut: null, confidence: 0, accepted: null };
    }
    // A completed attempt stays consumed until an explicit reset.
    if (!this.accepted && timestamp - this.timestamp > TSM_MAX_GAP_MS) this.reset();
    this.timestamp = timestamp;
    this.observed++;
    let winner = 0;
    for (let index = 1; index < logits.length; index++) {
      if (logits[index] > logits[winner]) winner = index;
    }
    const confidence = 1 / logits.reduce((sum, logit) => sum + Math.exp(logit - logits[winner]), 0);
    const shortcut = TSM_SHORTCUTS[winner as keyof typeof TSM_SHORTCUTS] ?? null;
    if (!this.ready) {
      this.neutral = (winner === 0 || winner === 2) && confidence >= .55 ? this.neutral + 1 : 0;
      this.ready = this.observed >= 4 && this.neutral >= 2;
      return { ready: this.ready, shortcut: null, confidence, accepted: null };
    }
    if (this.accepted) return { ready: true, shortcut: null, confidence, accepted: null };
    if (shortcut?.tool === 'union' && !unionAvailable) {
      // An impossible tool cannot consume the listening attempt or contribute
      // to a later Union. A weak prediction can still be the swipe's one miss.
      if (confidence >= COMPETING_CONFIDENCE || this.evidence?.shortcut.tool === 'union') {
        this.evidence = null;
        return { ready: true, shortcut: null, confidence, accepted: null, unionUnavailable: true };
      }
    }

    const evidence = this.evidence;
    if (evidence && timestamp - evidence.firstMatch >
      (evidence.shortcut.tool === 'union' ? THUMB_WINDOW_MS : SWIPE_WINDOW_MS)) {
      this.evidence = null;
    }
    const threshold = shortcut?.tool === 'union' ? THUMB_CONFIDENCE : SWIPE_CONFIDENCE;
    if (!shortcut || confidence < threshold) {
      // A swipe is brief. Keep its prior direction across one neutral or weak
      // prediction, but cancel it immediately for a credible competing label.
      const neutral = winner === 0 || winner === 2;
      if (this.evidence) {
        const competing = !neutral && shortcut !== this.evidence.shortcut && confidence >= COMPETING_CONFIDENCE;
        this.evidence.misses++;
        if (this.evidence.shortcut.tool === 'union' || competing || this.evidence.misses > 1) this.evidence = null;
      }
      return { ready: true, shortcut: null, confidence, accepted: null };
    }

    if (this.evidence?.shortcut !== shortcut) {
      this.evidence = { shortcut, firstMatch: timestamp, matches: 1, misses: 0 };
    } else {
      this.evidence.matches++;
    }
    const thumb = shortcut.tool === 'union';
    if (this.evidence.matches >= (thumb ? 3 : 2) && timestamp - this.evidence.firstMatch >= (thumb ? 110 : 55)) {
      this.accepted = true;
      return { ready: true, shortcut, confidence, accepted: shortcut };
    }
    return { ready: true, shortcut, confidence, accepted: null };
  }
}
