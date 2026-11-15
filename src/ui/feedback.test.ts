import { describe, expect, it } from 'vitest';
import { CONFIRMATION_DURATION_MS, manipulationInstruction, resolveInstruction } from './feedback';

describe('manipulation instructions', () => {
  it('keeps active scaling focused on continuous manipulation and shows the actual scale', () => {
    const instruction = manipulationInstruction({ kind: 'scale', phase: 'active', value: 1.42 }, 'scale')!;
    expect(instruction).toContain('1.42×');
    expect(instruction).toMatch(/apart or together/i);
    expect(instruction).not.toMatch(/open.*(?:hand|palm)|straighten.*finger|choose.*button/i);
  });

  it('makes release a held preview with explicit Commit rather than claiming execution', () => {
    const instruction = manipulationInstruction({ kind: 'scale', phase: 'held', value: 1.6 }, 'scale')!;
    expect(instruction).toMatch(/held.*1\.60×/i);
    expect(instruction).toMatch(/choose commit/i);
    expect(instruction).toMatch(/pinch both hands to adjust/i);
    expect(instruction).not.toMatch(/committed|applied|saved/i);
  });

  it('allows reacquisition without insisting every short tracking gap needs a release', () => {
    const instruction = manipulationInstruction({ kind: 'scale', phase: 'paused' }, 'scale')!;
    expect(instruction).toMatch(/show both hands/i);
    expect(instruction).toMatch(/if needed/i);
    expect(instruction).not.toMatch(/must|release both.*to resume/i);
  });

  it('gives ready-scale instructions for both hands instead of toolbar activation', () => {
    const instruction = manipulationInstruction({ kind: 'scale', phase: 'ready' }, 'scale')!;
    expect(instruction).toMatch(/pinch both hands/i);
    expect(instruction).toMatch(/space between/i);
    expect(instruction).not.toMatch(/open.*(?:other|palm)|straighten/i);
  });

  it('keeps moving active until release and offers Commit only for the held preview', () => {
    expect(manipulationInstruction({ kind: 'move', phase: 'active' }, 'move')).toMatch(/keep pinching.*drag/i);
    expect(manipulationInstruction({ kind: 'move', phase: 'held' }, 'move')).toMatch(/position held.*choose commit/i);
  });

  it('suppresses stale operation feedback after cancel, commit, or operation change', () => {
    const feedback = { kind: 'scale' as const, phase: 'active' as const, value: 1.5 };
    expect(manipulationInstruction(feedback, undefined)).toBeNull();
    expect(manipulationInstruction(feedback, 'subtract')).toBeNull();
    expect(manipulationInstruction(feedback, 'move')).toBeNull();
    expect(manipulationInstruction(null, 'scale')).toBeNull();
  });

  it.each([undefined, NaN, Infinity, -Infinity])('does not expose an invalid numeric scale (%s)', value => {
    expect(manipulationInstruction({ kind: 'scale', phase: 'active', value }, 'scale')).not.toMatch(/NaN|Infinity|undefined/);
  });
});

describe('instruction priority', () => {
  it('preserves an accepted action across newer tracking frames for the full 800 ms', () => {
    const acceptedAt = 1000;
    const confirmation = { message: 'Cutter selected: Cylinder 2', until: acceptedAt + CONFIRMATION_DURATION_MS };
    for (const now of [1000, 1016, 1250, 1600, 1799]) {
      expect(resolveInstruction({ confirmation, now, context: `New tracking frame at ${now}`, base: 'Ready' }))
        .toEqual({ message: confirmation.message, confirmed: true });
    }
    expect(CONFIRMATION_DURATION_MS).toBe(800);
  });

  it('returns to current manipulation context at expiry instead of stale confirmation or generic toolbar advice', () => {
    const context = manipulationInstruction({ kind: 'scale', phase: 'held', value: 1.42 }, 'scale');
    const resolved = resolveInstruction({ confirmation: { message: 'Scale chosen', until: 1800 }, now: 1800, context, base: 'Open your other hand' });
    expect(resolved.confirmed).toBe(false);
    expect(resolved.message).toMatch(/scale held.*1\.42×.*commit/i);
    expect(resolved.message).not.toMatch(/open your other hand/i);
  });

  it('uses the latest base instruction when there is no active manipulation', () => {
    const input = { confirmation: { message: 'Old confirmation', until: 800 }, now: 900, context: null, base: 'Choose a cutter for Box 1' };
    expect(resolveInstruction(input)).toEqual({ message: input.base, confirmed: false });
    expect(resolveInstruction({ ...input, confirmation: null })).toEqual({ message: input.base, confirmed: false });
  });
});
