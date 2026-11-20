import { FRAME_LENGTH, isToken, LOGIT_COUNT, MAX_GAP_MS, type FeatureSet, type ModelManifest, type ToolToken } from './contract';
import { StreamingCtcDecoder } from './ctc';
import type { LearnedBackend } from './backend';

export const MAX_REPLAY_BYTES = 16 * 1024 * 1024;
const MAX_REPLAY_FRAMES = 1200;

interface ReplayClip {
  clipId: string;
  timestamps: number[];
  frames: Float32Array[];
  logits: number[][];
  transcript: ToolToken[];
  groundTruth: ToolToken[];
  gestureEndsMs?: number[];
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberList(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(finiteNumber);
}

function tokenList(value: unknown): value is ToolToken[] {
  return Array.isArray(value) && value.length <= MAX_REPLAY_FRAMES && value.every(isToken);
}

export function parseReplay(value: unknown, manifest: ModelManifest): ReplayClip {
  if (!value || typeof value !== 'object') throw new Error('Choose a presenter parity clip exported by the training pipeline.');
  const input = value as Partial<ReplayClip> & { version?: number; source?: string; featureSet?: FeatureSet; modelSha256?: string };
  if (input.version !== 1 || input.source !== 'presenter' || input.featureSet !== manifest.featureSet ||
      input.modelSha256 !== manifest.modelSha256) {
    throw new Error('The replay must come from presenter data evaluated with this model and feature set.');
  }
  const count = input.timestamps?.length ?? 0;
  if (typeof input.clipId !== 'string' || input.clipId.length === 0 || input.clipId.length > 160 ||
      count === 0 || count > MAX_REPLAY_FRAMES || !numberList(input.timestamps, count) ||
      input.timestamps.some((time, index) => index > 0 && time <= input.timestamps![index - 1]) ||
      !Array.isArray(input.frames) || input.frames.length !== count ||
      !Array.isArray(input.logits) || input.logits.length !== count ||
      !input.logits.every(row => numberList(row, LOGIT_COUNT)) ||
      !tokenList(input.transcript) || !tokenList(input.groundTruth) ||
      (input.gestureEndsMs !== undefined && !numberList(input.gestureEndsMs, input.groundTruth.length))) {
    throw new Error('The parity clip contains invalid timestamps, logits, or labels.');
  }
  const frames = input.frames.map(row => {
    if (!numberList(row, FRAME_LENGTH)) throw new Error('The parity clip contains a malformed feature frame.');
    const frame = Float32Array.from(row);
    if (!frame.every(Number.isFinite)) throw new Error('The parity clip contains a feature outside the Float32 range.');
    return frame;
  });
  return {
    clipId: input.clipId, timestamps: input.timestamps, frames, logits: input.logits,
    transcript: input.transcript, groundTruth: input.groundTruth, gestureEndsMs: input.gestureEndsMs,
  };
}

export interface ReplayResult {
  clipId: string;
  frameCount: number;
  decoded: ToolToken[];
  desktop: ToolToken[];
  intended: ToolToken[];
  stable: ToolToken[];
  stableDelaysMs: number[] | null;
  maxAbsoluteLogitError: number;
  logitParity: boolean;
  transcriptParity: boolean;
  inferenceP95Ms: number;
}

function sameTokens(left: ToolToken[], right: ToolToken[]): boolean {
  return left.length === right.length && left.every((token, index) => token === right[index]);
}

export async function verifyReplay(
  backend: Pick<LearnedBackend, 'step'>,
  clip: ReplayClip,
  cancelled = () => false,
): Promise<ReplayResult> {
  const decoder = new StreamingCtcDecoder();
  const decoded: ToolToken[] = [];
  const stable: ToolToken[] = [];
  const stableTimes: number[] = [];
  const inferenceTimings: number[] = [];
  let logitParity = true;
  let maxAbsoluteLogitError = 0;
  for (let index = 0; index < clip.frames.length; index++) {
    if (cancelled()) throw new Error('Replay was cancelled.');
    const timestamp = clip.timestamps[index];
    const reset = index === 0 || timestamp - clip.timestamps[index - 1] > MAX_GAP_MS;
    if (reset) decoder.reset();
    const observation = await backend.step(clip.frames[index], reset);
    const { emitted, stable: stableToken } = decoder.step(observation.logits, timestamp);
    if (emitted) decoded.push(emitted);
    if (stableToken) {
      stable.push(stableToken);
      stableTimes.push(timestamp);
    }
    for (let token = 0; token < LOGIT_COUNT; token++) {
      const expected = clip.logits[index][token];
      const error = Math.abs(observation.logits[token] - expected);
      maxAbsoluteLogitError = Math.max(maxAbsoluteLogitError, error);
      if (error > 1e-4 + 1e-3 * Math.abs(expected)) logitParity = false;
    }
    inferenceTimings.push(observation.inferenceMs);
  }
  inferenceTimings.sort((a, b) => a - b);
  return {
    clipId: clip.clipId, frameCount: clip.frames.length, decoded,
    desktop: clip.transcript, intended: clip.groundTruth, stable,
    stableDelaysMs: clip.gestureEndsMs && sameTokens(stable, clip.groundTruth)
      ? stableTimes.map((time, index) => time - clip.gestureEndsMs![index])
      : null,
    maxAbsoluteLogitError, logitParity, transcriptParity: sameTokens(decoded, clip.transcript),
    inferenceP95Ms: inferenceTimings[Math.ceil(0.95 * inferenceTimings.length) - 1],
  };
}
