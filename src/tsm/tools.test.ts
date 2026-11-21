import { afterEach, expect, it, vi } from 'vitest';
import { mountTsmTools } from './tools';

const { infer } = vi.hoisted(() => ({ infer: vi.fn() }));
vi.mock('./runtime', () => ({
  TsmRuntime: class {
    loaded = true;
    processing = false;
    step = infer;
    close() {}
  },
}));

// This test exercises camera-callback ordering and the real time-based shortcut gate.
// Only the worker reply, the clock and the small UI surface are replaced.
function element() {
  const listeners = new Map<string, () => void>();
  return {
    dataset: {}, setAttribute() {}, removeAttribute() {}, prepend() {}, append() {}, remove() {},
    querySelector: () => element(),
    addEventListener(type: string, callback: () => void) { listeners.set(type, callback); },
    click() { listeners.get('click')?.(); },
  } as unknown as HTMLElement;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); infer.mockReset(); });

it('drops an already captured swipe when the hand disappears and returns during inference', async () => {
  let now = 0, pointer = true;
  let finish!: (label: number) => void;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('document', { createElement: element });
  vi.stubGlobal('createImageBitmap', async () => ({ close() {} }));
  infer.mockImplementation((_bitmap, timestamp: number) => new Promise(resolve => {
    finish = label => {
      const logits = new Float32Array(27); logits[label] = 10;
      resolve({ timestamp, preprocessMs: 0, inferenceMs: 20, logits });
    };
  }));
  const onOpenDraft = vi.fn(() => true);
  const tools = mountTsmTools(element(), element(), { canListen: () => true, canAccept: () => pointer,
    unionAvailable: () => true, onTiming: () => {}, onOpenDraft });
  const video = { readyState: 4 } as HTMLVideoElement;
  function tick() { return new Promise<void>(resolve => setTimeout(resolve, 0)); }
  async function frame(ms: number, label: number, interrupt = false) {
    now = ms;
    tools.sample(video, ms, ms / 1000);
    await tick();
    if (interrupt) { pointer = false; tools.pointerLost(); pointer = true; }
    finish(label);
    await tick();
  }
  try {
    tools.button.click();
    for (const t of [0, 67, 134, 201]) await frame(t, 2);
    await frame(268, 16);
    await frame(335, 16, true);
    expect(onOpenDraft).not.toHaveBeenCalled();
    await frame(402, 16);
    expect(infer.mock.calls.at(-1)?.[2]).toBe(true);
    expect(onOpenDraft).not.toHaveBeenCalled();
    // Reacquiring a neutral sequence permits a fresh complete swipe.
    for (const t of [469, 536, 603, 670]) await frame(t, 2);
    await frame(737, 16);
    await frame(804, 16);
    expect(onOpenDraft).toHaveBeenCalledExactlyOnceWith('box');
    expect(tools.mode()).toBe('rules');
  } finally { tools.dispose(); }
});
