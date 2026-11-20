import './collect.css';
import { TrackingClient } from '../tracking/client';
import { downloadJSON } from '../metrics';
import { FEATURE_COUNT, FEATURE_VERSION, FeatureEncoder, type GestureClip, type GestureToken, type LandmarkFrame, type Split } from './features';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = element<HTMLVideoElement>('preview');
const camera = element<HTMLButtonElement>('camera');
const record = element<HTMLButtonElement>('record');
const discard = element<HTMLButtonElement>('discard');
const exportSession = element<HTMLButtonElement>('export');
const split = element<HTMLSelectElement>('split');
const hand = element<HTMLSelectElement>('hand');
const shoulders = element<HTMLInputElement>('shoulders');
const consent = element<HTMLInputElement>('consent');
const status = element('capture-status');
const timeline = element<HTMLInputElement>('timeline');
const ends = element<HTMLInputElement>('ends');
const canvas = element<HTMLCanvasElement>('review-canvas');
const encoder = new FeatureEncoder();
const tokens: GestureToken[] = ['Box', 'Cylinder', 'Union'];
const negatives = ['Keep hands relaxed in view', 'Mimic hovering and pinching a toolbar button', 'Start a square and stop halfway', 'Reach across the workspace', 'Let a hand leave and re-enter the frame', 'Move your hands naturally without drawing a shortcut'];
const sessionId = crypto.randomUUID();
const clips: GestureClip[] = [];
let promptSet: { transcript: GestureToken[]; text: string }[] = [];
let recording: { clip: GestureClip; first: number | undefined; seen: number } | null = null;
let timer: number | null = null;
let countingDown = false;
let requested = false;

function createPrompts(session: Split) {
  const offset = ['train', 'validation', 'test'].indexOf(session);
  const positive = Array.from({ length: 24 }, (_, index) => {
    const first = tokens[(index + offset) % 3];
    const second = tokens[(Math.floor(index / 3) + offset) % 3];
    return index % 4 < 2 ? [first, second] : [first, second, tokens[(index + 1 + offset) % 3]];
  });
  // Each five-clip block includes a prompted background example.
  return Array.from({ length: 30 }, (_, index) => {
    if (index % 5 === 4) return { transcript: [], text: negatives[(Math.floor(index / 5) + offset) % negatives.length] };
    const transcript = positive[((index - Math.floor(index / 5)) * 5 + offset) % positive.length];
    return { transcript, text: transcript.join(' → ') };
  });
}

const tracking = new TrackingClient({
  onFrame(frame: LandmarkFrame) {
    if (!recording) return;
    const clip = recording.clip;
    recording.first ??= frame.timestamp;
    const elapsed = frame.timestamp - recording.first;
    if (elapsed <= (clip.timestampsMs.at(-1) ?? -1)) return;
    clip.timestampsMs.push(elapsed);
    clip.frames.push(Array.from(encoder.encode(frame, hand.value === 'Left' ? 'Left' : 'Right')));
    if (frame.hands.length) recording.seen++;
  },
  onStatus(info) {
    element('camera-status').textContent = info.state === 'running'
      ? info.message + (info.trackingFps ? ` · ${info.trackingFps.toFixed(1)} tracking FPS` : '') : info.message;
    if ((info.state === 'stopped' || info.state === 'error') && (recording || countingDown)) cancel('Recording cancelled because the camera stopped.');
    update();
  },
  onPoseStatus(message) { status.textContent = message; },
});

function update() {
  const prompt = promptSet[clips.length];
  element('prompt').textContent = prompt ? `Clip ${clips.length + 1}/30 · ${prompt.text}` : 'Session complete. Export your JSON.';
  record.disabled = !tracking.active || !consent.checked || !prompt || !!recording || countingDown;
  discard.disabled = !clips.length || !!recording || countingDown;
  exportSession.disabled = !consent.checked || !clips.length || !!recording || countingDown;
  split.disabled = hand.disabled = shoulders.disabled = clips.length > 0 || !!recording || countingDown;
}

function cancel(message: string) {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  countingDown = false;
  recording = null;
  status.textContent = message;
  update();
}

function finish() {
  const take = recording;
  if (!take) return;
  if (take.clip.frames.length < 30 || take.clip.transcript.length && take.seen < 20) {
    cancel('Too few usable tracking samples. Keep your gestures in view and try again.');
    return;
  }
  const markers = take.clip.gestureEndMs;
  if (markers?.length !== take.clip.transcript.length || markers?.some(ms => ms > take.clip.timestampsMs.at(-1)!)) delete take.clip.gestureEndMs;
  clips.push(take.clip);
  requested = false;
  cancel(`Saved ${clips.length}/30 clips in this tab. Export JSON to keep them.`);
  showLast();
}

function showLast() {
  const clip = clips.at(-1);
  element('review').hidden = !clip;
  if (!clip) return;
  timeline.max = String(clip.frames.length - 1);
  timeline.value = '0';
  ends.value = clip.gestureEndMs?.map(Math.round).join(', ') ?? '';
  ends.disabled = (element<HTMLButtonElement>('save-ends').disabled = clip.transcript.length === 0);
  const visible = clip.frames.filter(row => row[9] || row[21 * FEATURE_COUNT + 9]).length;
  element('coverage').textContent = `${clip.transcript.join(' → ') || 'Background'} · ${clip.frames.length} observations · ${visible} with a tracked hand`;
  drawReview();
}

function drawReview() {
  const clip = clips.at(-1);
  const index = Number(timeline.value);
  const frame = clip?.frames[index];
  const context = canvas.getContext('2d');
  if (!clip || !frame || !context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  element('position').textContent = `${Math.round(clip.timestampsMs[index])} ms · wrist positions`;
  for (const [role, color] of ['#c5f2bd', '#ffcb8a'].entries()) {
    context.strokeStyle = context.fillStyle = color;
    const offset = role * 21 * FEATURE_COUNT;
    let connected = false;
    context.beginPath();
    for (const sample of clip.frames.slice(Math.max(0, index - 24), index + 1)) {
      if (!sample[offset + 9]) { connected = false; continue; }
      const x = (1 - sample[offset + 3]) * canvas.width;
      const y = sample[offset + 4] * canvas.height;
      if (connected) context.lineTo(x, y); else context.moveTo(x, y);
      connected = true;
    }
    context.stroke();
    if (!frame[offset + 9]) continue;
    context.beginPath();
    context.arc((1 - frame[offset + 3]) * canvas.width, frame[offset + 4] * canvas.height, 5, 0, Math.PI * 2);
    context.fill();
  }
}

camera.addEventListener('click', async () => {
  if (tracking.active) { tracking.stop(); camera.textContent = 'Enable camera'; return; }
  camera.disabled = true;
  try {
    await tracking.start(video);
    tracking.setPoseEnabled(shoulders.checked);
    camera.textContent = 'Stop camera';
  } catch { camera.textContent = 'Enable camera'; }
  finally { camera.disabled = false; update(); }
});
record.addEventListener('click', () => {
  if (!tracking.active || !consent.checked || !promptSet[clips.length]) return;
  countingDown = true;
  status.textContent = 'Get ready. Recording starts in two seconds.';
  update();
  timer = window.setTimeout(() => {
    if (!tracking.active || !consent.checked) { cancel('Recording cancelled.'); return; }
    encoder.reset();
    const { transcript } = promptSet[clips.length];
    recording = { clip: { id: `${sessionId}-${clips.length + 1}`, timestampsMs: [], frames: [], transcript, gestureEndMs: [] }, first: undefined, seen: 0 };
    countingDown = false;
    status.textContent = 'Recording now. Perform the prompt, then relax until the clip ends.';
    timer = window.setTimeout(finish, 6200);
  }, 2000);
});
window.addEventListener('keydown', event => {
  const take = recording;
  if (event.code !== 'KeyJ' || event.repeat || !take?.clip.gestureEndMs || take.first === undefined) return;
  if (take.clip.gestureEndMs.length < take.clip.transcript.length) {
    take.clip.gestureEndMs.push(performance.now() - take.first);
    status.textContent = `Recording. Marked ${take.clip.gestureEndMs.length}/${take.clip.transcript.length} gesture ends.`;
  }
});
discard.addEventListener('click', () => { clips.pop(); requested = false; showLast(); update(); status.textContent = 'Last clip discarded.'; });
timeline.addEventListener('input', drawReview);
element('save-ends').addEventListener('click', () => {
  const clip = clips.at(-1);
  if (!clip?.transcript.length) return;
  const markers = ends.value.split(',').map(value => value.trim() ? Number(value.trim()) : NaN);
  if (markers.length !== clip.transcript.length || markers.some((ms, index) => !Number.isFinite(ms) || ms < 0 ||
    ms > clip.timestampsMs.at(-1)! || (index > 0 && ms <= markers[index - 1]))) {
    status.textContent = 'Enter one increasing marker time per token within the clip duration.';
    return;
  }
  clip.gestureEndMs = markers;
  requested = false;
  status.textContent = 'Gesture end markers saved.';
});
split.addEventListener('change', () => { promptSet = createPrompts(split.value as Split); update(); });
shoulders.addEventListener('change', () => tracking.setPoseEnabled(shoulders.checked));
consent.addEventListener('change', () => {
  if (!consent.checked && (recording || countingDown)) cancel('Recording cancelled.');
  update();
});
exportSession.addEventListener('click', () => {
  if (!consent.checked || !clips.length || recording || countingDown) return;
  const featureSet = shoulders.checked ? 'hands+shoulders' : 'hands';
  downloadJSON(`palmivo-${split.value}-${sessionId}.json`, {
    schemaVersion: 1, featureVersion: FEATURE_VERSION, source: 'presenter', featureSet,
    sessionId, split: split.value, pointerHand: hand.value, camera: tracking.cameraInfo, clips,
  });
  requested = true;
  status.textContent = 'Export requested. Keep the downloaded file in your local recording folder.';
});
window.addEventListener('beforeunload', event => { if (clips.length && !requested) event.preventDefault(); });
window.addEventListener('pagehide', () => tracking.stop());
void fetch('./tracking/pose_landmarker_lite.task', { method: 'HEAD' }).then(result => {
  element('shoulder-label').hidden = !result.ok || !result.headers.get('content-type')?.includes('application/octet-stream') && !result.headers.get('content-type')?.includes('application/vnd');
}).catch(() => {});
promptSet = createPrompts('train');
update();
