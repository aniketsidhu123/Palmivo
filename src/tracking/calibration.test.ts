import { describe, expect, it } from 'vitest';
import { CalibrationSession } from './calibration';
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
