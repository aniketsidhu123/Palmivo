import { describe, expect, it } from 'vitest';
import { TsmShortcutGate } from './shortcuts';

function logits(winner: number, score = 9): Float32Array {
  const values = new Float32Array(27);
  values[winner] = score;
  return values;
}

function warm(gate: TsmShortcutGate, at = 0) {
  for (let frame = 0; frame < 4; frame++) gate.step(logits(2), at + frame * 67);
}

function withConfidence(winner: number, probability: number): Float32Array {
  return logits(winner, Math.log(26 * probability / (1 - probability)));
}

describe('MIT TSM shortcut gate', () => {
  it.each([[16, 'box'], [17, 'cylinder']] as const)(
    'opens a swipe draft once, tolerating one neutral prediction for class %d',
    (index, tool) => {
      const gate = new TsmShortcutGate();
      warm(gate);
      expect(gate.step(withConfidence(index, .69), 268)).toMatchObject({ ready: true, accepted: null });
      expect(gate.step(logits(2), 335).accepted).toBeNull();
      expect(gate.step(logits(index), 402).accepted?.tool).toBe(tool);
      expect(gate.step(logits(index), 469).accepted).toBeNull();
      expect(gate.step(logits(index), 804).accepted).toBeNull();
    },
  );

  it('requires sustained thumbs-up evidence and restarts on a weak frame', () => {
    const gate = new TsmShortcutGate();
    warm(gate);
    expect(gate.step(logits(20), 268).accepted).toBeNull();
    expect(gate.step(logits(20), 335).accepted).toBeNull();
    expect(gate.step(withConfidence(20, .74), 402).accepted).toBeNull();
    expect(gate.step(logits(20), 469).accepted).toBeNull();
    expect(gate.step(logits(20), 536).accepted).toBeNull();
    expect(gate.step(logits(20), 603).accepted?.tool).toBe('union');
    expect(gate.step(logits(20), 670).accepted).toBeNull();
  });

  it('keeps listening for swipes when Union is unavailable', () => {
    const gate = new TsmShortcutGate();
    warm(gate);
    for (const time of [268, 335, 402, 469]) {
      expect(gate.step(logits(20), time, false)).toMatchObject({ ready: true, accepted: null, unionUnavailable: true });
    }
    expect(gate.step(logits(16), 536, false).accepted).toBeNull();
    expect(gate.step(logits(16), 603, false).accepted?.tool).toBe('box');
  });

  it('does not count ineligible thumbs-up frames toward a future Union', () => {
    const gate = new TsmShortcutGate();
    warm(gate);
    expect(gate.step(logits(20), 268, false).accepted).toBeNull();
    expect(gate.step(logits(20), 335, true).accepted).toBeNull();
    expect(gate.step(logits(20), 402, true).accepted).toBeNull();
    expect(gate.step(logits(20), 469, true).accepted?.tool).toBe('union');
  });

  it('requires neutral after arming and after a long tracking gap', () => {
    const gate = new TsmShortcutGate();
    for (let i = 0; i < 6; i++) expect(gate.step(logits(20), i * 67).ready).toBe(false);
    warm(gate, 420);
    expect(gate.step(logits(20), 688).accepted).toBeNull();
    expect(gate.step(logits(20), 988)).toMatchObject({ ready: false, accepted: null });
  });

  it('ignores stale results and resets a swipe on a credible competing direction or unrelated result', () => {
    const gate = new TsmShortcutGate();
    warm(gate);
    expect(gate.step(logits(16), 268).accepted).toBeNull();
    expect(gate.step(logits(16), 240).accepted).toBeNull();
    expect(gate.step(withConfidence(17, .62), 335).accepted).toBeNull();
    expect(gate.step(logits(16), 402).accepted).toBeNull();
    expect(gate.step(logits(24), 469).accepted).toBeNull();
    expect(gate.step(logits(17), 536).accepted).toBeNull();
    expect(gate.step(logits(17), 580).accepted).toBeNull();
    expect(gate.step(logits(17), 613).accepted?.tool).toBe('cylinder');
  });

  it('does not combine swipe evidence across two misses or beyond the swipe window', () => {
    const gate = new TsmShortcutGate();
    warm(gate);
    expect(gate.step(logits(16), 268).accepted).toBeNull();
    expect(gate.step(withConfidence(16, .50), 335).accepted).toBeNull();
    expect(gate.step(logits(2), 402).accepted).toBeNull();
    expect(gate.step(logits(16), 469).accepted).toBeNull();
    expect(gate.step(logits(2), 540).accepted).toBeNull();
    expect(gate.step(logits(16), 695).accepted).toBeNull();
    expect(gate.step(logits(16), 762).accepted?.tool).toBe('box');
  });
});
