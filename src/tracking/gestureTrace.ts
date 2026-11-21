import type { GestureOutput } from '../shared/types';
import type { ActivationOutput } from './activation';
import { TsmShortcutGate, type TsmPrediction } from '../tsm/shortcuts';

interface TraceEvent {
  kind: string;
  at: number;
  [field: string]: unknown;
}
interface Attempt {
  expected: string;
  adaptivePointer: boolean;
  tolerantThumb: boolean;
  start: number;
  end?: number;
  events: TraceEvent[];
}

const MAX_EVENTS = 30_000;
export class GestureTrace {
  adaptivePointer = false;
  tolerantThumb = false;
  onFull?: () => void;
  private attempts: Attempt[] = [];
  private active: Attempt | null = null;
  private count = 0;
  get recording() { return this.active !== null; }
  get full() { return this.count >= MAX_EVENTS; }
  get length() { return this.attempts.length; }

  begin(expected: string, at: number): boolean {
    if (this.active || this.full || !expected.trim()) return false;
    this.active = { expected: expected.trim(), start: at, adaptivePointer: this.adaptivePointer, tolerantThumb: this.tolerantThumb, events: [] };
    this.attempts.push(this.active);
    this.event('attempt-start', at);
    return true;
  }
  finish(at: number): void {
    if (this.active) this.active.end = at;
    this.active = null;
  }
  clear(): void { this.active = null; this.attempts = []; this.count = 0; }
  event(kind: string, at: number, fields: Record<string, unknown> = {}): void {
    if (!this.active || this.full) return;
    this.active.events.push({ ...fields, kind, at });
    this.count++;
    if (this.full) { this.finish(at); this.onFull?.(); }
  }
  pointer(output: GestureOutput, cursor: { x: number; y: number } | null, hovered: string | null, activation: ActivationOutput | null): void {
    if (!this.active) return;
    this.event('pointer', output.timestamp, {
      cursor, raw: output.rawCursor, hovered, captured: activation?.targetId ?? null,
      phase: activation?.phase ?? 'tracking-lost', activated: activation?.activate ?? null,
      closing: !!output.pinchClosing, onset: output.pinchStarted, armed: output.toolbarArmed, ready: output.trackingReady,
    });
  }
  prediction(at: number, logits: Float32Array, decision: TsmPrediction, unionAvailable: boolean): void {
    if (!this.active) return;
    this.event('prediction', at, { decidedAt: performance.now(), logits: Array.from(logits), unionAvailable, ready: decision.ready,
      confidence: decision.confidence, candidate: decision.shortcut?.tool ?? null,
      unavailable: !!decision.unionUnavailable, accepted: decision.accepted?.tool ?? null });
  }
  report() {
    return { format: 'palmivo-gesture-trace', version: 1, timeUnit: 'ms', cursorUnit: 'CSS pixels',
      rawCursorUnit: 'normalized workspace', eventLimitReached: this.full,
      attempts: this.attempts.map(attempt => ({
        ...attempt, measurements: measureAttempt(attempt), replay: {
          baseline: replayTsm(attempt.events, false),
          tolerantThumb: replayTsm(attempt.events, true),
        },
      })),
    };
  }
}

function measureAttempt({ events, expected, start, end }: Attempt) {
  const listen = events.find(event => event.kind === 'listen-request');
  const arm = events.find(event => event.kind === 'arm');
  const ready = events.find(event => event.kind === 'prediction' && event.ready);
  const gestureEnd = events.find(event => event.kind === 'observer-gesture-end');
  const opened = events.find(event => event.kind === 'draft-result' && event.opened);
  const clicks = events.filter(event => event.kind === 'pointer' && event.activated);
  const shortcut = ['box', 'cylinder', 'union', 'idle'].includes(expected);
  const first = shortcut ? opened?.tool : clicks[0]?.activated;
  let neutralSince: number | null = null, armedMs = 0;
  for (const event of events) {
    if (event.kind === 'prediction' && event.ready) neutralSince ??= Number(event.decidedAt ?? event.at);
    else if (neutralSince !== null && (event.kind === 'arm' || event.kind === 'stop' || event.kind === 'evidence-reset' ||
      event.kind === 'prediction' && !event.ready)) {
      armedMs += Math.max(0, Number(event.decidedAt ?? event.at) - neutralSince);
      neutralSince = null;
    }
  }
  if (neutralSince !== null && end !== undefined) armedMs += Math.max(0, end - neutralSince);
  const result = expected === 'steady' ? 'stationary sample' : end === undefined ? 'unfinished' :
    expected === 'idle' ? (opened ? 'unintended draft' : ready ? 'no draft' : 'never armed') :
    first === expected ? 'correct' : first ? 'wrong target' : 'missed';

  let stationaryJitterP95Px: number | null = null;
  if (expected === 'steady') {
    const points = events.filter(event => event.kind === 'pointer' && event.ready && event.cursor)
      .map(event => event.cursor as { x: number; y: number });
    if (points.length) {
      const quantile = (values: number[], percentile: number) => {
        values.sort((a, b) => a - b);
        return values[Math.max(0, Math.ceil(values.length * percentile) - 1)];
      };
      const x = quantile(points.map(p => p.x), .5), y = quantile(points.map(p => p.y), .5);
      stationaryJitterP95Px = quantile(points.map(p => Math.hypot(p.x - x, p.y - y)), .95);
    }
  }
  return {
    result, first: first ?? null, activations: clicks.length,
    neutralReadyListeningMs: armedMs,
    reason: events.filter(event => event.kind === 'stop').at(-1)?.reason ?? null,
    startToFirstPointerActivationMs: clicks.length ? clicks[0].at - start : null,
    listenRequestToModelAvailableMs: listen && arm ? arm.at - listen.at : null,
    neutralReadyFromArmMs: ready && arm ? Number(ready.decidedAt ?? ready.at) - arm.at : null,
    observerGestureEndToDraftMs: gestureEnd && opened ? opened.at - gestureEnd.at : null,
    stationaryJitterP95Px,
  };
}

/** Compare the two gates on identical recorded evidence. Replay ends with the live listening interval. */
function replayTsm(events: TraceEvent[], tolerantThumb: boolean) {
  const gate = new TsmShortcutGate(tolerantThumb);
  const suggestions: { tool: string; frameAt: number }[] = [];
  for (const event of events) {
    if (event.kind === 'arm' || event.kind === 'evidence-reset') gate.reset();
    if (event.kind !== 'prediction' || !Array.isArray(event.logits)) continue;
    const decision = gate.step(Float32Array.from(event.logits), event.at, event.unionAvailable === true);
    if (decision.accepted) suggestions.push({ tool: decision.accepted.tool, frameAt: event.at });
  }
  return suggestions;
}

export const gestureTrace = new GestureTrace();

export function mountGestureTrace(container: HTMLElement, setAdaptivePointer?: (enabled: boolean) => void) {
  const panel = document.createElement('details');
  panel.className = 'performance-panel';
  panel.innerHTML = `
    <summary>Gesture rehearsal</summary>
    <p>Record one labelled attempt locally. Use tool:box for a palette click, box for a swipe, steady for pointer jitter or idle for a background trial. The trace includes cursor positions, button events and TSM scores.</p>
    <label>Intended target <input data-target value="test:click" list="rehearsal-targets" maxlength="100"></label>
    <datalist id="rehearsal-targets"><option>test:click</option><option>tool:commit</option><option>box</option><option>cylinder</option><option>union</option><option>idle</option><option>steady</option></datalist>
    <label><input data-adaptive type="checkbox"> Trial adaptive pointer</label>
    <label><input data-thumb type="checkbox"> Trial thumbs-up tolerance</label>
    <div class="benchmark-actions"><button type="button" data-start>Start attempt</button>
    <button type="button" data-mark>Mark gesture end (Alt+J)</button>
    <button type="button" data-finish>Finish attempt</button>
    <button type="button" data-export>Export trace</button>
    <button type="button" data-clear>Clear trace</button></div>
    <p data-status role="status"></p>`;
  const button = (selector: string) => panel.querySelector<HTMLButtonElement>(selector)!;
  const input = (selector: string) => panel.querySelector<HTMLInputElement>(selector)!;
  const expected = input('[data-target]'), adaptive = input('[data-adaptive]'), thumb = input('[data-thumb]');
  const start = button('[data-start]'), mark = button('[data-mark]'), finish = button('[data-finish]');
  const save = button('[data-export]'), clear = button('[data-clear]');
  const status = panel.querySelector<HTMLElement>('[data-status]')!;
  function refresh() {
    const active = gestureTrace.recording;
    start.disabled = active || !expected.value.trim() || gestureTrace.full;
    expected.disabled = adaptive.disabled = thumb.disabled = active;
    mark.disabled = finish.disabled = !active;
    save.disabled = clear.disabled = active || !gestureTrace.length;
    status.textContent = active ? `Recording attempt ${gestureTrace.length}.` :
      gestureTrace.full ? 'Trace full. Export and clear to continue.' : `${gestureTrace.length} recorded attempts.`;
  }
  adaptive.onchange = () => { gestureTrace.adaptivePointer = adaptive.checked; setAdaptivePointer?.(adaptive.checked); };
  thumb.onchange = () => { gestureTrace.tolerantThumb = thumb.checked; };
  expected.oninput = refresh;
  start.onclick = () => {
    gestureTrace.begin(expected.value, performance.now());
    gestureTrace.event('viewport', performance.now(), { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio });
    refresh();
  };
  function markEnd() {
    if (!gestureTrace.recording) return;
    gestureTrace.event('observer-gesture-end', performance.now());
    status.textContent = 'Gesture end marked.';
  }
  mark.onclick = markEnd;
  document.addEventListener('keydown', event => {
    if (gestureTrace.recording && event.altKey && event.code === 'KeyJ' && !event.repeat) {
      event.preventDefault(); markEnd();
    }
  });
  finish.onclick = () => { gestureTrace.finish(performance.now()); refresh(); };
  clear.onclick = () => { gestureTrace.clear(); refresh(); };
  save.onclick = () => {
    const blob = new Blob([JSON.stringify(gestureTrace.report())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'Palmivo-gesture-trace.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  panel.addEventListener('toggle', refresh);
  gestureTrace.onFull = refresh;
  container.append(panel); refresh();
}
