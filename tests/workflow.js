// Browser integration fixture, never imported by the production entry point.
// Both detectors are real. Only getUserMedia is replaced with canvas video streams.
import { loadFaceDetector, POSE_POINTS, POSE_INDICES } from '../src/vision.js';
import { guideFor, FACE_OUTLINE } from '../src/geometry.js';
try {
  const img = new Image(); img.src = '/tests/fixtures/portrait.jpg'; await img.decode();
  const detector = await loadFaceDetector();
  const faces = await detector.estimateFaces(img, { staticImageMode: true });
  const box = faces[0].box; detector.dispose();
  const scenario = new URLSearchParams(location.search).get('scenario');
  let inferenceCalls = 0, motionCalls = 0, docCase = 'outside';
  const makeMotionFace = canvas => {
    const g = guideFor(canvas.width, canvas.height, 'liveness');
    const p = Array.from({ length: 478 }, () => ({ x: canvas.width / 2, y: g.y + g.height / 2, z: 0 }));
    FACE_OUTLINE.forEach((id, i) => { const a = -Math.PI / 2 + i * Math.PI * 2 / FACE_OUTLINE.length; p[id] = { x: canvas.width / 2 + g.width * .35 * Math.cos(a), y: g.y + g.height / 2 + g.height * .38 * Math.sin(a), z: 0 }; });
    // Synthetic landmarks only on step 4. solvePnP and the motion gate stay real.
    const cycle = (motionCalls++ % 250), circleFrame = cycle - 25;
    const angle = -Math.PI / 2 + Math.max(0, Math.min(1, circleFrame / 150)) * Math.PI * 2;
    const active = circleFrame >= 0 && circleFrame <= 158;
    const yaw = active ? 18 * Math.cos(angle) : 0, pitch = active ? 13 * Math.sin(angle) : 0;
    const ry = yaw * Math.PI / 180, rx = pitch * Math.PI / 180, focal = Math.max(canvas.width, canvas.height), tz = 65;
    const ty = (g.y + g.height / 2 - canvas.height / 2) * tz / focal - 3.2;
    POSE_INDICES.forEach((id, i) => {
      const [x, y, z] = POSE_POINTS.slice(i * 3, i * 3 + 3);
      const y1 = y * Math.cos(rx) - z * Math.sin(rx), z1 = y * Math.sin(rx) + z * Math.cos(rx);
      const x2 = x * Math.cos(ry) + z1 * Math.sin(ry), z2 = -x * Math.sin(ry) + z1 * Math.cos(ry);
      p[id] = { x: focal * x2 / (z2 + tz) + canvas.width / 2, y: focal * (y1 + ty) / (z2 + tz) + canvas.height / 2, z: 0 };
    });
    return [{ keypoints: p }];
  };
  if (scenario === 'motion') {
    const prototype = Object.getPrototypeOf(detector), estimate = prototype.estimateFaces;
    prototype.estimateFaces = async function (...args) {
      return document.getElementById('camera-shell')?.dataset.step === 'liveness' ? makeMotionFace(args[0]) : estimate.apply(this, args);
    };
  }
  if (['slow', 'error', 'warmup'].includes(scenario)) {
    const prototype = Object.getPrototypeOf(detector), estimate = prototype.estimateFaces;
    prototype.estimateFaces = async function (...args) {
      inferenceCalls++;
      if (scenario === 'error') throw new Error('Synthetic model failure');
      const faces = await estimate.apply(this, args);
      const delay = scenario === 'warmup' ? ([2100, 700, 400, 100][inferenceCalls - 1] || (inferenceCalls === 14 ? 1800 : 0)) : 400;
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      return faces;
    };
  }
  const tracks = [];
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async constraints => {
    const shell = document.getElementById('camera-shell'), isFace = constraints.video.facingMode.ideal === 'user';
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(shell.clientWidth * 1.5); canvas.height = Math.round(shell.clientHeight * 1.5);
    const ctx = canvas.getContext('2d');
    const draw = () => {
      const orientation = document.querySelector('[data-orientation=portrait]')?.getAttribute('aria-pressed') === 'true' ? 'portrait' : 'landscape';
      const guide = guideFor(canvas.width, canvas.height, isFace ? 'face' : 'document', orientation);
      ctx.fillStyle = '#243127'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (isFace) {
        const scale = guide.height * .78 / box.height;
        ctx.drawImage(img, canvas.width / 2 - (box.xMin + box.width / 2) * scale, guide.y + guide.height / 2 - (box.yMin + box.height / 2) * scale, img.width * scale, img.height * scale);
      } else {
        const kind = scenario === 'guidance' ? docCase : 'ready';
        let x = guide.x + 20, y = guide.y + 20, w = guide.width - 40, h = guide.height - 40;
        if (kind === 'small') { x += w * .22; y += h * .22; w *= .56; h *= .56; }
        if (kind === 'offset') x += 48;
        const outside = kind === 'outside' ? guide.x + guide.width + 16 : x + w;
        ctx.fillStyle = '#ebe8d7'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(outside, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#989987'; ctx.font = '12px sans-serif'; ctx.fillText('TEST SPREAD', x + 15, y + 25);
        ctx.fillStyle = '#bfc2ac'; ctx.fillRect(x + 18, y + 45, w * .23, h * .35);
        for (let i = 0; i < 4; i++) ctx.fillRect(x + w * .62, y + 48 + i * 13, w * .25, 2);
        if (kind !== 'flat') {
          ctx.strokeStyle = '#85877b'; ctx.lineWidth = 7; ctx.beginPath();
          if (orientation === 'portrait') { ctx.moveTo(x, y + h / 2); ctx.lineTo((outside + x + w) / 2, y + h / 2); }
          else { ctx.moveTo((x + outside) / 2, y); ctx.lineTo(x + w / 2, y + h); }
          ctx.stroke();
        }
      }
    };
    draw(); const id = setInterval(draw, 33); const stream = canvas.captureStream(30);
    const track = stream.getVideoTracks()[0], originalStop = track.stop.bind(track);
    track.stop = () => { clearInterval(id); originalStop(); }; tracks.push(track);
    return stream;
  } });
  await import('../src/main.js');
  const badge = document.createElement('div'); badge.style = 'position:fixed;top:0;left:0;z-index:100;background:#d5fa78;color:#172214;font:10px monospace;padding:5px 10px;pointer-events:none';
  badge.textContent = scenario === 'motion' ? 'TEST · REAL MODELS + SYNTHETIC MOTION' : 'TEST · SYNTHETIC CAMERA · REAL MODELS'; document.body.append(badge);
  if (scenario === 'guidance') {
    const controls = document.createElement('div'); controls.style = 'position:fixed;bottom:0;left:0;z-index:100;display:flex;gap:5px;background:white;padding:7px';
    for (const [key, label] of Object.entries({ small: 'TEST: меньше', offset: 'TEST: смещён', outside: 'TEST: угол снаружи', flat: 'TEST: без сгиба', ready: 'TEST: готово' })) {
      const button = document.createElement('button'); button.textContent = label; button.onclick = () => { docCase = key; }; controls.append(button);
    }
    document.body.append(controls);
  }
  const confirmations = new Map();
  const confirmationObserver = new MutationObserver(() => {
    const shell = document.getElementById('camera-shell'), step = shell.dataset.step;
    if (shell.dataset.phase === 'captured' && !confirmations.has(step)) confirmations.set(step, { started: performance.now() });
    for (const [key, value] of confirmations) if (key !== step && !value.duration) value.duration = performance.now() - value.started;
  });
  confirmationObserver.observe(document.getElementById('camera-shell'), { attributes: true, subtree: true, childList: true });
  const observer = new MutationObserver(() => {
    const results = document.getElementById('results');
    if (results && !results.hidden) {
      observer.disconnect();
      const motionOK = scenario === 'motion' ? results.textContent.includes('Круговое движение выполнено') : results.textContent.includes('Движение не проверено');
      const timingOK = ['face', 'document', 'document-ml'].every(key => confirmations.get(key)?.duration >= 1450);
      const ok = timingOK && motionOK && results.querySelectorAll('img').length === 3 && tracks.every(t => t.readyState === 'ended') && (['slow', 'error'].includes(scenario) ? results.textContent.includes('Без проверки') : results.textContent.includes('прошли условия автосъёмки'));
      badge.textContent = ok ? 'E2E PASS · 3 PHOTOS · TRANSITIONS ≥ 1.5s · ALL TRACKS STOPPED' : 'E2E FAIL';
    }
  });
  observer.observe(document.body, { subtree: true, attributes: true, childList: true });
  if (scenario === 'slow') {
    const check = setInterval(() => {
      if (inferenceCalls < 20) return;
      badge.textContent = document.getElementById('camera-shell').dataset.mode === 'auto' ? 'SLOW CHECKS OFF PASS' : 'SLOW CHECKS OFF FAIL';
      clearInterval(check);
    }, 500);
  }
  if (scenario === 'error') {
    const fallbackObserver = new MutationObserver(() => {
      if (document.getElementById('camera-shell').dataset.mode === 'manual') {
        fallbackObserver.disconnect();
        const count = inferenceCalls;
        setTimeout(() => { badge.textContent = count === inferenceCalls ? 'FALLBACK PASS · INFERENCE STOPPED' : 'FALLBACK FAIL · INFERENCE STILL RUNNING'; }, 700);
      }
    });
    fallbackObserver.observe(document.getElementById('camera-shell'), { attributes: true });
  }
} catch (error) { document.getElementById('app').textContent = `FIXTURE FAIL: ${error.stack || error}`; }
