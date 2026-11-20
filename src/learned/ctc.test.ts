import { describe, expect, it } from 'vitest';
import { FRAME_LENGTH, type ModelManifest } from './contract';
import { StreamingCtcDecoder } from './ctc';
import { parseReplay, verifyReplay } from './replay';

const blank = new Float32Array([10, 0, 0, 0]);
const box = new Float32Array([0, 10, 0, 0]);
const cylinder = new Float32Array([0, 0, 10, 0]);
const manifest: ModelManifest = {
  version: 1, source: 'presenter', nodeCount: 42, featureCount: 13, featureSet: 'hands',
  modelSha256: 'a'.repeat(64), modelBytes: 100,
};

describe('streaming CTC', () => {
  it('carries repeats over chunks and allows repeated labels separated by a blank', () => {
    const decoder = new StreamingCtcDecoder();
    const first = decoder.step(box, 100);
    const chunk = [box, blank, box, cylinder].map((logits, index) => decoder.step(logits, 150 + index * 50));
    expect([first, ...chunk].flatMap(step => step.emitted ? [step.emitted] : [])).toEqual(['Box', 'Box', 'Cylinder']);
  });

  it('emits one stable token per run and requires fresh observations after a reset', () => {
    const decoder = new StreamingCtcDecoder();
    expect(decoder.step(box, 0).stable).toBeNull();
    expect(decoder.step(box, 45).stable).toBeNull();
    expect(decoder.step(box, 90).stable).toBe('Box');
    expect(decoder.step(box, 180).stable).toBeNull();
    decoder.reset();
    expect(decoder.step(box, 500).emitted).toBe('Box');
    expect(decoder.step(box, 550).stable).toBeNull();
    expect(decoder.step(box, 600).stable).toBe('Box');
  });

  it('separates provisional output from the consecutive high-confidence stability rule', () => {
    const decoder = new StreamingCtcDecoder();
    expect(decoder.step(box, 0).emitted).toBe('Box');
    expect(decoder.step(new Float32Array([1, 1.1, 0, 0]), 50)).toMatchObject({ provisional: 'Box', stable: null });
    expect(decoder.step(box, 100).stable).toBeNull();
    expect(decoder.step(box, 150).stable).toBeNull();
    expect(decoder.step(box, 200).stable).toBe('Box');
  });
});

describe('frozen browser parity', () => {
  const logits = [box, box, box, blank, cylinder];
  const parityFixture = {
    version: 1, clipId: 'test-case', source: 'presenter', featureSet: 'hands', modelSha256: manifest.modelSha256,
    timestamps: [10, 60, 110, 160, 210],
    frames: logits.map(() => Array(FRAME_LENGTH).fill(0)),
    logits: logits.map(row => Array.from(row)),
    transcript: ['Box', 'Cylinder'], groundTruth: ['Box'],
    gestureEndsMs: [100],
  };

  it('rejects replay from a different model and nonmonotonic timestamps', () => {
    expect(() => parseReplay({ ...parityFixture, modelSha256: 'b'.repeat(64) }, manifest)).toThrow(/this model/);
    expect(() => parseReplay({ ...parityFixture, timestamps: [10, 10, 11, 12, 13] }, manifest)).toThrow(/invalid timestamps/);
  });

  it('checks transcript parity separately from intended labels and reports stable token delay', async () => {
    let index = 0;
    const resetFlags: boolean[] = [];
    const result = await verifyReplay({
      step: async (_features, reset) => {
        resetFlags.push(reset);
        return { type: 'logits', id: index, inferenceMs: 1, logits: logits[index++] };
      },
    }, parseReplay(parityFixture, manifest));
    expect(resetFlags).toEqual([true, false, false, false, false]);
    expect(result).toMatchObject({
      logitParity: true, transcriptParity: true,
      decoded: ['Box', 'Cylinder'], intended: ['Box'], stable: ['Box'], stableDelaysMs: [10],
    });
  });

  it('reports a logit mismatch even when decoded transcripts match', async () => {
    let index = 0;
    const result = await verifyReplay({
      step: async () => {
        const row = new Float32Array(logits[index++]);
        row[0] += 0.1;
        return { type: 'logits', id: index, inferenceMs: 2, logits: row };
      },
    }, parseReplay(parityFixture, manifest));
    expect(result).toMatchObject({ logitParity: false, transcriptParity: true });
  });
});
