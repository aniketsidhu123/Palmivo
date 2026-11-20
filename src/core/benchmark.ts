export type BenchmarkPhase = 'idle' | 'warmup' | 'recording' | 'complete';

export interface BenchmarkStatus {
  phase: BenchmarkPhase;
  /** Time since Start, including warm-up. */
  elapsedMs: number;
  /** Time remaining in the current warm-up or measurement phase. */
  remainingMs: number;
  recordedMs: number;
}

export interface BenchmarkMetric {
  /** All accepted observations in the measurement window. */
  samples: number;
  /** The most recent observations retained for percentile calculation. */
  retainedSamples: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
  mean: number;
}

export interface BenchmarkResult {
  schemaVersion: 1;
  startedAtMonotonicMs: number;
  measurementStartMonotonicMs: number;
  measurementEndMonotonicMs: number;
  warmupMs: number;
  durationMs: number;
  metrics: Record<string, BenchmarkMetric>;
  tsm: {
    /** Time spent listening, clipped to the measured window. Loading is excluded. */
    listeningMs: number;
    listeningWindows: number;
    cameraFrames: number;
    trackingFrames: number;
    renderFrames: number;
    timedPredictions: number;
  };
  metadata: Record<string, unknown>;
  notes: string;
}

interface MetricSamples {
  retained: number[];
  writeIndex: number;
  count: number;
  sum: number;
  min: number;
  max: number;
}

/** A fixed wall-clock measurement window, independent of UI polling or camera rate. */
export class PerformanceBenchmark {
  readonly warmupMs: number;
  readonly durationMs: number;
  readonly maxSamplesPerMetric: number;
  private startedAt: number | null = null;
  private lastObservedAt: number | null = null;
  private metrics = new Map<string, MetricSamples>();
  private tsmListeningSince: number | null = null;
  private tsm = { listeningMs: 0, listeningWindows: 0, cameraFrames: 0, trackingFrames: 0, renderFrames: 0 };
  private result: BenchmarkResult | null = null;

  constructor(options: { warmupMs?: number; durationMs?: number; maxSamplesPerMetric?: number } = {}) {
    this.warmupMs = options.warmupMs ?? 3000;
    this.durationMs = options.durationMs ?? 20000;
    this.maxSamplesPerMetric = options.maxSamplesPerMetric ?? 1800;
    if (!Number.isFinite(this.warmupMs) || this.warmupMs < 0 ||
      !Number.isFinite(this.durationMs) || this.durationMs <= 0 ||
      !Number.isSafeInteger(this.maxSamplesPerMetric) || this.maxSamplesPerMetric <= 0) {
      throw new RangeError('Benchmark durations and sample capacity must be finite and positive; warm-up may be zero.');
    }
  }

  start(now: number): BenchmarkStatus {
    if (!Number.isFinite(now) || now < 0) throw new RangeError('A benchmark requires a finite monotonic start time.');
    this.reset();
    this.startedAt = now;
    this.lastObservedAt = now;
    return this.status(now);
  }

  reset(): void {
    this.startedAt = null;
    this.lastObservedAt = null;
    this.metrics.clear();
    this.tsmListeningSince = null;
    this.tsm = { listeningMs: 0, listeningWindows: 0, cameraFrames: 0, trackingFrames: 0, renderFrames: 0 };
    this.result = null;
  }

  /** Record actual TSM state transitions on the same monotonic clock as observations. */
  setTsmListening(listening: boolean, now: number): void {
    if (this.startedAt === null || this.result || !this.observe(now)) return;
    if (listening) this.tsmListeningSince ??= now;
    else this.closeTsmWindow(now);
  }

  add(name: string, value: number, now: number): boolean {
    if (this.startedAt === null || this.result || !name.trim() ||
      !Number.isFinite(value) || value < 0 || !this.observe(now)) return false;
    const start = this.startedAt + this.warmupMs;
    // The upper boundary is exclusive: a late callback cannot extend the benchmark.
    if (now < start || now >= start + this.durationMs) return false;
    if (name.startsWith('tsm_') && this.tsmListeningSince === null) return false;
    if (this.tsmListeningSince !== null) {
      if (name === 'camera_delivered_frame') this.tsm.cameraFrames++;
      if (name === 'landmark_ms') this.tsm.trackingFrames++;
      if (name === 'render_frame_ms') this.tsm.renderFrames++;
    }
    let metric = this.metrics.get(name);
    if (!metric) {
      metric = { retained: [], writeIndex: 0, count: 0, sum: 0, min: value, max: value };
      this.metrics.set(name, metric);
    }
    if (metric.retained.length < this.maxSamplesPerMetric) metric.retained.push(value);
    else {
      metric.retained[metric.writeIndex] = value;
      metric.writeIndex = (metric.writeIndex + 1) % this.maxSamplesPerMetric;
    }
    metric.count++;
    metric.sum += value;
    metric.min = Math.min(metric.min, value);
    metric.max = Math.max(metric.max, value);
    return true;
  }

  status(now: number): BenchmarkStatus {
    if (this.startedAt === null) return { phase: 'idle', elapsedMs: 0, remainingMs: 0, recordedMs: 0 };
    // Status cannot move a session backwards if an old timer callback arrives late.
    this.observe(now);
    const elapsedMs = Math.max(0, this.lastObservedAt! - this.startedAt);
    if (elapsedMs < this.warmupMs) return { phase: 'warmup', elapsedMs, remainingMs: this.warmupMs - elapsedMs, recordedMs: 0 };
    const recordedMs = Math.min(this.durationMs, elapsedMs - this.warmupMs);
    const complete = recordedMs >= this.durationMs;
    return { phase: complete ? 'complete' : 'recording', elapsedMs, remainingMs: complete ? 0 : this.durationMs - recordedMs, recordedMs };
  }

  finish(now: number, metadata: Record<string, unknown> = {}): BenchmarkResult | null {
    if (this.startedAt === null || !Number.isFinite(now) || now < this.lastObservedAt!) return null;
    if (this.result) return this.snapshot(this.result);
    if (this.status(now).phase !== 'complete') return null;
    this.closeTsmWindow(now);
    const metrics: Record<string, BenchmarkMetric> = {};
    for (const [name, metric] of this.metrics) {
      const sorted = [...metric.retained].sort((a, b) => a - b);
      const percentile = (fraction: number) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
      metrics[name] = {
        samples: metric.count, retainedSamples: sorted.length,
        p50: percentile(.5), p95: percentile(.95),
        min: metric.min, max: metric.max, mean: metric.sum / metric.count,
      };
    }
    const tsm = { ...this.tsm, timedPredictions: metrics.tsm_inference_ms?.samples ?? 0 };
    const initialRecognition = metadata.recognition;
    const recognition = tsm.listeningMs >= this.durationMs ? 'mit-tsm'
      : tsm.listeningMs > 0 || tsm.timedPredictions > 0 ? 'mixed-tsm' : 'rules';
    this.result = {
      schemaVersion: 1,
      startedAtMonotonicMs: this.startedAt,
      measurementStartMonotonicMs: this.startedAt + this.warmupMs,
      measurementEndMonotonicMs: this.startedAt + this.warmupMs + this.durationMs,
      warmupMs: this.warmupMs, durationMs: this.durationMs,
      metrics, tsm,
      metadata: structuredClone(initialRecognition === 'rules' || initialRecognition === 'mit-tsm'
        ? { ...metadata, recognition }
        : metadata),
      notes: 'Browser observations after warm-up; not physical motion-to-action latency. Percentiles use nearest rank over retained samples. Mean/min/max and sample counts use all accepted observations. Missing metrics mean no observations, not zero latency.',
    };
    return this.snapshot(this.result);
  }

  private closeTsmWindow(now: number): void {
    if (this.startedAt === null || this.tsmListeningSince === null) return;
    const start = this.startedAt + this.warmupMs;
    const clipped = Math.min(now, start + this.durationMs) - Math.max(this.tsmListeningSince, start);
    if (clipped > 0) {
      this.tsm.listeningMs += clipped;
      this.tsm.listeningWindows++;
    }
    this.tsmListeningSince = null;
  }

  private observe(now: number): boolean {
    if (!Number.isFinite(now) || now < 0 || this.lastObservedAt !== null && now < this.lastObservedAt) return false;
    this.lastObservedAt = now;
    return true;
  }

  private snapshot(result: BenchmarkResult): BenchmarkResult { return structuredClone(result); }
}
