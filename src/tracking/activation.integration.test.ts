import { describe, expect, it } from 'vitest';
import { GestureRecognizer, DEFAULT_PROFILE } from './gestures';
import { TargetActivation } from './activation';
import type { GestureOutput, TrackedHand, TrackingFrame } from '../shared/types';

const VIEW = { width: 1440, height: 900 };
const baseline = {
  x: ((1 - 0.55 - DEFAULT_PROFILE.minX) / (DEFAULT_PROFILE.maxX - DEFAULT_PROFILE.minX)) * VIEW.width,
  y: ((0.3 - DEFAULT_PROFILE.minY) / (DEFAULT_PROFILE.maxY - DEFAULT_PROFILE.minY)) * VIEW.height,
};
// The pointer starts five pixels inside the right edge. Closing the index finger
// shifts the real cursor beyond the hit rect before the debounced pinch edge.
const button = { left: baseline.x - 65, right: baseline.x + 5, top: baseline.y - 30, bottom: baseline.y + 30 };

function skeletalHand(side: 'Left' | 'Right', ratio: number, offset: number, pointerShiftPx = 0, foldedFingers = 0): TrackedHand {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5 + offset, y: 0.7, z: 0 }));
  landmarks[0] = { x: 0.5 + offset, y: 0.8, z: 0 };
  [5, 9, 13, 17].forEach((mcp, index) => {
    const x = 0.4 + index * 0.06 + offset;
    landmarks[mcp] = { x, y: 0.6, z: 0 };
    landmarks[mcp + 1] = { x, y: 0.5, z: 0 };
    landmarks[mcp + 2] = { x, y: 0.4, z: 0 };
    landmarks[mcp + 3] = { x, y: 0.3, z: 0 };
  });
  // Convert desired raw screen movement back into normalized image displacement.
  landmarks[8].x -= pointerShiftPx * (DEFAULT_PROFILE.maxX - DEFAULT_PROFILE.minX) / VIEW.width;
  const palm = Math.hypot(landmarks[0].x - landmarks[9].x, (landmarks[0].y - landmarks[9].y) * 480 / 640);
  landmarks[4] = { x: landmarks[8].x + ratio * palm, y: landmarks[8].y, z: 0 };
  if (foldedFingers >= 1) landmarks[20].y = 0.7;
  if (foldedFingers >= 2) landmarks[16].y = 0.7;
  return { handedness: side, score: 0.95, landmarks };
}

interface FrameOptions { dominantRatio?: number; otherRatio?: number; shiftPx?: number; foldedOffhand?: number; missing?: boolean }
class RealPipeline {
  readonly recognizer = new GestureRecognizer();
  readonly activation = new TargetActivation({ hoverMs: 300, maxCaptureDriftPx: 64 });
  private frameIndex = 0;
  readonly fired: string[] = [];
  constructor(readonly fps = 13) {}
  tick(options: FrameOptions = {}) {
    const frame: TrackingFrame = {
      timestamp: this.frameIndex++ * 1000 / this.fps, width: 640, height: 480, inferenceMs: 0,
      hands: options.missing ? [] : [
        skeletalHand('Right', options.dominantRatio ?? 1.2, 0.15, options.shiftPx ?? 0),
        skeletalHand('Left', options.otherRatio ?? 1.2, -0.15, 0, options.foldedOffhand ?? 0),
      ],
    };
    const gesture: GestureOutput = this.recognizer.process(frame);
    const cursor = gesture.cursor ? { x: gesture.cursor.x * VIEW.width, y: gesture.cursor.y * VIEW.height } : null;
    const targetId = cursor && cursor.x >= button.left && cursor.x <= button.right && cursor.y >= button.top && cursor.y <= button.bottom ? 'test:click' : null;
    const activation = this.activation.update({
      timestamp: gesture.timestamp, targetId, cursor, trackingReady: gesture.trackingReady,
      toolbarArmed: gesture.toolbarArmed, pinched: gesture.dominantPinched,
      pinchStarted: gesture.pinchStarted, pinchReleased: gesture.pinchReleased,
      pinchClosing: gesture.pinchClosing,
    });
    if (activation.activate) this.fired.push(activation.activate);
    return { gesture, cursor, targetId, activation };
  }
  warmHover(options: FrameOptions = {}) {
    // Start the 350 ms hover after real tracking reacquisition and pinch release.
    let result = this.tick(options);
    let hoverStarted: number | null = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (result.gesture.trackingReady && result.gesture.toolbarArmed && !result.gesture.dominantPinched && !result.gesture.pinchClosing && result.targetId) hoverStarted ??= result.gesture.timestamp;
      else hoverStarted = null;
      if (hoverStarted !== null && result.gesture.timestamp - hoverStarted >= 350) break;
      result = this.tick(options);
    }
    expect(result.gesture.trackingReady).toBe(true);
    expect(result.gesture.toolbarArmed).toBe(true);
    expect(result.activation.phase).toBe('ready');
    return result;
  }
}

describe('real landmark recognizer → stable target activation', () => {
  it.each([13, 15, 30])('captures the hovered button before the two-observation pinch at %i FPS', fps => {
    for (const shiftPx of [20, 35, 50]) {
      const pipeline = new RealPipeline(fps); pipeline.warmHover();
      const first = pipeline.tick({ dominantRatio: 0.2, shiftPx });
      expect(first.gesture.pinchClosing).toBe(true);
      expect(first.gesture.pinchStarted).toBe(false);
      expect(first.targetId).toBeNull();
      expect(first.activation.phase).toBe('closing');
      expect(first.activation.targetId).toBe('test:click');
      expect(first.gesture.rawCursor!.x * VIEW.width - baseline.x).toBeCloseTo(shiftPx);
      const confirmed = pipeline.tick({ dominantRatio: 0.2, shiftPx });
      expect(confirmed.gesture.pinchStarted).toBe(true);
      expect(confirmed.activation.activate).toBe('test:click');
      for (let frame = 0; frame < 6; frame++) pipeline.tick({ dominantRatio: 0.2, shiftPx });
      expect(pipeline.fired).toEqual(['test:click']);
    }
  });

  it('allows a full release and deliberate repeat on the same button at 13 FPS', () => {
    const pipeline = new RealPipeline(); pipeline.warmHover();
    pipeline.tick({ dominantRatio: 0.2, shiftPx: 35 });
    expect(pipeline.tick({ dominantRatio: 0.2, shiftPx: 35 }).activation.activate).toBe('test:click');
    // The real recognizer takes two observations to release. It must not count
    // the first open frame as either a new hover or another activation.
    expect(pipeline.tick().gesture.dominantPinched).toBe(true);
    expect(pipeline.tick().gesture.pinchReleased).toBe(true);
    pipeline.warmHover();
    pipeline.tick({ dominantRatio: 0.2, shiftPx: 35 });
    expect(pipeline.tick({ dominantRatio: 0.2, shiftPx: 35 }).activation.activate).toBe('test:click');
    expect(pipeline.fired).toEqual(['test:click', 'test:click']);
  });

  it('keeps the toolbar gate armed for a relaxed three-finger offhand', () => {
    const pipeline = new RealPipeline(); pipeline.warmHover({ foldedOffhand: 1 });
    const closing = pipeline.tick({ dominantRatio: 0.2, shiftPx: 35, foldedOffhand: 1 });
    expect(closing.gesture.otherOpen).toBe(true); expect(closing.gesture.toolbarArmed).toBe(true);
    const clicked = pipeline.tick({ dominantRatio: 0.2, shiftPx: 35, foldedOffhand: 1 });
    expect(clicked.activation.activate).toBe('test:click');
  });

  it('does not activate with only two extended offhand fingers', () => {
    const pipeline = new RealPipeline();
    for (let frame = 0; frame < 12; frame++) pipeline.tick({ foldedOffhand: 2 });
    pipeline.tick({ dominantRatio: 0.2, foldedOffhand: 2 });
    const result = pipeline.tick({ dominantRatio: 0.2, foldedOffhand: 2 });
    expect(result.gesture.pinchStarted).toBe(true); expect(result.gesture.toolbarArmed).toBe(false);
    expect(result.activation.activate).toBeNull(); expect(pipeline.fired).toEqual([]);
  });

  it('drops a captured click on one missing sample and refuses the recovered held pinch', () => {
    const pipeline = new RealPipeline(); pipeline.warmHover();
    expect(pipeline.tick({ dominantRatio: 0.2, shiftPx: 20 }).activation.phase).toBe('closing');
    expect(pipeline.tick({ missing: true }).activation.phase).toBe('tracking-lost');
    const recovered = pipeline.tick({ dominantRatio: 0.2, shiftPx: 20 });
    expect(recovered.gesture.pinchStarted).toBe(false);
    expect(recovered.activation.activate).toBeNull();
    for (let frame = 0; frame < 6; frame++) pipeline.tick({ dominantRatio: 0.2, shiftPx: 20 });
    expect(pipeline.fired).toEqual([]);
    pipeline.warmHover();
    pipeline.tick({ dominantRatio: 0.2, shiftPx: 20 });
    expect(pipeline.tick({ dominantRatio: 0.2, shiftPx: 20 }).activation.activate).toBe('test:click');
  });

  it('reports two-hand scaling while keeping toolbar activation disarmed', () => {
    const pipeline = new RealPipeline(); pipeline.warmHover();
    const closing = pipeline.tick({ dominantRatio: 0.2, otherRatio: 0.2 });
    expect(closing.gesture.toolbarArmed).toBe(false); expect(closing.activation.activate).toBeNull();
    const scaling = pipeline.tick({ dominantRatio: 0.2, otherRatio: 0.2 });
    expect(scaling.gesture.bothPinched).toBe(true); expect(scaling.gesture.separation).toBeGreaterThan(0.12);
    expect(scaling.gesture.toolbarArmed).toBe(false); expect(scaling.activation.activate).toBeNull();
    expect(pipeline.fired).toEqual([]);
  });
});
