import { inspectionAvailable, runInspection, type InspectionResult } from '../core/inspection';
import { exportSolidSTL } from '../core/stlExport';
import type { GeometryMesh, SceneDocument, Solid } from '../shared/types';
import './inspection.css';

export interface InspectionSelection {
  scene: SceneDocument;
  solid: Solid;
  mesh: GeometryMesh;
}

export function mountInspectionPanel(
  host: HTMLElement,
  selection: () => InspectionSelection | null,
  ready: () => boolean,
  onAudioStart: (durationMs: number) => void,
) {
  const panel = document.createElement('section');
  panel.className = 'inspection-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Spoken mesh inspection');
  panel.innerHTML = `
    <button id="inspect-aloud" class="stl-export-button" type="button" aria-describedby="inspection-disclosure" disabled>
      <svg viewBox="0 0 24 24" class="icon" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4 5.5 9H3v6h2.5l5.5 5zM15 8a5 5 0 0 1 0 8m3-11a9 9 0 0 1 0 14"/></svg>
      <span>Inspect aloud</span>
    </button>
    <p id="inspection-disclosure">Sends the selected STL and revision to Render.</p>
    <details class="inspection-privacy">
      <summary>Data handling</summary>
      <p>Render retains workflow inputs and results for 30 days. ElevenLabs receives only the inspection caption. Camera and project data stay on your device.</p>
    </details>
    <p id="inspection-status" role="status" hidden></p>
    <div class="inspection-result" hidden>
      <p id="inspection-revision"></p>
      <p id="inspection-caption"></p>
      <p id="inspection-facts"></p>
    </div>
    <p id="inspection-run" hidden></p>
    <p id="inspection-latency" hidden></p>
    <div class="inspection-playback" hidden>
      <button type="button" id="inspection-replay" class="outline-button">Play again</button>
      <button type="button" id="inspection-mute" class="outline-button" aria-pressed="false">Mute</button>
    </div>`;
  host.after(panel);
  const inspect = panel.querySelector<HTMLButtonElement>('#inspect-aloud')!;
  const status = panel.querySelector<HTMLElement>('#inspection-status')!;
  const resultCard = panel.querySelector<HTMLElement>('.inspection-result')!;
  const revision = panel.querySelector<HTMLElement>('#inspection-revision')!;
  const caption = panel.querySelector<HTMLElement>('#inspection-caption')!;
  const facts = panel.querySelector<HTMLElement>('#inspection-facts')!;
  const run = panel.querySelector<HTMLElement>('#inspection-run')!;
  const latency = panel.querySelector<HTMLElement>('#inspection-latency')!;
  const playback = panel.querySelector<HTMLElement>('.inspection-playback')!;
  const replay = panel.querySelector<HTMLButtonElement>('#inspection-replay')!;
  const mute = panel.querySelector<HTMLButtonElement>('#inspection-mute')!;
  const audio = new Audio();
  const lifecycle = new AbortController();
  let mediaUrl: string | null = null;
  let pending: AbortController | null = null;
  let completed: { subject: InspectionSelection; result: InspectionResult } | null = null;
  let stale = false;
  let muted = false;
  let firstAudioAt: number | null = null;
  let resultLatencyMs = 0;

  function showLatency(audioMs?: number) {
    const seconds = (ms: number) => (ms / 1_000).toFixed(2) + ' s';
    latency.textContent = `Result ${seconds(resultLatencyMs)}${audioMs === undefined ? '' : ` · Audio started ${seconds(audioMs)}`}`;
    latency.hidden = false;
  }

  function isSame(subject: InspectionSelection): boolean {
    const current = selection();
    return current?.scene === subject.scene && current.solid === subject.solid && current.mesh === subject.mesh;
  }

  function setStatus(message: string) {
    status.textContent = message;
    status.hidden = !message;
  }

  function showRun(runId: string) {
    run.textContent = runId ? `Render run ${runId}` : '';
    run.hidden = !runId;
  }

  function refresh() {
    inspect.disabled = panel.hidden || !!pending || !ready() || !selection();
    if (!completed) return;
    if (!stale && !isSame(completed.subject)) {
      stale = true;
      audio.pause();
      firstAudioAt = null;
      setStatus('Earlier inspection. Select Inspect aloud to check the current solid.');
    }
    revision.textContent = `${stale ? 'Earlier result · ' : ''}Revision ${completed.result.revision}`;
  }

  function clearAudio() {
    audio.pause();
    audio.removeAttribute('src');
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    mediaUrl = null;
    firstAudioAt = null;
    playback.hidden = true;
  }

  async function play() {
    if (!mediaUrl || muted) return;
    audio.currentTime = 0;
    const track = mediaUrl;
    try { await audio.play(); }
    catch {
      if (track !== mediaUrl || stale || muted) return;
      setStatus('Inspection complete. Select Play audio to hear it.');
      replay.textContent = 'Play audio';
    }
  }

  audio.addEventListener('playing', () => {
    replay.textContent = 'Play again';
    if (!stale) setStatus('Inspection complete · ElevenLabs audio');
    if (firstAudioAt !== null && !stale) {
      const audioMs = performance.now() - firstAudioAt;
      showLatency(audioMs);
      onAudioStart(audioMs);
    }
    firstAudioAt = null;
  });
  audio.addEventListener('error', () => {
    if (!mediaUrl || stale) return;
    clearAudio();
    setStatus('Inspection complete. Audio could not play.');
  });
  replay.addEventListener('click', () => {
    if (!mediaUrl) return;
    if (muted) setMuted(false);
    void play();
  });
  function setMuted(next: boolean) {
    muted = next;
    audio.muted = muted;
    if (muted) audio.pause();
    mute.setAttribute('aria-pressed', String(muted));
    mute.textContent = muted ? 'Unmute' : 'Mute';
  }
  mute.addEventListener('click', () => setMuted(!muted));

  async function inspectSelected() {
    const subject = selection();
    if (inspect.disabled || pending || !ready() || !subject) return;
    if (!stale && completed && isSame(completed.subject)) {
      if (mediaUrl && !muted) void play();
      return;
    }
    const request = new AbortController();
    pending = request;
    completed = null;
    stale = false;
    clearAudio();
    showRun('');
    latency.hidden = true;
    resultCard.hidden = true;
    setStatus('Uploading selected solid…');
    refresh();
    try {
      const stl = exportSolidSTL(subject.solid, subject.mesh);
      const postedAt = performance.now();
      const reply = await runInspection(stl.data, subject.scene.revision, request.signal, (runId, phase) => {
        showRun(runId);
        setStatus(phase === 'queued' ? 'Queued on Render…' : 'Checking mesh and preparing speech…');
      });
      if (request.signal.aborted) return;
      const { result } = reply;
      completed = { subject, result };
      caption.textContent = result.caption;
      facts.textContent = `${result.dimensionsMm.map(value => Number(value.toFixed(2))).join(' × ')} mm · ${result.triangles.toLocaleString('en')} triangles`;
      resultLatencyMs = performance.now() - postedAt;
      showLatency();
      resultCard.hidden = false;
      setStatus(result.audioStatus === 'ready' ? 'Inspection complete.' : 'Inspection complete. Voice is unavailable.');
      refresh();
      if (!result.audioBase64 || result.audioStatus !== 'ready') return;
      try {
        const bytes = Uint8Array.from(atob(result.audioBase64), char => char.charCodeAt(0));
        mediaUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
        audio.src = mediaUrl;
        playback.hidden = false;
        replay.textContent = 'Play audio';
        if (!stale && !muted) {
          firstAudioAt = postedAt;
          void play();
        }
      } catch { setStatus('Inspection complete. Audio could not play.'); }
    } catch (error) {
      if (!request.signal.aborted) setStatus(error instanceof Error && error.name !== 'TypeError' ? error.message : 'Could not reach the inspection service. Try again when connected.');
    } finally {
      pending = null;
      refresh();
    }
  }

  inspect.addEventListener('click', () => void inspectSelected());
  void inspectionAvailable(lifecycle.signal).then(enabled => {
    if (lifecycle.signal.aborted) return;
    panel.hidden = !enabled;
    refresh();
  });

  return {
    buttons: new Map([['inspect:run', inspect], ['inspect:replay', replay], ['inspect:mute', mute]]),
    refresh,
    dispose() {
      lifecycle.abort();
      pending?.abort();
      clearAudio();
    },
  };
}
