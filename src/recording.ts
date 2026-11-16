import type { CommandAST } from './shared/types';

/** Records only the CAD canvas and AST, never webcam pixels or microphone audio. */
export function recordDemo(viewport: HTMLCanvasElement, command: () => CommandAST | null) {
  if (!('MediaRecorder' in window) || !HTMLCanvasElement.prototype.captureStream) throw Error('Canvas recording is unavailable in this browser.');
  const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 800;
  const ctx = canvas.getContext('2d')!;
  const stream = canvas.captureStream(20);
  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) { stream.getTracks().forEach(track => track.stop()); throw Error('WebM recording is unavailable.'); }
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2500000 });
  const chunks: BlobPart[] = []; let raf = 0; let stopped = false;
  const started = performance.now();
  const draw = () => {
    ctx.fillStyle = '#f5f4ed'; ctx.fillRect(0, 0, 1280, 800);
    ctx.fillStyle = '#152b2c'; ctx.font = 'bold 32px Arial'; ctx.fillText('palmivo.', 28, 47);
    ctx.font = '13px Consolas, monospace'; ctx.fillText('LOCAL SPATIAL COMPILER / INTERACTION DEMO', 240, 41);
    ctx.fillStyle = '#142b2d'; ctx.fillRect(24, 76, 884, 658);
    const scale = Math.min(884 / viewport.width, 658 / viewport.height);
    const width = viewport.width * scale, height = viewport.height * scale;
    if (width > 0 && height > 0) ctx.drawImage(viewport, 24 + (884 - width) / 2, 76 + (658 - height) / 2, width, height);
    ctx.fillStyle = '#e9efdf'; ctx.fillRect(926, 76, 330, 658);
    ctx.fillStyle = '#152b2c'; ctx.font = 'bold 17px Arial'; ctx.fillText('Abstract syntax tree', 943, 107);
    ctx.font = '12px Consolas, monospace';
    const ast = command(); const lines = ast ? JSON.stringify(ast, null, 2).split('\n') : ['Choose a primitive', 'to begin.'];
    let y = 140;
    for (const line of lines) {
      // Wrap long immutable IDs to fit the side panel without clipping.
      const wrapped = line.match(/.{1,37}/g) || [''];
      for (const piece of wrapped) { if (y < 700) ctx.fillText(piece, 943, y); y += 19; }
    }
    ctx.fillStyle = '#52694e'; ctx.font = '12px Consolas, monospace';
    ctx.fillText('MediaPipe + temporal gesture rules · real Manifold geometry · explicit commit', 26, 762);
    ctx.fillText('CAD canvas + AST recording; input may be gestures, mouse, or keyboard.', 26, 783);
    ctx.fillText(`${((performance.now() - started) / 1000).toFixed(1)} s`, 1185, 762);
    if (!stopped) raf = requestAnimationFrame(draw);
  };
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  draw(); recorder.start(500);
  return {
    stop: () => new Promise<Blob>(resolve => {
      stopped = true; cancelAnimationFrame(raf);
      recorder.onstop = () => { stream.getTracks().forEach(track => track.stop()); resolve(new Blob(chunks, { type: mimeType })); };
      recorder.stop();
    }),
  };
}
