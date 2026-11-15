import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, GestureRecognizer, isOpenHand, pinchRatio, sanitizeProfile, TRACKING_GAP_MS } from './gestures';
import type { TrackedHand, TrackingFrame } from '../shared/types';

function hand(side: 'Left' | 'Right', ratio = 1.2, offset = 0): TrackedHand {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5 + offset, y: 0.7, z: 0 }));
  landmarks[0] = { x: 0.5 + offset, y: 0.8, z: 0 };
  [5, 9, 13, 17].forEach((mcp, i) => {
    const x = 0.4 + i * 0.06 + offset;
    landmarks[mcp] = { x, y: 0.6, z: 0 };
    landmarks[mcp + 1] = { x, y: 0.5, z: 0 };
    landmarks[mcp + 2] = { x, y: 0.4, z: 0 };
    landmarks[mcp + 3] = { x, y: 0.3, z: 0 };
  });
  const palm = Math.hypot(landmarks[0].x - landmarks[9].x, (landmarks[0].y - landmarks[9].y) * 0.75);
  landmarks[4] = { x: landmarks[8].x + ratio * palm, y: landmarks[8].y, z: 0 };
  return { handedness: side, score: 0.95, landmarks };
}
function frame(timestamp: number, dominant = 1.2, other = 1.2): TrackingFrame {
  return { timestamp, width: 640, height: 480, inferenceMs: 10, hands: [hand('Right', dominant, 0.15), hand('Left', other, -0.15)] };
}
function warm(recognizer: GestureRecognizer): void { [0, 100, 200, 300].forEach(time => recognizer.process(frame(time))); }

describe('hand features', () => {
  it('measures palm-normalized pinch ratio without camera aspect distortion', () => {
    expect(pinchRatio(hand('Right', 0.2), 640, 480)).toBeCloseTo(0.2);
    expect(isOpenHand(hand('Left'), 640, 480)).toBe(true);
    expect(isOpenHand(hand('Left', 0.2), 640, 480)).toBe(false);
  });
  it('rejects incomplete, degenerate and nonfinite landmarks', () => {
    const invalid = hand('Right'); invalid.landmarks.pop();
    expect(pinchRatio(invalid, 640, 480)).toBe(Infinity);
    expect(isOpenHand(invalid, 640, 480)).toBe(false);
    const nonfinite = hand('Right'); nonfinite.landmarks[0].x = NaN;
    expect(pinchRatio(nonfinite, 640, 480)).toBe(Infinity);
  });
  it('accepts a relaxed palm with three extended fingers and rejects a mostly folded hand', () => {
    const relaxed = hand('Left');
    relaxed.landmarks[20].y = 0.7;
    expect(isOpenHand(relaxed, 640, 480)).toBe(true);
    relaxed.landmarks[16].y = 0.7;
    expect(isOpenHand(relaxed, 640, 480)).toBe(false);
  });
  it('accepts moderately bent extended fingers instead of requiring a perfectly flat palm', () => {
    const relaxed = hand('Left');
    for (const mcp of [5, 9, 13]) {
      const joint = relaxed.landmarks[mcp + 1];
      relaxed.landmarks[mcp + 3] = {
        x: joint.x + Math.sin(140 * Math.PI / 180) * 0.2,
        y: joint.y + Math.cos(140 * Math.PI / 180) * 0.2 / 0.75, z: 0,
      };
    }
    relaxed.landmarks[20].y = 0.7;
    relaxed.landmarks[4].x = relaxed.landmarks[8].x + 0.2;
    expect(isOpenHand(relaxed, 640, 480)).toBe(true);
  });
  it('sanitizes persisted calibration and enforces a useful movement range', () => {
    const profile = sanitizeProfile({ ...DEFAULT_PROFILE, minX: NaN, maxX: 0, pinchClose: 9, pinchOpen: 0 });
    expect(profile.minX).toBe(0.12);
    expect(profile.maxX - profile.minX).toBeGreaterThanOrEqual(0.25);
    expect(profile.pinchOpen).toBeGreaterThan(profile.pinchClose);
  });
});

describe('temporal gesture recognizer', () => {
  it('requires stable neutral tracking before controls can arm', () => {
    const recognizer = new GestureRecognizer();
    expect(recognizer.process(frame(0)).trackingReady).toBe(false);
    recognizer.process(frame(100)); recognizer.process(frame(200));
    expect(recognizer.process(frame(299)).trackingReady).toBe(false);
    const ready = recognizer.process(frame(300));
    expect(ready.trackingReady).toBe(true);
    expect(ready.toolbarArmed).toBe(true);
  });
  it('debounces two observations, uses hysteresis and emits a single rising edge', () => {
    const recognizer = new GestureRecognizer(); warm(recognizer);
    expect(recognizer.process(frame(400, 0.2)).pinchStarted).toBe(false);
    expect(recognizer.process(frame(416, 0.2)).pinchStarted).toBe(true);
    expect(recognizer.process(frame(432, 0.2)).pinchStarted).toBe(false);
    expect(recognizer.process(frame(448, 0.35)).dominantPinched).toBe(true);
    expect(recognizer.process(frame(464, 0.6)).pinchReleased).toBe(false);
    expect(recognizer.process(frame(480, 0.6)).pinchReleased).toBe(true);
    expect(recognizer.process(frame(496, 0.6)).pinchReleased).toBe(false);
  });
  it('never treats missing hands as pinch release and requires neutral reacquisition', () => {
    const recognizer = new GestureRecognizer(); warm(recognizer);
    recognizer.process(frame(400, 0.2)); recognizer.process(frame(416, 0.2));
    const missing = recognizer.missing(450);
    expect(missing.pinchReleased).toBe(false); expect(missing.trackingReady).toBe(false);
    expect(missing.dominantPinched).toBe(true);
    expect(recognizer.missing(650).trackingLost).toBe(true);
    expect(recognizer.process(frame(700, 0.2)).trackingReady).toBe(false);
    [800, 900, 1000].forEach(time => recognizer.process(frame(time, 0.2)));
    expect(recognizer.process(frame(1100, 0.2)).trackingReady).toBe(false);
    const recovered = recognizer.process(frame(1116));
    expect(recovered.trackingReady).toBe(true); expect(recovered.pinchReleased).toBe(false);
    expect(recovered.dominantPinched).toBe(false);
  });
  it('freezes when handedness is ambiguous instead of assigning roles by screen position', () => {
    const recognizer = new GestureRecognizer(); warm(recognizer);
    const ambiguous = frame(400); ambiguous.hands[1].handedness = 'Right';
    expect(recognizer.process(ambiguous).trackingReady).toBe(false);
  });
  it('mirrors pointer x exactly once, then smooths movement', () => {
    const recognizer = new GestureRecognizer({ ...DEFAULT_PROFILE, minX: 0, maxX: 1, minY: 0, maxY: 1 });
    const first = recognizer.process(frame(0));
    expect(first.cursor?.x).toBeCloseTo(1 - 0.55);
    const moved = frame(16); moved.hands[0].landmarks[8].x = 0.7;
    const next = recognizer.process(moved);
    expect(next.cursor!.x).toBeLessThan(first.cursor!.x);
    expect(next.cursor!.x).toBeGreaterThan(0.3);
  });
  it('requires rearming when the dominant-hand profile changes', () => {
    const recognizer = new GestureRecognizer(); warm(recognizer);
    recognizer.setProfile({ ...DEFAULT_PROFILE, dominantHand: 'Left' });
    expect(recognizer.process(frame(500)).trackingReady).toBe(false);
  });
  it('only reports dual pinch after both independent latches stabilize', () => {
    const recognizer = new GestureRecognizer(); warm(recognizer);
    expect(recognizer.process(frame(400, 0.2, 0.2)).bothPinched).toBe(false);
    const output = recognizer.process(frame(416, 0.2, 0.2));
    expect(output.bothPinched).toBe(true); expect(output.toolbarArmed).toBe(false);
    expect(output.separation).toBeGreaterThan(0.2);
  });
  it('survives one missing frame without forcing another neutral hold', () => {
    const recognizer = new GestureRecognizer(); warm(recognizer);
    const missing = recognizer.missing(316);
    expect(missing.trackingReady).toBe(false); expect(missing.toolbarArmed).toBe(false);
    expect(missing.pinchClosing).toBe(false); expect(missing.pinchStarted).toBe(false);
    const recovered = recognizer.process(frame(332));
    expect(recovered.trackingReady).toBe(true); expect(recovered.toolbarArmed).toBe(true);
    expect(recovered.pinchStarted).toBe(false); expect(recovered.pinchReleased).toBe(false);
    expect(recognizer.process(frame(348, 0.2)).pinchStarted).toBe(false);
    expect(recognizer.process(frame(364, 0.2)).pinchStarted).toBe(true);
  });
  it('does not generate a second click for a held pinch after a short dropout', () => {
    const recognizer = new GestureRecognizer(); warm(recognizer);
    recognizer.process(frame(316, 0.2));
    expect(recognizer.process(frame(332, 0.2)).pinchStarted).toBe(true);
    recognizer.missing(348);
    const resumed = recognizer.process(frame(364, 0.2));
    expect(resumed.dominantPinched).toBe(true); expect(resumed.pinchStarted).toBe(false);
    expect(recognizer.process(frame(380, 0.2)).pinchStarted).toBe(false);
  });
  it('preserves readiness across one bad frame at 13 FPS without repeating a held click', () => {
    const recognizer = new GestureRecognizer(); warm(recognizer);
    recognizer.process(frame(376.9, 0.2));
    expect(recognizer.process(frame(453.8, 0.2)).pinchStarted).toBe(true);
    const missing = recognizer.missing(530.7);
    expect(missing.trackingReady).toBe(false); expect(missing.trackingLost).toBe(false);
    expect(missing.pinchStarted).toBe(false); expect(missing.toolbarArmed).toBe(false);
    const recovered = recognizer.process(frame(607.6, 0.2));
    expect(recovered.trackingReady).toBe(true); expect(recovered.dominantPinched).toBe(true);
    expect(recovered.pinchStarted).toBe(false); expect(recovered.pinchReleased).toBe(false);
    expect(recognizer.process(frame(684.5, 0.2)).pinchStarted).toBe(false);
  });
  it('suppresses a pinch that begins while a hand is missing until the presenter releases it', () => {
    const recognizer = new GestureRecognizer(); warm(recognizer); recognizer.missing(316);
    expect(recognizer.process(frame(332, 0.2)).pinchStarted).toBe(false);
    expect(recognizer.process(frame(348, 0.2)).pinchStarted).toBe(false);
    recognizer.process(frame(364)); recognizer.process(frame(380));
    recognizer.process(frame(396, 0.2));
    expect(recognizer.process(frame(412, 0.2)).pinchStarted).toBe(true);
  });
  it('requires neutral rearming after a timestamp gap even without an explicit missing callback', () => {
    const recognizer = new GestureRecognizer(); warm(recognizer);
    const stale = recognizer.process(frame(300 + TRACKING_GAP_MS, 0.2));
    expect(stale.trackingReady).toBe(false); expect(stale.pinchStarted).toBe(false);
    [625, 725].forEach(time => expect(recognizer.process(frame(time, 0.2)).trackingReady).toBe(false));
    const neutral = recognizer.process(frame(825));
    expect(neutral.trackingReady).toBe(true); expect(neutral.pinchReleased).toBe(false);
  });
  it('does not count duplicate or out-of-order frames toward a pinch edge', () => {
    const recognizer = new GestureRecognizer(); warm(recognizer);
    expect(recognizer.process(frame(316, 0.2)).pinchStarted).toBe(false);
    expect(recognizer.process(frame(316, 0.2)).pinchStarted).toBe(false);
    expect(recognizer.process(frame(310, 0.2)).pinchStarted).toBe(false);
    expect(recognizer.process(frame(332, 0.2)).pinchStarted).toBe(true);
  });
  it('holds toolbar arming across brief finger-pose jitter but revokes it for a pinch immediately', () => {
    const recognizer = new GestureRecognizer(); warm(recognizer);
    const jitter = (timestamp: number) => {
      const sample = frame(timestamp); sample.hands[1].landmarks[16].y = 0.7; sample.hands[1].landmarks[20].y = 0.7;
      return sample;
    };
    expect(recognizer.process(jitter(316)).toolbarArmed).toBe(true);
    expect(recognizer.process(jitter(400)).toolbarArmed).toBe(true);
    expect(recognizer.process(jitter(432)).toolbarArmed).toBe(false);
    expect(recognizer.process(frame(448)).toolbarArmed).toBe(false);
    [548, 648, 704].forEach(timestamp => recognizer.process(frame(timestamp)));
    expect(recognizer.process(frame(720)).toolbarArmed).toBe(true);
    expect(recognizer.process(frame(736, 1.2, 0.2)).toolbarArmed).toBe(false);
  });
  it('exposes raw closing before the latched click and measured ratios for feedback', () => {
    const recognizer = new GestureRecognizer(); warm(recognizer);
    const closing = recognizer.process(frame(316, 0.3));
    expect(closing.pinchClosing).toBe(true); expect(closing.pinchStarted).toBe(false);
    expect(closing.dominantRatio).toBeCloseTo(0.3); expect(closing.otherRatio).toBeCloseTo(1.2);
    expect(closing.rawCursor).toBeDefined();
    expect(recognizer.process(frame(332, 0.3)).pinchStarted).toBe(true);
  });
});
