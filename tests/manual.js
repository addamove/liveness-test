// No model imports or physical camera: this fixture verifies the zero-model path.
const limited = new URLSearchParams(location.search).has('limited');
if (limited) Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, get: () => 2 });
const tracks = [];
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
  const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 800;
  const ctx = canvas.getContext('2d');
  const draw = () => {
    ctx.fillStyle = '#324230'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#cbd7bf'; ctx.font = '22px sans-serif'; ctx.fillText('TEST CAMERA', 160, 350);
  };
  draw(); const timer = setInterval(draw, 33), stream = canvas.captureStream(30);
  const track = stream.getVideoTracks()[0], stop = track.stop.bind(track);
  track.stop = () => { clearInterval(timer); stop(); }; tracks.push(track);
  return stream;
} });
await import('../src/main.js');
const badge = document.createElement('div'); badge.style = 'position:fixed;top:0;left:0;z-index:100;background:#d5fa78;color:#172214;font:10px monospace;padding:5px 10px';
badge.textContent = limited ? 'TEST · 2 LOGICAL CORES · SYNTHETIC CAMERA' : 'TEST · MANUAL MODE · SYNTHETIC CAMERA';
document.body.append(badge);
const observer = new MutationObserver(() => {
  const results = document.getElementById('results');
  if (results && !results.hidden) {
    observer.disconnect();
    const modelRequests = performance.getEntriesByType('resource').filter(r => /\/models\/|face-landmarks-detection|face_mesh/.test(r.name));
    const ok = results.querySelectorAll('img').length === 2 && tracks.every(t => t.readyState === 'ended') && modelRequests.length === 0 && results.textContent.includes('Движение не проверено') && results.textContent.includes('Без проверки') && !results.textContent.includes('прошли условия автосъёмки');
    badge.textContent = ok ? 'MANUAL PASS · 2 PHOTOS · 0 MODEL REQUESTS · TRACKS STOPPED' : `MANUAL FAIL · ${modelRequests.length} MODEL REQUESTS`;
  }
});
observer.observe(document.body, { subtree: true, attributes: true, childList: true });
