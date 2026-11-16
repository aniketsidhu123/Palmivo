import { describe, expect, it } from 'vitest';
import { PerformanceBenchmark } from './benchmark';

describe('fixed-window performance benchmark', () => {
  it('excludes warm-up and observations outside the exact measurement window', () => {
    const benchmark = new PerformanceBenchmark();
    expect(benchmark.status(0).phase).toBe('idle');
    expect(benchmark.add('landmark_ms', 999, 0)).toBe(false);
    expect(benchmark.start(100)).toEqual({ phase: 'warmup', elapsedMs: 0, remainingMs: 3000, recordedMs: 0 });
    expect(benchmark.add('landmark_ms', 999, 3099)).toBe(false);
    expect(benchmark.add('landmark_ms', 10, 3100)).toBe(true);
    expect(benchmark.add('landmark_ms', 20, 23099)).toBe(true);
    expect(benchmark.finish(23099)).toBeNull();
    expect(benchmark.add('landmark_ms', 999, 23100)).toBe(false);
    const result = benchmark.finish(24000)!;
    expect(result.measurementStartMonotonicMs).toBe(3100);
    expect(result.measurementEndMonotonicMs).toBe(23100);
    expect(result.durationMs).toBe(20000);
    expect(result.metrics.landmark_ms).toEqual({ samples: 2, retainedSamples: 2, p50: 10, p95: 20, min: 10, max: 20, mean: 15 });
  });

  it('computes nearest-rank percentiles without mixing independent metrics', () => {
    const benchmark = new PerformanceBenchmark({ warmupMs: 0 }); benchmark.start(0);
    for (let value = 100; value >= 1; value--) benchmark.add('sample_age_ms', value, 100 - value);
    benchmark.add('camera_fps', 30, 100);
    benchmark.add('hands_detected', 0, 101);
    const result = benchmark.finish(20000)!;
    expect(result.metrics.sample_age_ms).toEqual({ samples: 100, retainedSamples: 100, p50: 50, p95: 95, min: 1, max: 100, mean: 50.5 });
    expect(result.metrics.camera_fps.p50).toBe(30);
    expect(result.metrics.hands_detected.mean).toBe(0);
    expect(result.metrics.boolean_ms).toBeUndefined();
  });

  it('bounds retained samples and discloses full-window versus retained counts', () => {
    const benchmark = new PerformanceBenchmark({ warmupMs: 0, maxSamplesPerMetric: 3 }); benchmark.start(0);
    for (let value = 1; value <= 10; value++) benchmark.add('render_frame_ms', value, value);
    const metric = benchmark.finish(20000)!.metrics.render_frame_ms;
    expect(metric).toEqual({ samples: 10, retainedSamples: 3, p50: 9, p95: 10, min: 1, max: 10, mean: 5.5 });
  });

  it('rejects nonfinite, negative, and out-of-order observations', () => {
    const benchmark = new PerformanceBenchmark({ warmupMs: 0 }); benchmark.start(100);
    expect(benchmark.add('rules_ms', 1, 200)).toBe(true);
    expect(benchmark.add('rules_ms', 5, 199)).toBe(false);
    for (const value of [NaN, Infinity, -1]) expect(benchmark.add('rules_ms', value, 201)).toBe(false);
    for (const now of [NaN, Infinity, -1]) expect(benchmark.add('rules_ms', 5, now)).toBe(false);
    expect(benchmark.add('', 5, 201)).toBe(false);
    expect(benchmark.finish(NaN)).toBeNull();
    expect(benchmark.finish(20100)!.metrics.rules_ms.samples).toBe(1);
  });

  it('keeps phase progression monotonic and requires a complete window', () => {
    const benchmark = new PerformanceBenchmark(); benchmark.start(0);
    expect(benchmark.status(2500)).toEqual({ phase: 'warmup', elapsedMs: 2500, remainingMs: 500, recordedMs: 0 });
    expect(benchmark.finish(2999)).toBeNull();
    expect(benchmark.status(4000)).toEqual({ phase: 'recording', elapsedMs: 4000, remainingMs: 19000, recordedMs: 1000 });
    expect(benchmark.status(3500).elapsedMs).toBe(4000);
    expect(benchmark.add('landmark_ms', 4, 3900)).toBe(false);
    expect(benchmark.finish(22999)).toBeNull();
    expect(benchmark.status(23000).phase).toBe('complete');
    expect(benchmark.finish(23000)?.metrics).toEqual({});
  });

  it('freezes finished results and starts the next session with empty counters', () => {
    const benchmark = new PerformanceBenchmark({ warmupMs: 0 }); benchmark.start(0);
    benchmark.add('tracking_fps', 30, 100);
    const metadata = { camera: { fps: 30 } };
    const result = benchmark.finish(20000, metadata)!;
    metadata.camera.fps = 15; result.metrics.tracking_fps.p50 = 99;
    expect(benchmark.add('tracking_fps', 1, 20001)).toBe(false);
    expect(benchmark.finish(20001)!.metrics.tracking_fps.p50).toBe(30);
    expect(benchmark.finish(20001)!.metadata).toEqual({ camera: { fps: 30 } });
    benchmark.start(21000);
    benchmark.add('tracking_fps', 60, 21001);
    expect(benchmark.finish(41000)!.metrics.tracking_fps.samples).toBe(1);
    expect(benchmark.finish(41000)!.metrics.tracking_fps.p50).toBe(60);
    benchmark.reset();
    expect(benchmark.status(50000).phase).toBe('idle');
    expect(benchmark.finish(50000)).toBeNull();
  });

  it('validates configuration and start times', () => {
    for (const options of [{ warmupMs: -1 }, { durationMs: 0 }, { durationMs: Infinity }, { maxSamplesPerMetric: 1.5 }, { maxSamplesPerMetric: 0 }]) {
      expect(() => new PerformanceBenchmark(options)).toThrow(RangeError);
    }
    const benchmark = new PerformanceBenchmark();
    for (const now of [-1, NaN, Infinity]) expect(() => benchmark.start(now)).toThrow(RangeError);
  });
});
