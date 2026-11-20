import { describe, expect, it } from 'vitest';
import type { TrackedHand } from '../shared/types';
import { FEATURE_COUNT, FeatureEncoder, NODE_COUNT, type LandmarkFrame } from './features';

function hand(handedness: TrackedHand['handedness'], wristX: number): TrackedHand {
  return {
    handedness, score: .92,
    landmarks: Array.from({ length: 21 }, (_, index) => ({ x: wristX, y: .5 - index / 90, z: 0 })),
  };
}
function frame(timestamp: number, hands: TrackedHand[]): LandmarkFrame {
  return { timestamp, width: 640, height: 480, hands, inferenceMs: 2 };
}

describe('learned feature contract', () => {
  it('puts the pointer hand first and keeps absent joint masks explicit', () => {
    const result = new FeatureEncoder().encode(frame(100, [hand('Right', .7), hand('Left', .3)]), 'Left');
    expect(result).toHaveLength(NODE_COUNT * FEATURE_COUNT);
    expect(result[3]).toBeCloseTo(.3);
    expect(result[21 * FEATURE_COUNT + 3]).toBeCloseTo(.7);
    expect(result[9 * FEATURE_COUNT + 1]).toBeCloseTo(-1);
    const missing = new FeatureEncoder().encode(frame(100, [hand('Right', .7)]), 'Left');
    expect(missing[9]).toBe(0);
    expect(missing[21 * FEATURE_COUNT + 9]).toBe(1);
  });

  it('masks stale shoulders and does not infer velocity across loss or reset', () => {
    const encoder = new FeatureEncoder();
    const shoulders = { timestamp: 100, left: { x: .25, y: .35, z: 0 }, right: { x: .75, y: .35, z: 0 } };
    const first = encoder.encode({ ...frame(100, [hand('Right', .5)]), shoulders }, 'Right');
    expect(first[5]).toBe(0);
    expect(first[10]).toBe(0);
    expect(first[12]).toBe(1);
    const next = encoder.encode({ ...frame(150, [hand('Right', .55)]), shoulders }, 'Right');
    expect(next[5]).toBeCloseTo(1);
    encoder.encode(frame(200, []), 'Right');
    const resumed = encoder.encode({ ...frame(410, [hand('Right', .7)]), shoulders }, 'Right');
    expect(resumed[5]).toBe(0);
    expect(resumed[12]).toBe(0);
    encoder.reset();
    expect(encoder.encode(frame(460, [hand('Right', .6)]), 'Right')[8]).toBe(0);
  });
});
