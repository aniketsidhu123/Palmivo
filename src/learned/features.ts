import type { Landmark, TrackedHand, TrackingFrame } from '../shared/types';

export const NODE_COUNT = 42;
export const FEATURE_COUNT = 13;
export const HAND_NODE_COUNT = 21;
export const FEATURE_VERSION = 1;
export type FeatureSet = 'hands' | 'hands+shoulders';
export type GestureToken = 'Box' | 'Cylinder' | 'Union';
export type Split = 'train' | 'validation' | 'test';
export type Shoulders = { timestamp: number; left: Landmark; right: Landmark };
export type LandmarkFrame = TrackingFrame & { shoulders?: Shoulders; poseMs?: number };
export interface GestureClip {
  id: string;
  timestampsMs: number[];
  transcript: GestureToken[];
  gestureEndMs?: number[];
  frames: number[][];
}

function valid(point: Landmark | undefined): point is Landmark {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
}

/** Worker and recorder consume the same image-space observations and feature layout. */
export class FeatureEncoder {
  private timestamp: number | undefined;
  private wrists: (Landmark | undefined)[] = [];

  reset(): void {
    this.timestamp = undefined;
    this.wrists = [];
  }

  encode(frame: LandmarkFrame, pointer: TrackedHand['handedness']): Float32Array {
    const elapsed = this.timestamp === undefined ? 0 : Math.max(0, (frame.timestamp - this.timestamp) / 1000);
    const ratio = frame.width / Math.max(1, frame.height);
    const distance = (a: Landmark, b: Landmark) => Math.hypot((a.x - b.x) * ratio, a.y - b.y);
    const handFor = (side: TrackedHand['handedness']) => frame.hands.reduce<TrackedHand | undefined>(
      (best, hand) => hand.handedness === side && (!best || hand.score > best.score) ? hand : best, undefined);
    const hands = [handFor(pointer), handFor(pointer === 'Right' ? 'Left' : 'Right')];
    const wrists = hands.map(hand => {
      const point = hand?.landmarks[0];
      return valid(point) ? point : undefined;
    });
    const separation = wrists[0] && wrists[1] ? distance(wrists[0], wrists[1]) : 0;
    const shoulders = frame.shoulders;
    const span = shoulders && frame.timestamp >= shoulders.timestamp && frame.timestamp - shoulders.timestamp <= 250 &&
      valid(shoulders.left) && valid(shoulders.right) ? distance(shoulders.left, shoulders.right) : 0;
    const values = new Float32Array(NODE_COUNT * FEATURE_COUNT);
    hands.forEach((hand, role) => {
      const wrist = wrists[role];
      const middle = hand?.landmarks[9];
      const palm = wrist && valid(middle) ? distance(wrist, middle) : 0;
      const previous = elapsed >= .001 && elapsed <= .25 ? this.wrists[role] : undefined;
      for (let joint = 0; joint < HAND_NODE_COUNT; ++joint) {
        const offset = (role * HAND_NODE_COUNT + joint) * FEATURE_COUNT;
        values[offset + 8] = Math.min(elapsed, 1);
        const point = hand?.landmarks[joint];
        if (!wrist || !valid(point) || palm < .01) continue;
        values[offset] = (point.x - wrist.x) * ratio / palm;
        values[offset + 1] = (point.y - wrist.y) / palm;
        values[offset + 2] = (point.z - wrist.z) * ratio / palm;
        values[offset + 3] = wrist.x;
        values[offset + 4] = wrist.y;
        values[offset + 5] = previous ? (wrist.x - previous.x) / elapsed : 0;
        values[offset + 6] = previous ? (wrist.y - previous.y) / elapsed : 0;
        values[offset + 7] = separation;
        values[offset + 9] = 1;
        if (shoulders && span >= .04) {
          values[offset + 10] = (wrist.x - (shoulders.left.x + shoulders.right.x) / 2) * ratio / span;
          values[offset + 11] = (wrist.y - (shoulders.left.y + shoulders.right.y) / 2) / span;
          values[offset + 12] = 1;
        }
      }
    });
    this.wrists = wrists;
    this.timestamp = frame.timestamp;
    return values;
  }
}
