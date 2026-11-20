import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { TrackedHand } from '../shared/types';
import type { LandmarkFrame, Shoulders } from '../learned/features';

interface WorkerScope { onmessage: ((event: MessageEvent) => void) | null; postMessage(message: unknown): void }
const scope = self as unknown as WorkerScope;
let detector: HandLandmarker | null = null;
let initialized = false;
let busy = false;
let pose: PoseLandmarker | null = null;
let poseEnabled = false;
let poseLoading = false;
let poseFailed = false;
let latestShoulders: Shoulders | undefined;
let lastPoseAt = -Infinity;
let base: URL;

async function initialize(baseUrl: string): Promise<void> {
  base = new URL(baseUrl);
  const wasm = new URL('tracking/wasm', base).href.replace(/\/$/, '');
  const model = new URL('tracking/hand_landmarker.task', base).href;
  // 0.10.32 uses importScripts for its WASM loader; this worker is bundled as a classic IIFE.
  const vision = await FilesetResolver.forVisionTasks(wasm);
  let backend: 'GPU worker' | 'CPU worker' = 'GPU worker';
  try {
    detector = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: model, delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 2,
      minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
  } catch {
    detector?.close(); detector = null; backend = 'CPU worker';
    scope.postMessage({ type: 'status', message: 'GPU tracking unavailable; initializing CPU worker.' });
    detector = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: model, delegate: 'CPU' }, runningMode: 'VIDEO', numHands: 2,
      minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
  }
  initialized = true;
  scope.postMessage({ type: 'ready', backend });
}

async function preparePose() {
  poseLoading = true;
  try {
    const vision = await FilesetResolver.forVisionTasks(new URL('tracking/wasm', base).href);
    pose = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: new URL('tracking/pose_landmarker_lite.task', base).href, delegate: 'CPU' },
      runningMode: 'VIDEO', numPoses: 1, outputSegmentationMasks: false,
    });
  } catch {
    poseFailed = true;
    scope.postMessage({ type: 'pose-status', message: 'Shoulder tracking unavailable. Hand controls are still active.' });
  } finally { poseLoading = false; }
}

scope.onmessage = (event: MessageEvent) => {
  const data = event.data;
  if (data.type === 'init') {
    void initialize(data.baseUrl).catch(error => scope.postMessage({ type: 'error', error: String(error), fatal: true }));
    return;
  }
  if (data.type === 'pose') {
    poseEnabled = Boolean(data.enabled);
    if (poseEnabled && initialized && !pose && !poseLoading && !poseFailed) void preparePose();
    if (!poseEnabled) latestShoulders = undefined;
    return;
  }
  if (data.type === 'frame') {
    const bitmap = data.bitmap as ImageBitmap;
    if (!initialized || !detector || busy) {
      bitmap.close(); scope.postMessage({ type: 'skipped', id: data.id }); return;
    }
    busy = true;
    try {
      const start = performance.now();
      const result = detector.detectForVideo(bitmap, data.timestamp);
      const hands: TrackedHand[] = result.landmarks.map((landmarks, index) => {
        const category = result.handedness[index]?.[0];
        return {
          handedness: category?.categoryName === 'Left' ? 'Left' : 'Right',
          score: category?.score ?? 0,
          landmarks: landmarks.map(point => ({ x: point.x, y: point.y, z: point.z })),
        };
      });
      const frame: LandmarkFrame = { timestamp: data.timestamp, width: bitmap.width, height: bitmap.height, hands, inferenceMs: performance.now() - start };
      if (poseEnabled && pose && data.timestamp - lastPoseAt >= 140) {
        const poseStart = performance.now();
        lastPoseAt = data.timestamp;
        try {
          const points = pose.detectForVideo(bitmap, data.timestamp).landmarks[0];
          const left = points?.[11], right = points?.[12];
          latestShoulders = left && right && left.visibility >= .5 && right.visibility >= .5
            ? { timestamp: data.timestamp, left, right } : undefined;
        } catch {
          pose.close(); pose = null; poseFailed = true; latestShoulders = undefined;
          scope.postMessage({ type: 'pose-status', message: 'Shoulder tracking stopped. Hand controls are still active.' });
        }
        frame.poseMs = performance.now() - poseStart;
      }
      if (poseEnabled && latestShoulders) frame.shoulders = latestShoulders;
      scope.postMessage({ type: 'frame', id: data.id, frame });
    } catch (error) { scope.postMessage({ type: 'error', id: data.id, error: String(error), fatal: false }); }
    finally { bitmap.close(); busy = false; }
  }
};
