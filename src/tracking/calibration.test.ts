import { describe, expect, it } from 'vitest';
import { CalibrationSession } from './calibration';
import { DEFAULT_PROFILE } from './gestures';
import type { TrackedHand, TrackingFrame } from '../shared/types';

function hand(side: 'Left' | 'Right', ratio: number, dx = 0, dy = 0): TrackedHand {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5 + dx, y: 0.6 + dy, z: 0 }));
  landmarks[0] = { x: 0.5 + dx, y: 0.8 + dy, z: 0 };
  [5, 9, 13, 17].forEach((mcp, index) => {
    [0, 1, 2, 3].forEach(step => {
      landmarks[mcp + step] = { x: 0.4 + index * 0.06 + dx, y: 0.6 - step * 0.1 + dy, z: 0 };
    });
  });
  const palm = Math.hypot(landmarks[0].x - landmarks[9].x, (landmarks[0].y - landmarks[9].y) * 0.75);
  landmarks[4] = { x: landmarks[8].x + ratio * palm, y: landmarks[8].y, z: 0 };
  return { handedness: side, landmarks, score: 0.99 };
}

describe('calibration session', () => {
  it('rejects a finished calibration without movement and deliberate pinch cycles', () => {
    const session = new CalibrationSession();
    expect(() => session.finish()).toThrow(/three pinch-and-release/);
  });
  it('captures mirrored movement bounds, verifies the offhand and counts releases only once', () => {
    const session = new CalibrationSession();
    let progress;
    for (let i = 0; i < 18; i++) {
      const ratio = i % 6 === 2 || i % 6 === 3 ? 0.15 : 1.2;
      const offset = i % 2 ? 0.2 : -0.2;
      const frame: TrackingFrame = { timestamp: i * 30, width: 640, height: 480, inferenceMs: 10,
        hands: [hand('Right', ratio, offset, offset), hand('Left', 1.2)] };
      progress = session.update(frame);
    }
    expect(progress?.pinchCycles).toBe(3);
    expect(progress?.rangeReady).toBe(true);
    expect(progress?.otherHandVerified).toBe(true);
    const profile = session.finish();
    expect(profile.minX).toBeCloseTo(0.375);
    expect(profile.maxX).toBeCloseTo(0.825);
    expect(profile.pinchOpen).toBeGreaterThan(profile.pinchClose);
  });
  it('ignores ambiguous hands and clears samples on reset', () => {
    const session = new CalibrationSession();
    const progress = session.update({ timestamp: 0, width: 640, height: 480, inferenceMs: 0,
      hands: [hand('Right', 1.2), hand('Right', 1.2)] });
    expect(progress.bothHandsVisible).toBe(false);
    expect(progress.samples).toBe(0);
    session.reset();
    expect(() => session.finish()).toThrow();
  });
  it('preserves the selected pinch sensitivity and accepts a comfortable smaller movement range', () => {
    const session = new CalibrationSession({ dominantHand: 'Right', minX: 0.12, maxX: 0.88, minY: 0.12, maxY: 0.88, pinchClose: 0.4, pinchOpen: 0.62 });
    let progress;
    for (let i = 0; i < 18; i++) {
      const ratio = i % 6 === 2 || i % 6 === 3 ? 0.35 : 1.2;
      const offset = i % 2 ? 0.1 : -0.1;
      progress = session.update({ timestamp: i * 30, width: 640, height: 480, inferenceMs: 0,
        hands: [hand('Right', ratio, offset, offset), hand('Left', 1.2)] });
    }
    expect(progress?.rangeReady).toBe(true);
    const profile = session.finish();
    expect(profile.pinchClose).toBe(0.4); expect(profile.pinchOpen).toBe(0.62);
    expect(profile.maxX - profile.minX).toBeGreaterThanOrEqual(0.25);
  });
  it('records pointer range while the offhand briefly drops out without counting a click', () => {
    const session = new CalibrationSession();
    session.update({ timestamp: 0, width: 640, height: 480, inferenceMs: 0, hands: [hand('Right', 1.2, -0.15, -0.15)] });
    const progress = session.update({ timestamp: 30, width: 640, height: 480, inferenceMs: 0, hands: [hand('Right', 1.2, 0.15, 0.15)] });
    expect(progress.bothHandsVisible).toBe(false); expect(progress.rangeReady).toBe(true);
    expect(progress.pinchCycles).toBe(0);
  });
});

describe('one-hand range-only calibration', () => {
  const sample = (timestamp: number, offset: number, side: 'Left' | 'Right' = 'Right'): TrackingFrame => ({
    timestamp, width: 640, height: 480, inferenceMs: 0, hands: [hand(side, 0.1, offset, offset)],
  });
  it('calibrates comfortable range without an offhand, open-palm pose or pinch cycles', () => {
    const session = new CalibrationSession(DEFAULT_PROFILE, { singleHand: true });
    let progress;
    for (let index = 0; index < 12; index++) progress = session.update(sample(index * 40, index % 2 ? 0.1 : -0.1));
    expect(progress).toMatchObject({ samples: 12, pointerVisible: true, bothHandsVisible: false, otherHandVerified: false,
      pinchCycles: 0, rangeReady: true });
    const profile = session.finish();
    expect(profile.maxX - profile.minX).toBeGreaterThanOrEqual(0.25);
    expect(profile.maxY - profile.minY).toBeGreaterThanOrEqual(0.25);
    expect(profile.pinchClose).toBe(DEFAULT_PROFILE.pinchClose);
    expect(profile.pinchOpen).toBe(DEFAULT_PROFILE.pinchOpen);
  });
  it('still requires enough samples and useful movement in both axes', () => {
    const insufficient = new CalibrationSession(DEFAULT_PROFILE, { singleHand: true });
    for (let index = 0; index < 11; index++) insufficient.update(sample(index * 40, index % 2 ? 0.2 : -0.2));
    expect(() => insufficient.finish()).toThrow(/comfortable area/);
    const stationary = new CalibrationSession(DEFAULT_PROFILE, { singleHand: true });
    for (let index = 0; index < 12; index++) stationary.update(sample(index * 40, 0));
    expect(() => stationary.finish()).toThrow(/comfortable area/);
  });
  it('rejects wrong and ambiguous identities and supports a configured left pointer', () => {
    const session = new CalibrationSession({ ...DEFAULT_PROFILE, dominantHand: 'Left' }, { singleHand: true });
    expect(session.update(sample(0, 0)).samples).toBe(0);
    const ambiguous = sample(40, 0, 'Left'); ambiguous.hands.push(hand('Left', 1.2));
    expect(session.update(ambiguous)).toMatchObject({ samples: 0, pointerVisible: false });
    for (let index = 0; index < 12; index++) session.update(sample(80 + index * 40, index % 2 ? 0.1 : -0.1, 'Left'));
    expect(session.finish().dominantHand).toBe('Left');
  });
  it('does not count duplicate or out-of-order samples or let them enlarge the range', () => {
    const session = new CalibrationSession(DEFAULT_PROFILE, { singleHand: true });
    session.update(sample(100, 0));
    for (const time of [100, 99, 20]) expect(session.update(sample(time, 0.3)).samples).toBe(1);
    const progress = session.update(sample(140, 0));
    expect(progress.samples).toBe(2); expect(progress.rangeReady).toBe(false);
  });
  it('rejects invalid landmarks and confidence and reset clears all range evidence', () => {
    const session = new CalibrationSession(DEFAULT_PROFILE, { singleHand: true });
    const incomplete = sample(0, 0); incomplete.hands[0].landmarks.pop();
    const nonfinite = sample(40, 0); nonfinite.hands[0].landmarks[8].x = NaN;
    const uncertain = sample(80, 0); uncertain.hands[0].score = 0.1;
    const degenerate = sample(100, 0); degenerate.hands[0].landmarks[9] = { ...degenerate.hands[0].landmarks[0] };
    for (const invalid of [incomplete, nonfinite, uncertain, degenerate]) expect(session.update(invalid)).toMatchObject({ samples: 0, pointerVisible: false });
    for (let index = 0; index < 12; index++) session.update(sample(120 + index * 40, index % 2 ? 0.1 : -0.1));
    expect(() => session.finish()).not.toThrow();
    session.reset(); expect(() => session.finish()).toThrow(/comfortable area/);
    expect(session.update(sample(0, 0)).samples).toBe(1);
  });
});
