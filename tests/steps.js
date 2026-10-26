import { guideFor } from '../src/geometry.js';
// A synthetic document camera; no fixture model is loaded before the application.
const tracks = [], workers = [];
const NativeWorker = window.Worker;
window.Worker = class extends NativeWorker {
  constructor(url, options) { super(url, options); this.testURL = String(url); this.stopped = false; workers.push(this); }
  terminate() { this.stopped = true; super.terminate(); }
};
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
  const shell = document.getElementById('camera-shell'), canvas = document.createElement('canvas');
  canvas.width = Math.round(shell.clientWidth * 1.5); canvas.height = Math.round(shell.clientHeight * 1.5);
  const ctx = canvas.getContext('2d');
  const draw = () => {
    const g = guideFor(canvas.width, canvas.height, 'document');
    ctx.fillStyle = '#243127'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ebe8d7'; ctx.fillRect(g.x + 20, g.y + 20, g.width - 40, g.height - 40);
    ctx.fillStyle = '#85877b'; ctx.fillRect(canvas.width / 2 - 4, g.y + 20, 8, g.height - 40);
    ctx.fillStyle = '#989987'; ctx.font = '12px sans-serif'; ctx.fillText('TEST SPREAD', g.x + 36, g.y + 46);
  };
  draw(); const timer = setInterval(draw, 33), stream = canvas.captureStream(30);
  const track = stream.getVideoTracks()[0], stop = track.stop.bind(track);
  track.stop = () => { clearInterval(timer); stop(); }; tracks.push(track);
  return stream;
} });
await import('../src/main.js');
const badge = document.createElement('div'); badge.style = 'position:fixed;bottom:0;left:0;z-index:100;background:#d5fa78;color:#172214;font:10px monospace;padding:5px;pointer-events:none';
badge.textContent = 'TEST · ISOLATED STEP · REAL DETECTORS'; document.body.append(badge);
const observer = new MutationObserver(() => {
  const results = document.getElementById('results');
  if (results.hidden) return;
  observer.disconnect();
  const step = document.getElementById('test-mode').value;
  const resources = performance.getEntriesByType('resource').map(r => r.name);
  const expectedPhotos = step === 'liveness' ? 0 : 1;
  const noFace = step.startsWith('document') ? !resources.some(url => /face_landmarker|tasks-vision|face\.worker/.test(url)) : true;
  const noOpenCV = step === 'liveness' ? !resources.some(url => /models\/opencv/.test(url)) : true;
  const passed = results.querySelectorAll('img').length === expectedPhotos && tracks.every(t => t.readyState === 'ended') && workers.every(w => w.stopped) && noFace && noOpenCV;
  badge.textContent = passed ? `ISOLATED PASS · ${step} · ${expectedPhotos} PHOTO · ONLY REQUIRED MODELS · TRACKS + WORKERS STOPPED` : `ISOLATED FAIL · photos=${results.querySelectorAll('img').length} · noFace=${noFace} · noOpenCV=${noOpenCV}`;
});
observer.observe(document.body, { subtree: true, attributes: true, childList: true });
