import { describe, expect, it } from 'vitest';
import { TsmCadence } from './cadence';

describe('TSM camera cadence', () => {
  it.each([29.97, 30, 59.94, 60])('samples approximately 15 FPS on a %d FPS camera', rate => {
    const cadence = new TsmCadence();
    const retained = Array.from({ length: Math.floor(rate * 10) }, (_, index) => index / rate)
      .filter(timestamp => cadence.take(timestamp));
    expect(retained.length).toBeGreaterThanOrEqual(149);
    expect(retained.length).toBeLessThanOrEqual(151);
  });

  it('keeps every unique frame at 15 FPS and restarts cleanly', () => {
    const cadence = new TsmCadence();
    expect(Array.from({ length: 15 }, (_, index) => cadence.take(index / 15))).toEqual(Array(15).fill(true));
    expect(cadence.take(14 / 15)).toBe(false);
    cadence.reset();
    expect(cadence.take(0)).toBe(true);
  });

  it('does not catch up in a burst after the worker was busy', () => {
    const cadence = new TsmCadence();
    expect(cadence.take(0)).toBe(true);
    expect(cadence.take(.2)).toBe(true);
    expect(cadence.take(7 / 30)).toBe(false);
    expect(cadence.take(8 / 30)).toBe(true);
  });
});
