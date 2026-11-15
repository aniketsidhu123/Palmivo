import { describe, expect, it } from 'vitest';
import type { GestureOutput } from '../shared/types';
import { ScaleSession } from './manipulation';
import { TRACKING_GAP_MS } from './gestures';

function sample(timestamp: number, separation = 0.3, overrides: Partial<GestureOutput> = {}): GestureOutput {
  return { timestamp, cursor: { x: 0.5, y: 0.5 }, dominantPinched: true, otherPinched: true,
    pinchStarted: false, pinchReleased: false, toolbarArmed: false, bothPinched: true,
    separation, trackingReady: true, trackingLost: false, otherOpen: false, ...overrides };
}
const released = (timestamp: number) => sample(timestamp, 0.3, { otherPinched: false, bothPinched: false });
const missing = (timestamp: number) => sample(timestamp, 0, { trackingReady: false, bothPinched: false });

describe('continuous scale session', () => {
  it('captures a baseline without changing the visible scale', () => {
    const session = new ScaleSession(1.4);
    expect(session.update(released(0))).toEqual({ value: 1.4, changed: false, phase: 'ready' });
    expect(session.update(sample(33))).toEqual({ value: 1.4, changed: false, phase: 'active' });
  });

  it('substantially reduces repeated separation noise and suppresses tiny output changes', () => {
    const session = new ScaleSession(1); session.update(sample(0));
    const values: number[] = [], raw: number[] = [];
    for (let i = 1; i <= 120; i++) {
      const ratio = 1 + (i % 2 ? 0.012 : -0.012);
      raw.push(ratio); values.push(session.update(sample(i * 1000 / 60, 0.3 * ratio)).value);
    }
    const deviation = (values: number[]) => Math.sqrt(values.reduce((sum, value) => sum + (value - 1) ** 2, 0) / values.length);
    expect(deviation(values)).toBeLessThan(deviation(raw) / 3);
    expect(new Set(values).size).toBeLessThan(30);
    const quiet = new ScaleSession(1); quiet.update(sample(0));
    for (let i = 1; i < 60; i++) expect(quiet.update(sample(i * 16, 0.3 * (1 + (i % 2 ? 0.001 : -0.001)))).changed).toBe(false);
  });

  it('uses timestamp-based filtering with comparable responses at 13, 30 and 60 FPS', () => {
    const values = [13, 30, 60].map(fps => {
      const session = new ScaleSession(1); session.update(sample(0));
      const step = 1000 / fps;
      for (let i = 1; i <= Math.floor(200 / step); i++) session.update(sample(i * step, 0.42));
      return session.update(sample(200, 0.42)).value;
    });
    expect(Math.max(...values) - Math.min(...values)).toBeLessThan(0.003);
    values.forEach(value => expect(value).toBeCloseTo(1 + 0.4 * (1 - Math.exp(-200 / 70)), 2));
  });

  it('settles a stable precise endpoint inside the deadband rather than leaving a permanent offset', () => {
    const session = new ScaleSession(1); session.update(sample(0));
    for (let i = 1; i <= 60; i++) session.update(sample(i * 1000 / 60, 0.3 * 1.2537));
    expect(session.value).toBeCloseTo(1.2537, 10);
    const held = session.value;
    expect(session.update(released(1010))).toEqual({ value: held, changed: false, phase: 'held' });
    expect(session.update(released(1100)).value).toBe(held);
  });

  it('freezes exactly on release and captures a new grip from the held scale', () => {
    const session = new ScaleSession(1); session.update(sample(0));
    for (let time = 20; time <= 200; time += 20) session.update(sample(time, 0.36));
    const held = session.value;
    expect(session.update(released(220)).value).toBe(held);
    expect(session.update(sample(240, 0.5)).value).toBe(held);
    const resumed = session.update(sample(310, 0.55));
    expect(resumed.value).toBeGreaterThan(held);
    expect(resumed.value).toBeCloseTo(held * (1 + 0.1 * (1 - Math.exp(-1))), 10);
  });

  it('freezes invalid samples and preserves the original baseline across a short tracking gap', () => {
    const session = new ScaleSession(1); session.update(sample(0));
    session.update(sample(70, 0.36)); const held = session.value;
    expect(session.update(missing(140))).toEqual({ value: held, changed: false, phase: 'paused' });
    expect(session.update(sample(220, 0.42))).toEqual({ value: held, changed: false, phase: 'active' });
    // Filter continues from its previous measured separation with the original 0.3 baseline.
    const next = session.update(sample(290, 0.42));
    expect(next.value).toBeCloseTo(held + (1.4 - held) * (1 - Math.exp(-1)), 10);
  });

  it('does not divide by a near-zero separation or rebase when pinched hands briefly overlap', () => {
    const session = new ScaleSession(1);
    expect(session.update(sample(0, 0.01)).changed).toBe(false);
    expect(session.phase).toBe('paused');
    session.update(sample(30, 0.3)); session.update(sample(100, 0.36)); const held = session.value;
    expect(session.update(sample(130, 0.04)).value).toBe(held);
    expect(session.update(sample(170, 0.42)).value).toBe(held);
    expect(session.update(sample(240, 0.42)).value).toBeCloseTo(held + (1.4 - held) * (1 - Math.exp(-1)), 10);
  });

  it('requires release after a genuine tracking gap and never resumes a lost held pinch as a new grip', () => {
    const session = new ScaleSession(1); session.update(sample(0)); session.update(sample(70, 0.36));
    const held = session.value;
    session.update(missing(70 + TRACKING_GAP_MS));
    expect(session.update(sample(350, 0.6, { pinchOpening: true }))).toEqual({ value: held, changed: false, phase: 'paused' });
    expect(session.update(sample(420, 0.6)).changed).toBe(false);
    expect(session.update(released(450)).phase).toBe('held');
    expect(session.update(sample(480, 0.6)).value).toBe(held);
    expect(session.update(sample(550, 0.66)).value).toBeGreaterThan(held);
  });

  it('also detects long gaps without an explicit invalid callback', () => {
    const session = new ScaleSession(1); session.update(sample(0));
    expect(session.update(sample(TRACKING_GAP_MS, 0.6))).toEqual({ value: 1, changed: false, phase: 'paused' });
  });

  it('accepts an in-flight valid capture older than the watchdog but newer than the last valid packet', () => {
    const session = new ScaleSession(1); session.update(sample(1000));
    expect(session.update(missing(1120))).toEqual({ value: 1, changed: false, phase: 'paused' });
    expect(session.update(sample(1110, 0.36))).toEqual({ value: 1, changed: false, phase: 'active' });
    expect(session.update(sample(1110, 3)).changed).toBe(false);
    expect(session.update(sample(1100, 3)).changed).toBe(false);
    // Same original 0.3 baseline and one ordinary 70 ms filter interval after recovery.
    expect(session.update(sample(1180, 0.42)).value).toBeCloseTo(1 + 0.4 * (1 - Math.exp(-1)), 10);
  });

  it('keeps a long watchdog loss latched even when an earlier held capture arrives later', () => {
    const session = new ScaleSession(1); session.update(sample(1000));
    session.update(missing(1000 + TRACKING_GAP_MS));
    expect(session.update(sample(1210, 0.6))).toEqual({ value: 1, changed: false, phase: 'paused' });
    expect(session.update(sample(1280, 0.6))).toEqual({ value: 1, changed: false, phase: 'paused' });
    expect(session.update(released(1310)).phase).toBe('held');
    expect(session.update(sample(1340, 0.6))).toEqual({ value: 1, changed: false, phase: 'active' });
  });

  it('rejects replayed samples and clamps the valid preview to the CAD scale limits', () => {
    const session = new ScaleSession(1); session.update(sample(0));
    expect(session.update(sample(0, 10)).changed).toBe(false);
    expect(session.update(sample(-1, 10)).changed).toBe(false);
    for (let time = 50; time <= 500; time += 50) session.update(sample(time, 3));
    expect(session.value).toBe(2);
  });

  it('reset discards old baselines after manual adjustment or a new draft', () => {
    const session = new ScaleSession(1); session.update(sample(0)); session.update(sample(70, 0.42));
    session.reset(0.8);
    expect(session.value).toBe(0.8); expect(session.phase).toBe('ready');
    expect(session.update(sample(100, 0.6)).value).toBe(0.8);
    expect(session.update(sample(170, 0.66)).value).toBeCloseTo(0.8 * (1 + 0.1 * (1 - Math.exp(-1))), 10);
  });

  it.each(['pinchOpening', 'otherPinchOpening'] as const)('freezes on first raw %s before the latch confirms release', openingKey => {
    const session = new ScaleSession(1); session.update(sample(0));
    for (let i = 1; i <= 60; i++) session.update(sample(i * 1000 / 60, 0.42));
    expect(session.value).toBeCloseTo(1.4, 10);
    const held = session.value;
    // Finger opening changes measured hand separation while both pinch latches still read true.
    expect(session.update(sample(1030, 0.3, { [openingKey]: true }))).toEqual({ value: held, changed: false, phase: 'held' });
    expect(session.update(sample(1060, 0.6))).toEqual({ value: held, changed: false, phase: 'held' });
    expect(session.update(released(1090))).toEqual({ value: held, changed: false, phase: 'held' });
    expect(session.update(sample(1120, 0.6))).toEqual({ value: held, changed: false, phase: 'active' });
    expect(session.update(sample(1190, 0.66)).value).toBeGreaterThan(held);
  });

  it('marks a genuine tracking loss during pending release as paused and keeps release required', () => {
    const session = new ScaleSession(1); session.update(sample(0)); session.update(sample(70, 0.42));
    const held = session.value;
    session.update(sample(100, 0.3, { pinchOpening: true }));
    expect(session.update(missing(100 + TRACKING_GAP_MS))).toEqual({ value: held, changed: false, phase: 'paused' });
    expect(session.update(sample(350, 0.6))).toEqual({ value: held, changed: false, phase: 'paused' });
    expect(session.update(released(380)).phase).toBe('held');
  });
});
