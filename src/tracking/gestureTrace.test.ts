import { describe, expect, it } from 'vitest';
import { GestureTrace } from './gestureTrace';

describe('local gesture rehearsal', () => {
  it('records only explicitly labelled attempts and stops appending on finish', () => {
    const trace = new GestureTrace();
    trace.event('arm', 20);
    expect(trace.begin(' ', 30)).toBe(false);
    expect(trace.report().attempts).toHaveLength(0);
    expect(trace.begin('tool:commit', 50)).toBe(true);
    expect(trace.begin('box', 60)).toBe(false);
    trace.event('pointer', 100, { activated: 'tool:cancel' });
    trace.event('pointer', 140, { activated: 'tool:commit' });
    trace.finish(150);
    trace.event('pointer', 160, { activated: 'tool:box' });
    expect(trace.report().attempts[0].measurements).toMatchObject({ result: 'wrong target',
      first: 'tool:cancel', activations: 2, startToFirstPointerActivationMs: 50 });
    trace.clear();
    expect(trace.report().attempts).toHaveLength(0);
  });
  it('replays full class scores independently of the live choice and separates timing stages', () => {
    const trace = new GestureTrace();
    trace.begin('union', 0);
    trace.event('listen-request', 20);
    trace.event('arm', 160);
    function frame(at: number, winner: number, confidence: number, ready: boolean) {
      const logits = Array(27).fill(0);
      logits[winner] = Math.log(26 * confidence / (1 - confidence));
      trace.event('prediction', at, { decidedAt: at + 40, logits, unionAvailable: true, ready });
    }
    for (const t of [180, 247, 314, 381]) frame(t, 2, .99, t === 381);
    frame(448, 20, .95, true);
    frame(515, 20, .71, true);
    frame(582, 20, .98, true);
    frame(649, 20, .97, true);
    trace.event('observer-gesture-end', 610);
    trace.event('draft-result', 705, { opened: true, tool: 'union' });
    trace.finish(800);
    const attempt = trace.report().attempts[0];
    expect(attempt.replay).toEqual({ baseline: [], tolerantThumb: [{ tool: 'union', frameAt: 649 }] });
    expect(attempt.measurements).toMatchObject({ result: 'correct', listenRequestToModelAvailableMs: 140,
      neutralReadyFromArmMs: 261, observerGestureEndToDraftMs: 95 });
  });
  it('distinguishes never listening from armed negatives and measures stationary jitter separately', () => {
    const trace = new GestureTrace();
    trace.begin('idle', 0); trace.finish(100);
    trace.begin('idle', 200); trace.event('arm', 220);
    trace.event('prediction', 360, { ready: true, decidedAt: 405 }); trace.finish(600);
    trace.begin('steady', 700);
    for (const [i, offset] of [0, 1, 2, 3, 4].entries()) {
      trace.event('pointer', 720 + i * 33, { ready: true, cursor: { x: 200 + offset, y: 110 } });
    }
    trace.finish(920);
    const results = trace.report().attempts.map(a => a.measurements);
    expect(results.map(m => m.result)).toEqual(['never armed', 'no draft', 'stationary sample']);
    expect(results[1].neutralReadyListeningMs).toBe(195);
    expect(results[2].stationaryJitterP95Px).toBe(2);
  });
});
