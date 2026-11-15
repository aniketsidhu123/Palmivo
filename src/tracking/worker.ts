import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { TrackingFrame, TrackedHand } from '../shared/types';

interface WorkerScope { onmessage: ((event: MessageEvent) => void) | null; postMessage(message: unknown): void }
const scope = self as unknown as WorkerScope;
let detector: HandLandmarker | null = null;
let initialized = false;
let busy = false;

async function initialize(baseUrl: string): Promise<void> {
  const base = new URL(baseUrl);
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

scope.onmessage = (event: MessageEvent) => {
  const data = event.data;
  if (data.type === 'init') {
    void initialize(data.baseUrl).catch(error => scope.postMessage({ type: 'error', error: String(error), fatal: true }));
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
      const frame: TrackingFrame = { timestamp: data.timestamp, width: bitmap.width, height: bitmap.height, hands, inferenceMs: performance.now() - start };
      scope.postMessage({ type: 'frame', id: data.id, frame });
    } catch (error) { scope.postMessage({ type: 'error', id: data.id, error: String(error), fatal: false }); }
    finally { bitmap.close(); busy = false; }
  }
};
