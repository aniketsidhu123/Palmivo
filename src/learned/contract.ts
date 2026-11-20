export const TOOL_LABELS = ['Box', 'Cylinder', 'Union'] as const;
export type ToolToken = (typeof TOOL_LABELS)[number];
export type FeatureSet = 'hands' | 'hands+shoulders';
export const NODE_COUNT = 42;
export const FEATURE_COUNT = 13;
export const FRAME_LENGTH = NODE_COUNT * FEATURE_COUNT;
export const STATE_CHANNELS = 32;
export const STATE_LENGTHS = [2, 4, 8] as const;
export const LOGIT_COUNT = TOOL_LABELS.length + 1;

export type LearnedMode = 'rules' | 'live' | 'shadow' | 'replay';

export interface ModelManifest {
  version: 1;
  source: 'presenter';
  featureSet: FeatureSet;
  nodeCount: typeof NODE_COUNT;
  featureCount: typeof FEATURE_COUNT;
  modelBytes: number;
  modelSha256: string;
  liveApproved?: true;
}

export interface LearnedTiming {
  inferenceMs: number;
  decoderMs: number;
  roundTripMs: number;
  /** Frames skipped since the current live attempt began. */
  droppedFrames: number;
}

export type WorkerRequest =
  | { id: number; type: 'load'; baseUrl: string }
  | { id: number; type: 'step'; features: Float32Array; reset: boolean };

export type WorkerReply =
  | { id: number; type: 'ready'; manifest: ModelManifest }
  | { id: number; type: 'logits'; logits: Float32Array; inferenceMs: number }
  | { id: number; type: 'error'; message: string };

export const MAX_MODEL_BYTES = 12 * 1024 * 1024;
export const MAX_GAP_MS = 250;

export function isToken(value: unknown): value is ToolToken {
  return TOOL_LABELS.some(label => label === value);
}

export function parseManifest(value: unknown): ModelManifest {
  const manifest = value as Partial<ModelManifest> | null;
  if (!manifest || manifest.version !== 1 || manifest.source !== 'presenter' ||
      manifest.nodeCount !== NODE_COUNT || manifest.featureCount !== FEATURE_COUNT ||
      (manifest.featureSet !== 'hands' && manifest.featureSet !== 'hands+shoulders') ||
      !Number.isInteger(manifest.modelBytes) || manifest.modelBytes! < 1 ||
      manifest.modelBytes! > MAX_MODEL_BYTES || typeof manifest.modelSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(manifest.modelSha256) ||
      (manifest.liveApproved !== undefined && manifest.liveApproved !== true)) {
    throw new Error('The learned gesture model manifest is invalid.');
  }
  return manifest as ModelManifest;
}
