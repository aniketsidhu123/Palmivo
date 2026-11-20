import { LOGIT_COUNT, TOOL_LABELS, type ToolToken } from './contract';

export interface DecoderStep {
  provisional: ToolToken | null;
  emitted: ToolToken | null;
  stable: ToolToken | null;
  confidence: number;
}

export class StreamingCtcDecoder {
  private previous = 0;
  private runCount = 0;
  private runStart = 0;
  private stableInRun = false;

  constructor(
    private readonly minFrames = 3,
    private readonly minDurationMs = 90,
    private readonly minConfidence = 0.7,
  ) {}

  reset(): void {
    this.previous = 0;
    this.runCount = 0;
    this.runStart = 0;
    this.stableInRun = false;
  }

  step(logits: Float32Array, timestamp: number): DecoderStep {
    if (logits.length !== LOGIT_COUNT || !logits.every(Number.isFinite)) {
      throw new Error('Expected four finite CTC logits.');
    }
    let winner = 0;
    for (let index = 1; index < logits.length; index++) {
      if (logits[index] > logits[winner]) winner = index;
    }
    const denominator = logits.reduce((sum, value) => sum + Math.exp(value - logits[winner]), 0);
    const confidence = 1 / denominator;
    const provisional = TOOL_LABELS[winner - 1] ?? null;
    const emitted = winner !== this.previous ? provisional : null;
    if (winner !== this.previous) {
      this.previous = winner;
      this.runCount = 0;
      this.stableInRun = false;
    }
    let stable: ToolToken | null = null;
    if (!provisional || confidence < this.minConfidence) {
      this.runCount = 0;
    } else if (!this.stableInRun) {
      if (this.runCount === 0) this.runStart = timestamp;
      this.runCount++;
      if (this.runCount >= this.minFrames && timestamp - this.runStart >= this.minDurationMs) {
        stable = provisional;
        this.stableInRun = true;
      }
    }
    return { provisional, emitted, stable, confidence };
  }
}
