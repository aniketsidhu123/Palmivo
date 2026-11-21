import { describe, expect, it } from 'vitest';
import { TargetActivation, type ActivationInput, type ActivationOutput } from './activation';

const sample = (timestamp: number, patch: Partial<ActivationInput> = {}): ActivationInput => ({
  timestamp, targetId: 'test:click', cursor: { x: 100, y: 100 }, trackingReady: true,
  toolbarArmed: true, pinched: false, pinchStarted: false, pinchReleased: false, pinchClosing: false, ...patch,
});
function hover(fsm: TargetActivation, start = 0, end = 400, fps = 30, patch: Partial<ActivationInput> = {}): { time: number; output: ActivationOutput } {
  let output = fsm.update(sample(start, patch));
  let time = start;
  while (time + 1000 / fps <= end) { time += 1000 / fps; output = fsm.update(sample(time, patch)); }
  return { time, output };
}
function click(fsm: TargetActivation, timestamp: number, patch: Partial<ActivationInput> = {}): ActivationOutput {
  fsm.update(sample(timestamp, { pinchClosing: true, ...patch }));
  return fsm.update(sample(timestamp + 70, { pinchClosing: true, pinched: true, pinchStarted: true, ...patch }));
}

describe('stable target pinch activation', () => {
  it.each(['tool:box', 'tool:commit'])('rejects %s when a closing pinch crosses directly onto its neighbour', targetId => {
    const fsm = new TargetActivation({ maxCaptureDriftPx: 64 });
    hover(fsm, 0, 400, 30, { targetId, targetBounds: { width: 80, height: 40 } });
    fsm.update(sample(450, { targetId, pinchClosing: true }));
    expect(fsm.update(sample(515, { targetId: 'tool:cancel', cursor: { x: 110, y: 100 },
      pinchClosing: true, pinchStarted: true, pinched: true }))).toMatchObject({ activate: null });
  });
  it('scales closing drift to the shorter side of the acquired target', () => {
    const fsm = new TargetActivation({ maxCaptureDriftPx: 64 });
    hover(fsm, 0, 400, 30, { targetBounds: { width: 80, height: 36 } });
    expect(click(fsm, 450, { targetId: null, cursor: { x: 124, y: 100 } }).activate).toBeNull();
    hover(fsm, 600, 1000, 30, { targetBounds: { width: 80, height: 36 } });
    expect(click(fsm, 1050, { targetId: null, cursor: { x: 114, y: 100 } }).activate).toBe('test:click');
  });
  it.each([13, 15, 30])('captures the target before pinch movement crosses its edge at %i FPS', fps => {
    const fsm = new TargetActivation();
    const { time, output } = hover(fsm, 0, 450, fps);
    expect(output.phase).toBe('ready');
    const closing = fsm.update(sample(time + 1000 / fps, { targetId: null, cursor: { x: 110, y: 100 }, pinchClosing: true }));
    expect(closing.phase).toBe('closing'); expect(closing.targetId).toBe('test:click');
    const fired = fsm.update(sample(time + 2000 / fps, { targetId: null, cursor: { x: 120, y: 100 }, pinchClosing: true, pinched: true, pinchStarted: true }));
    expect(fired.activate).toBe('test:click');
  });
  it('requires a stable hover and does not activate a newly entered target', () => {
    const fsm = new TargetActivation(); hover(fsm);
    const fired = click(fsm, 450, { targetId: 'tool:commit', cursor: { x: 300, y: 100 } });
    expect(fired.activate).toBeNull();
  });
  it('rejects capture drift beyond the allowed jitter', () => {
    const fsm = new TargetActivation(); hover(fsm);
    fsm.update(sample(450, { pinchClosing: true }));
    const fired = fsm.update(sample(520, { targetId: null, cursor: { x: 160, y: 100 }, pinchClosing: true, pinched: true, pinchStarted: true }));
    expect(fired.activate).toBeNull();
  });
  it('keeps a captured target while moving within the same large button', () => {
    const fsm = new TargetActivation(); hover(fsm);
    expect(click(fsm, 450, { cursor: { x: 180, y: 100 } }).activate).toBe('test:click');
  });
  it('activates once per pinch and never clicks a new target during a held drag', () => {
    const fsm = new TargetActivation(); hover(fsm); expect(click(fsm, 450).activate).toBe('test:click');
    for (let time = 550; time < 1000; time += 60) {
      expect(fsm.update(sample(time, { targetId: 'tool:commit', cursor: { x: 300, y: 100 }, pinchClosing: true, pinched: true })).activate).toBeNull();
    }
    hover(fsm, 1000, 1400, 15, { targetId: 'tool:commit', cursor: { x: 300, y: 100 } });
    expect(click(fsm, 1450, { targetId: 'tool:commit', cursor: { x: 300, y: 100 } }).activate).toBe('tool:commit');
  });
  it('allows an intentional same-button click after release and a new hover', () => {
    const fsm = new TargetActivation(); hover(fsm); expect(click(fsm, 450).activate).toBe('test:click');
    hover(fsm, 600, 1000); expect(click(fsm, 1050).activate).toBe('test:click');
  });
  it('does not use an old hover immediately after release', () => {
    const fsm = new TargetActivation(); hover(fsm); click(fsm, 450);
    fsm.update(sample(600, { pinchReleased: true }));
    expect(click(fsm, 650).activate).toBeNull();
  });
  it('cancels capture immediately on tracking loss and requires release plus fresh hover', () => {
    const fsm = new TargetActivation(); hover(fsm); fsm.update(sample(450, { pinchClosing: true }));
    expect(fsm.update(sample(480, { trackingReady: false, cursor: null })).phase).toBe('tracking-lost');
    expect(fsm.update(sample(520, { pinched: true, pinchStarted: true, pinchClosing: true })).activate).toBeNull();
    expect(fsm.update(sample(600, { pinched: true, pinchClosing: true })).phase).toBe('release');
    hover(fsm, 700, 1100); expect(click(fsm, 1150).activate).toBe('test:click');
  });
  it('requires the other-hand gate at the confirmation frame', () => {
    const fsm = new TargetActivation(); hover(fsm); fsm.update(sample(450, { pinchClosing: true }));
    expect(fsm.update(sample(520, { toolbarArmed: false, pinched: true, pinchStarted: true, pinchClosing: true })).activate).toBeNull();
    expect(fsm.update(sample(600, { toolbarArmed: true, pinched: true, pinchClosing: true })).activate).toBeNull();
  });
  it('does not arm by moving an initially held pinch onto a button', () => {
    const fsm = new TargetActivation();
    for (let time = 0; time <= 600; time += 60) expect(fsm.update(sample(time, { pinched: true, pinchClosing: true, pinchStarted: time === 0 })).activate).toBeNull();
    hover(fsm, 700, 1100); expect(click(fsm, 1150).activate).toBe('test:click');
  });
  it('supports the debounced rising edge as a compatibility fallback', () => {
    const fsm = new TargetActivation(); hover(fsm);
    expect(fsm.update(sample(450, { pinchClosing: undefined, pinched: true, pinchStarted: true })).activate).toBe('test:click');
  });
});

describe('optional dwell activation', () => {
  it.each([13, 15, 30])('uses elapsed milliseconds instead of frame counts at %i FPS', fps => {
    const fsm = new TargetActivation({ mode: 'dwell' });
    expect(hover(fsm, 0, 850, fps).output.activate).toBeNull();
    let activated: string | null = null;
    for (let time = 900; time <= 1100; time += 1000 / fps) activated ??= fsm.update(sample(time)).activate;
    expect(activated).toBe('test:click');
  });
  it('requires 1200 ms for Commit', () => {
    const fsm = new TargetActivation({ mode: 'dwell' });
    expect(hover(fsm, 0, 1150, 30, { targetId: 'tool:commit' }).output.activate).toBeNull();
    expect(fsm.update(sample(1201, { targetId: 'tool:commit' })).activate).toBe('tool:commit');
  });
  it('blocks new enabled targets under a stationary cursor until physically leaving all targets', () => {
    const fsm = new TargetActivation({ mode: 'dwell' }); hover(fsm, 0, 880); expect(fsm.update(sample(901)).activate).toBe('test:click');
    for (let time = 950; time < 2400; time += 100) expect(fsm.update(sample(time, { targetId: 'tool:commit' })).phase).toBe('leave-targets');
    expect(fsm.update(sample(2400, { targetId: null })).phase).toBe('leave-targets');
    expect(fsm.update(sample(2450, { targetId: null, cursor: { x: 160, y: 100 } })).phase).toBe('idle');
    hover(fsm, 2500, 3650, 30, { targetId: 'tool:commit' });
    expect(fsm.update(sample(3701, { targetId: 'tool:commit' })).activate).toBe('tool:commit');
  });
  it('resets its countdown when the hand pinches or the gate closes', () => {
    const fsm = new TargetActivation({ mode: 'dwell' }); hover(fsm, 0, 800);
    expect(fsm.update(sample(850, { pinchClosing: true })).phase).toBe('release');
    hover(fsm, 900, 1500); expect(fsm.update(sample(1550, { toolbarArmed: false })).activate).toBeNull();
    expect(hover(fsm, 1600, 2400).output.activate).toBeNull(); expect(fsm.update(sample(2501)).activate).toBe('test:click');
  });
  it('mode changes and resets discard previous hover progress', () => {
    const fsm = new TargetActivation(); hover(fsm); fsm.setMode('dwell');
    expect(fsm.update(sample(450)).progress).toBe(0); hover(fsm, 500, 900); fsm.reset(); expect(fsm.update(sample(950)).progress).toBe(0);
  });
});
