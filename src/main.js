import './style.css';
import { MotionChallenge, MOTION_LIMITS, motionFaceReady } from './liveness.js';
import { guideFor, coverCrop, HoldGate, evaluateFace, evaluateDocument, FACE_OUTLINE, LIMITS } from './geometry.js';
import { loadOpenCV, loadFaceDetector, estimatePose, findDocument } from './vision.js';
import { inspectDevice, PerformanceGuard, PERFORMANCE_LIMITS, MANUAL_REASONS, withDeadline } from './performance.js';

const icon = (name, size = 22) => {
  const paths = {
    scan: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/><circle cx="12" cy="12" r="4"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5.9-1.5 1-1.5 2m0 3v.1"/>',
    camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="4"/>',
    flip: '<path d="M4 8a9 9 0 0 1 15-3l2 3m0-5v5h-5M20 16a9 9 0 0 1-15 3l-2-3m0 5v-5h5"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.scan}</svg>`;
};

document.querySelector('#app').innerHTML = `
  <header class="site-header"><a class="brand" href="/">${icon('scan', 26)}<span>в кадре<span class="brand-dot">.</span></span></a><span class="prototype-label"><i></i> Лаборатория съёмки <b>01</b></span><button class="text-button help-trigger">Как это работает ${icon('help', 18)}</button></header>
  <main class="workspace">
    <aside class="intro">
      <div class="eyebrow">КАМЕРА · JAVASCRIPT · НА ВАШЕМ УСТРОЙСТВЕ</div>
      <h1>Поймать<br>нужный <span>момент.</span></h1>
      <p class="lead">Три простых шага. Наведите камеру —<br>мы выберем момент для снимка.</p>
      <ol class="steps"><li id="step-face" class="active"><span class="step-number">01</span><div><h2>Посмотрите в камеру</h2><p>Лицо в овале, голова и взгляд прямо.<br>400 мс — и фото готово.</p></div><span class="step-check">${icon('check', 18)}</span></li><li id="step-document"><span class="step-number">02</span><div><h2>Раскройте паспорт</h2><p>Все четыре края внутри рамки.<br>Снимок появится автоматически.</p></div><span class="step-check">${icon('check', 18)}</span></li><li id="step-liveness"><span class="step-number">03</span><div><h2>Проведите лицом по кругу</h2><p>Плавно следуйте за точкой.<br>Вернитесь в центр в конце.</p></div><span class="step-check">${icon('check', 18)}</span></li></ol>
      <div class="privacy">${icon('lock', 18)}<p>Снимки остаются в этом браузере.<br>Без загрузки на сервер.</p></div>
      <div class="tech-note"><span>FACE LANDMARKS</span><span>OPENCV.JS</span><span>LOCAL ONLY</span></div>
    </aside>
    <section class="capture-column" aria-label="Прототип съёмки">
      <div class="camera-shell" id="camera-shell">
        <video id="video" autoplay playsinline muted></video>
        <div class="idle-background" id="idle-background"><div class="ambient"></div><svg class="face-placeholder" viewBox="0 0 200 260" fill="none" aria-hidden="true"><path d="M100 31C46 31 36 75 42 126c5 46 29 77 58 77s53-31 58-77c6-51-4-95-58-95Z"/><path d="M62 104q13-9 25 0m26 0q13-9 25 0m-38 5-5 33h13m-29 21q21 10 42 0M50 242q4-32 27-39m73 39q-4-32-27-39"/><circle cx="76" cy="107" r="3"/><circle cx="124" cy="107" r="3"/></svg></div>
        <svg id="overlay" aria-hidden="true"></svg>
        <div class="camera-header"><button class="round-button" id="close-camera" aria-label="Остановить и начать заново">${icon('close')}</button><div class="step-pill" id="step-pill">ШАГ 01 / 03</div><button class="round-button help-trigger" aria-label="Помощь по съёмке">${icon('help')}</button></div>
        <div id="document-orientation" class="orientation-switch" role="group" aria-label="Положение разворота" hidden><button data-orientation="landscape" aria-pressed="true">Две страницы рядом</button><button data-orientation="portrait" aria-pressed="false">Одна над другой</button></div>
        <div class="frame-tag" id="frame-tag"><span></span> ФОТО ЛИЦА</div>
        <div class="camera-footer"><div class="status-badge" id="status-badge">АВТОМАТИЧЕСКИЙ СНИМОК</div><h2 id="instruction" aria-live="polite">Ваше лицо —<br>в центре внимания</h2><p id="hint">Расположите лицо в овале.<br>Когда всё готово, камера снимет сама.</p><button id="start" class="primary-button">Включить камеру ${icon('arrow')}</button><button id="manual-capture" class="primary-button" hidden>Сделать фото ${icon('camera')}</button><button id="skip-motion" class="manual-mode-button" hidden>Завершить без проверки движения</button><div id="motion-progress" class="motion-progress" hidden><span id="motion-progress-label">Подготовка</span><div><i id="motion-progress-bar"></i></div></div><div id="hold-indicator" hidden><svg viewBox="0 0 72 72"><circle cx="36" cy="36" r="31" class="ring-track"/><circle id="hold-ring" cx="36" cy="36" r="31" class="ring-progress"/></svg><span id="hold-value">0</span><small>мс / 400</small></div><button id="flip" class="flip-button" hidden>${icon('flip', 17)} Сменить камеру</button><button id="manual-mode" class="manual-mode-button">Снимать по кнопке</button></div>
        <div id="capture-success" class="capture-success" role="status" hidden><img id="captured-preview" alt=""/><div class="success-shade"></div><div class="capture-confirmation"><span class="capture-check">${icon('check', 42)}</span><h2 id="capture-title">Снимок готов</h2><p id="capture-next"></p></div></div>
        <div id="flash" class="flash"></div>
      </div>
      <details class="diagnostics" id="diagnostics"><summary><span><i id="engine-dot"></i> Диагностика в реальном времени</span><span class="plus">+</span></summary><div class="diagnostic-body"><div id="checks" class="checks">Показатели появятся после включения камеры.</div><div class="performance"><span id="engine">Модели ещё не загружены</span><span id="timing">— мс</span></div><label class="debug-switch"><input type="checkbox" id="debug" checked> Показывать найденные точки и контур</label><p class="diagnostic-note">Взгляд оценивается по радужкам, поворот головы — по 3D-точкам. Повороты и движение головы оцениваются приблизительно. Круговое движение не подтверждает защиту от подмены фото или видео. Разворот определяется по контуру и сгибу, без распознавания содержимого.</p></div></details>
    </section>
    <section id="results" class="results" hidden></section>
  </main>
  <footer class="site-footer"><span>В КАДРЕ / ПРОТОТИП 1.0</span><span>Хороший кадр начинается с простого.</span></footer>
  <dialog id="help"><button class="dialog-close round-button" aria-label="Закрыть подсказки">${icon('close')}</button><span class="eyebrow">ПЕРЕД СЪЁМКОЙ</span><h2>Всё получится<br>с первого кадра.</h2><p><b>Лицо.</b> Встаньте перед источником света. Смотрите в объектив, держите голову прямо. Овал станет зелёным, когда все условия выполнены. Сохраняйте положение 400 мс.</p><p><b>Документ.</b> Положите раскрытый паспорт на контрастный фон. Обе страницы и сгиб должны быть видны. Выберите положение разворота сверху. Совместите углы: каждый станет зелёным на своём месте. Затем не двигайте камеру 400 мс. Содержимое не проверяется.</p><p><b>Движение.</b> На третьем шаге посмотрите прямо, затем слегка поворачивайте лицо за точкой по кругу: вверх, вправо, вниз, влево. Телефон держите неподвижно. Вернитесь в центр. Это демо задания на движение, без защиты от подмены видео.</p><p><b>На телефоне.</b> Подключитесь к тому же Wi-Fi, откройте страницу подключения по адресу из терминала и настройте доверие к локальному сертификату. Камере нужен HTTPS.</p><p><b>Съёмка по кнопке.</b> Доступна сразу и включается автоматически, если устройство не справляется с моделями. Рамки остаются подсказкой: положение лица и документа в этом режиме не проверяется. Проверку движения можно только пропустить; она не будет отмечена выполненной.</p><p class="muted">Результаты хранятся только в памяти этой страницы. Обновление или перезапуск удалит снимки.</p><button class="primary-button dialog-done">Понятно ${icon('check')}</button></dialog>
`;

const $ = id => document.getElementById(id);
const video = $('video'), shell = $('camera-shell'), overlay = $('overlay');
const frame = document.createElement('canvas'), frameCtx = frame.getContext('2d', { willReadFrequently: true });
const documentCanvas = document.createElement('canvas'), documentCtx = documentCanvas.getContext('2d', { willReadFrequently: true });
const gate = new HoldGate();
const motion = new MotionChallenge();
let documentOrientation = 'landscape', motionResult = null;
const performanceGuard = new PerformanceGuard();
let step = 'face', phase = 'idle', facing = 'user', stream, detector, cv;
let session = 0, timer, lastTime = -1, previousQuad, latest, inference, captures = {};
let visibilityEpoch = 0;
let captureMode = 'auto', manualReason = null, performanceSummary = null;
let modelVersion = 0, modelWait, inferenceWait;

function disposeModel(model) {
  if (!model) return;
  try { Promise.resolve(model.dispose()).catch(() => {}); } catch { /* Best-effort teardown. */ }
}

function releaseModels() {
  modelVersion++;
  modelWait?.abort(); inferenceWait?.abort();
  const oldDetector = detector, oldInference = inference;
  detector = null; cv = null; inference = null;
  // A detector must not be disposed while its native inference is still using it.
  if (oldDetector) Promise.resolve(oldInference).catch(() => {}).then(() => disposeModel(oldDetector));
}

function renderControls() {
  const ready = phase === 'running', isMotion = step === 'liveness';
  $('start').hidden = !['idle', 'loading', 'error'].includes(phase);
  $('manual-capture').hidden = !(ready && captureMode === 'manual' && !isMotion);
  $('manual-capture').disabled = !ready;
  $('hold-indicator').hidden = !(ready && captureMode === 'auto' && !isMotion);
  $('motion-progress').hidden = !(ready && captureMode === 'auto' && isMotion);
  $('skip-motion').hidden = !(isMotion && ['running', 'error'].includes(phase));
  $('skip-motion').textContent = captureMode === 'auto' && phase !== 'error' ? 'Пропустить проверку движения' : 'Завершить без проверки движения';
  $('skip-motion').className = captureMode === 'manual' || phase === 'error' ? 'primary-button' : 'manual-mode-button';
  $('flip').hidden = !ready || isMotion;
  $('document-orientation').hidden = step !== 'document' || !ready;
  $('manual-mode').hidden = isMotion || phase === 'captured' || phase === 'result' || (captureMode === 'manual' && !['idle', 'error'].includes(phase));
  $('manual-mode').textContent = captureMode === 'manual' ? 'Попробовать автосъёмку' : 'Снимать по кнопке';
  shell.dataset.mode = captureMode;
  shell.dataset.phase = phase;
  document.querySelector('#step-face p').innerHTML = captureMode === 'manual' ? 'Расположите лицо в овале.<br>Сделайте снимок по кнопке.' : 'Лицо в овале, голова и взгляд прямо.<br>400 мс — и фото готово.';
  document.querySelector('#step-document p').innerHTML = captureMode === 'manual' ? 'Обе страницы и сгиб в рамке.<br>Сделайте снимок по кнопке.' : 'Совместите углы раскрытого паспорта.<br>Снимок появится автоматически.';
}

function renderManual() {
  latest = null; drawOverlay(); renderControls();
  if (step === 'liveness') {
    setMessage('Проверка движения недоступна', `${MANUAL_REASONS[manualReason]} Можно завершить с двумя фото; движение останется непроверенным.`, 'БЕЗ ПРОВЕРКИ ДВИЖЕНИЯ');
  } else setMessage(step === 'face' ? 'Расположите лицо в овале' : 'Раскройте паспорт в рамке', step === 'document' ? 'Обе страницы и сгиб должны быть видны. Положение не проверяется — сделайте фото по кнопке.' : `${MANUAL_REASONS[manualReason]} Положение не проверяется.`, 'СЪЁМКА ПО КНОПКЕ');
  $('checks').textContent = step === 'liveness' ? 'Модели выключены. Проверка движения не выполняется.' : 'Проверки выключены. Убедитесь, что объект целиком виден в рамке, и нажмите «Сделать фото».';
  $('engine').textContent = 'Ручной режим · обработка выключена';
  $('timing').textContent = performanceSummary?.meanMs ? `${Math.round(performanceSummary.meanMs)} мс до переключения` : '—';
  $('engine-dot').className = 'manual';
}

function switchToManual(reason) {
  captureMode = 'manual'; manualReason = reason;
  clearTimeout(timer); gate.reset(); performanceGuard.reset(); previousQuad = null;
  releaseModels();
  motion.reset();
  if (step === 'liveness') { stopStream(); $('idle-background').hidden = false; phase = 'running'; }
  if (stream && video.readyState >= 2) phase = 'running';
  renderManual();
}

function runCapture(token) {
  phase = 'running'; gate.reset(); performanceGuard.reset();
  renderControls();
  if (captureMode === 'manual') renderManual();
  else { $('engine-dot').className = 'ready'; tick(token); }
}

function displayPoint(p, w, sourceWidth) { return { x: (facing === 'user' ? sourceWidth - p.x : p.x) * w / sourceWidth, y: p.y * w / sourceWidth }; }
function drawOverlay(result = latest) {
  const w = shell.clientWidth, h = shell.clientHeight;
  if (!w || !h) return;
  const g = guideFor(w, h, step, documentOrientation), color = captureMode === 'auto' && (phase === 'captured' || result?.valid) ? '#d5fa78' : '#ffffff';
  overlay.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const shape = step !== 'document' ? `<ellipse cx="${w / 2}" cy="${g.y + g.height / 2}" rx="${g.width / 2}" ry="${g.height / 2}"` : `<rect x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" rx="12"`;
  let detail = '';
  if (step === 'document') {
    const positions = [[g.x, g.y, 1, 1], [g.x + g.width, g.y, -1, 1], [g.x + g.width, g.y + g.height, -1, -1], [g.x, g.y + g.height, 1, -1]];
    const corners = facing === 'user' ? [result?.cornerStatus?.[1], result?.cornerStatus?.[0], result?.cornerStatus?.[3], result?.cornerStatus?.[2]] : result?.cornerStatus;
    detail = positions.map(([x, y, dx, dy], i) => `<path class="guide-corner" data-ready="${!!corners?.[i]}" d="M${x + dx * 23} ${y}H${x + dx * 7}Q${x} ${y} ${x} ${y + dy * 7}V${y + dy * 23}" fill="none" stroke="${corners?.[i] ? '#d5fa78' : '#fff'}" stroke-width="5" stroke-linecap="round"/>`).join('');
    const vertical = documentOrientation === 'landscape';
    detail += `<line x1="${vertical ? w / 2 : g.x + 12}" x2="${vertical ? w / 2 : g.x + g.width - 12}" y1="${vertical ? g.y + 12 : g.y + g.height / 2}" y2="${vertical ? g.y + g.height - 12 : g.y + g.height / 2}" stroke="#ffffff66" stroke-width="1" stroke-dasharray="4 7"/>`;
    if (result?.points && phase === 'running') {
      const points = result.points.map(p => displayPoint(p, w, frame.width));
      detail += `<polygon points="${points.map(p => `${p.x},${p.y}`).join(' ')}" fill="${result.valid ? '#d5fa780c' : '#f7cf7a08'}" stroke="${result.valid ? '#d5fa78' : '#f7cf7a'}" stroke-width="1.5"/>`;
      if ($('debug').checked) detail += points.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${result.cornerStatus[i] ? '#d5fa78' : '#f7cf7a'}"/>`).join('');
    }
  } else if (step === 'liveness' && captureMode === 'auto' && phase === 'running') {
    const state = result?.motion ?? motion.snapshot(), cx = w / 2, cy = g.y + g.height / 2;
    const rx = g.width / 2 + 16, ry = g.height / 2 + 16;
    detail += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#ffffff3d" stroke-width="3" stroke-dasharray="3 10"/>`;
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 4;
      detail += `<circle cx="${cx + Math.cos(a) * rx}" cy="${cy + Math.sin(a) * ry}" r="4" fill="${i < state.completed ? '#d5fa78' : '#ffffff55'}"/>`;
    }
    detail += `<circle class="motion-target" cx="${cx + state.target.x * rx}" cy="${cy + state.target.y * ry}" r="11" fill="#d5fa78" stroke="#23311d" stroke-width="3"/>`;
    if (state.stage !== 'calibrate') detail += `<circle cx="${cx + Math.max(-1.4, Math.min(1.4, state.cursor.x)) * rx}" cy="${cy + Math.max(-1.4, Math.min(1.4, state.cursor.y)) * ry}" r="7" fill="#fff" stroke="#23311d" stroke-width="2"/>`;
  } else if ($('debug').checked && result?.face && phase === 'running') {
    detail = [...FACE_OUTLINE, 1, 33, 133, 263, 362, 468, 473].map(i => { const p = displayPoint(result.face.keypoints[i], w, frame.width); return `<circle cx="${p.x}" cy="${p.y}" r="${i >= 468 ? 3 : 1.5}" fill="${color}" opacity=".65"/>`; }).join('');
  }
  overlay.innerHTML = `<defs><mask id="cutout"><rect width="${w}" height="${h}" fill="white"/>${shape} fill="black"/></mask></defs><rect width="${w}" height="${h}" fill="#080d0c" opacity=".57" mask="url(#cutout)"/>${shape} fill="none" stroke="${step === 'document' ? '#ffffff66' : color}" stroke-width="${step === 'document' ? 1 : 2}"/>${detail}`;
  $('frame-tag').style.top = `${g.y - (step === 'liveness' ? 45 : 30)}px`;
  const placeholder = document.querySelector('.face-placeholder');
  placeholder.style.width = `${g.width * .8}px`; placeholder.style.top = `${g.y + g.height * .08}px`;
}

function setMessage(title, hint = '', badge) {
  if ($('instruction').textContent !== title) $('instruction').textContent = title;
  if ($('hint').textContent !== hint) $('hint').textContent = hint;
  if (badge && $('status-badge').textContent !== badge) $('status-badge').textContent = badge;
}

function renderStep() {
  const keys = ['face', 'document', 'liveness'];
  $('step-pill').textContent = `ШАГ 0${keys.indexOf(step) + 1} / 03`;
  $('frame-tag').innerHTML = `<span></span> ${{ face: 'ФОТО ЛИЦА', document: 'РАСКРЫТЫЙ ПАСПОРТ', liveness: 'ПРОВЕРКА ДВИЖЕНИЯ' }[step]}`;
  for (const key of keys) {
    $(`step-${key}`).classList.toggle('active', step === key && phase !== 'result');
    $(`step-${key}`).classList.toggle('done', key === 'liveness' ? motionResult?.status === 'passed' : !!captures[key]);
    $(`step-${key}`).classList.toggle('skipped', key === 'liveness' && motionResult && motionResult.status !== 'passed');
  }
  shell.dataset.step = step;
  latest = null; previousQuad = null; gate.reset(); motion.reset(); drawOverlay(); renderControls();
}

function stopStream() {
  clearTimeout(timer);
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
}

function reset() {
  session++; stopStream(); releaseModels(); performanceGuard.reset();
  phase = 'idle'; step = 'face'; facing = 'user'; captures = {}; motionResult = null;
  $('capture-success').hidden = true; $('captured-preview').removeAttribute('src'); $('flash').classList.remove('active');
  $('results').replaceChildren();
  frameCtx.clearRect(0, 0, frame.width, frame.height);
  documentCtx.clearRect(0, 0, documentCanvas.width, documentCanvas.height);
  $('results').hidden = true; document.querySelector('.capture-column').hidden = false;
  document.querySelector('.intro').classList.remove('completed');
  $('idle-background').hidden = false; $('start').hidden = false; $('start').disabled = false;
  $('start').innerHTML = `Включить камеру ${icon('arrow')}`;
  $('hold-indicator').hidden = true; $('flip').hidden = true;
  $('checks').textContent = 'Показатели появятся после включения камеры.';
  $('engine-dot').className = '';
  setMessage('Ваше лицо — в центре внимания', 'Расположите лицо в овале. Когда всё готово, камера снимет сама.', 'АВТОМАТИЧЕСКИЙ СНИМОК');
  renderStep();
  renderControls();
  if (captureMode === 'manual') renderManual();
  window.scrollTo(0, 0);
}

function friendlyError(error) {
  if (error.name === 'NotAllowedError') return 'Разрешите доступ к камере в настройках сайта и откройте страницу по доверенному HTTPS-адресу.';
  if (error.name === 'NotFoundError') return 'Камера не найдена. Подключите её или откройте демо на телефоне.';
  if (error.name === 'NotReadableError') return 'Камера занята другим приложением. Закройте его и попробуйте снова.';
  if (error.name === 'OverconstrainedError') return 'Эта камера не поддерживает запрошенный режим. Попробуйте другую камеру.';
  return error.message || 'Не удалось запустить обработку. Попробуйте снова.';
}

function fail(error, token) {
  if (token !== session) return;
  console.error(error);
  $('capture-success').hidden = true; latest = null; motion.reset();
  session++; stopStream(); releaseModels(); phase = 'error'; gate.reset();
  $('start').hidden = false; $('start').disabled = false; $('start').innerHTML = `Попробовать ещё ${icon('arrow')}`;
  $('hold-indicator').hidden = true; $('flip').hidden = true; $('engine-dot').className = 'error';
  setMessage('Камере нужна помощь', friendlyError(error), 'НЕ УДАЛОСЬ ЗАПУСТИТЬ'); drawOverlay(); renderControls();
}

async function openCamera(token) {
  stopStream();
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Камере нужен HTTPS. Откройте страницу подключения по адресу из терминала и установите локальный сертификат.');
  const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } } });
  if (token !== session) { next.getTracks().forEach(t => t.stop()); return false; }
  stream = next;
  const track = stream.getVideoTracks()[0];
  facing = track.getSettings().facingMode || facing;
  track.addEventListener('ended', () => { if (token === session) fail(new Error('Камера отключилась. Включите её снова.'), token); });
  video.srcObject = stream;
  video.style.transform = facing === 'user' ? 'scaleX(-1)' : 'none';
  await video.play();
  if (token !== session) return false;
  $('idle-background').hidden = true;
  lastTime = -1;
  return true;
}

async function ensureModels() {
  const version = ++modelVersion;
  await Promise.all([
    loadOpenCV().then(engine => { if (version === modelVersion) cv = engine.cv; }),
    loadFaceDetector().then(model => {
      if (version === modelVersion) detector = model;
      else disposeModel(model); // A late load cannot re-enable automatic capture.
    }),
  ]);
}

async function start() {
  if (phase === 'loading' || phase === 'running') return;
  const token = ++session;
  phase = 'loading'; $('start').disabled = true;
  renderControls();
  $('start').textContent = 'Подключаем камеру…';
  setMessage('Готовимся к съёмке', captureMode === 'manual' ? 'Разрешите доступ к камере. Модели загружаться не будут.' : 'Разрешите камеру. Первый запуск моделей может занять несколько секунд.', 'ЗАГРУЗКА');
  try {
    if (token !== session || !await openCamera(token)) return;
    if (captureMode === 'auto') {
      const reason = inspectDevice();
      if (reason) switchToManual(reason);
      else {
        $('start').textContent = 'Загружаем модели…';
        modelWait = new AbortController();
        try { await withDeadline(ensureModels(), PERFORMANCE_LIMITS.loadTimeoutMs, modelWait.signal); }
        catch (error) {
          if (token !== session) return;
          if (captureMode === 'auto') switchToManual(error.name === 'TimeoutError' ? 'load-timeout' : 'model-error');
        }
      }
    }
    if (token === session) runCapture(token);
  } catch (error) { fail(error, token); }
}

function sampleFrame() {
  const scale = Math.min(1.5, 960 / shell.clientHeight);
  const width = Math.round(shell.clientWidth * scale), height = Math.round(shell.clientHeight * scale);
  if (frame.width !== width || frame.height !== height) { frame.width = width; frame.height = height; gate.reset(); motion.reset(); previousQuad = null; }
  const crop = coverCrop(video.videoWidth, video.videoHeight, width, height);
  frameCtx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  return guideFor(width, height, step, documentOrientation);
}

function renderAnalysis(result, hold, ms) {
  latest = result;
  $('checks').innerHTML = result.checks.map(c => `<div class="check-row ${c.ok ? 'pass' : ''}"><span class="check-icon">${c.ok ? icon('check', 12) : '·'}</span><span>${c.label}<small>${c.detail}</small></span></div>`).join('');
  $('engine').textContent = step === 'document' ? 'OpenCV · контур + центральный сгиб' : 'MediaPipe FaceMesh · 478 точек';
  $('timing').textContent = `${Math.round(ms)} мс`;
  $('hold-ring').style.strokeDashoffset = `${195 * (1 - hold.progress)}`;
  $('hold-value').textContent = Math.min(400, Math.floor(hold.elapsed));
  const firstFailure = result.checks.find(c => !c.ok);
  if (step === 'document') {
    const guidance = result.guidance;
    const direction = facing === 'user' ? { left: 'right', right: 'left', up: 'up', down: 'down' }[guidance.direction] : guidance.direction;
    setMessage(direction ? `Сдвиньте паспорт ${{ left: 'влево ←', right: 'вправо →', up: 'выше ↑', down: 'ниже ↓' }[direction]}` : guidance.title, guidance.hint, `УГЛЫ НА МЕСТЕ: ${result.cornerStatus.filter(Boolean).length} / 4`);
  } else if (result.valid) setMessage('Отлично. Не двигайтесь', 'Снимок произойдёт автоматически', 'ВСЁ В РАМКЕ');
  else {
    const title = firstFailure?.id === 'pose' ? 'Держите голову прямо' : firstFailure?.id === 'face' && result.face == null && firstFailure?.detail !== 'Лицо не найдено' ? 'В кадре должен быть один человек' : firstFailure?.detail || 'Поместите объект в рамку';
    setMessage(title, step === 'face' ? 'Смотрите в объектив и держите голову прямо' : 'Контрастный фон поможет увидеть все четыре края', 'ИЩЕМ ПОДХОДЯЩИЙ КАДР');
  }
  if (ms > LIMITS.maxGapMs) $('hint').textContent = 'Обработка медленная. Закройте другие вкладки или попробуйте другой браузер.';
  drawOverlay(result);
}

function renderMotion(result, ms) {
  latest = result;
  const state = result.motion;
  const titles = { calibrate: 'Посмотрите прямо в камеру', circle: 'Плавно ведите лицо за точкой', return: 'Вернитесь лицом в центр', passed: 'Движение выполнено' };
  const hints = { calibrate: 'Сначала запомним положение головы. Телефон держите неподвижно.', circle: 'Слегка поворачивайте лицо вверх, вправо, вниз и влево. Белая точка — ваше движение.', return: 'Посмотрите прямо и задержитесь на мгновение.', passed: 'Круг пройден. Готовим результат.' };
  setMessage(state.reason || titles[state.stage], hints[state.stage], 'КРУГ ПО ЧАСОВОЙ СТРЕЛКЕ');
  $('motion-progress-label').textContent = state.stage === 'calibrate' ? 'Исходное положение' : state.stage === 'return' ? 'Круг пройден · вернитесь в центр' : `${Math.round(state.progress * 100)}% круга`;
  $('motion-progress-bar').style.width = `${state.progress * 100}%`;
  $('checks').textContent = `Контрольные точки: ${state.completed} / 9. Проверяется последовательное движение головы, не подлинность видео.`;
  $('engine').textContent = 'MediaPipe FaceMesh · движение головы'; $('timing').textContent = `${Math.round(ms)} мс`;
  drawOverlay(result);
}

async function tick(token) {
  if (token !== session || phase !== 'running' || captureMode !== 'auto') return;
  try {
    if (document.hidden || $('help').open || video.readyState < 2 || video.currentTime === lastTime) { timer = setTimeout(() => tick(token), 80); return; }
    const epoch = visibilityEpoch;
    lastTime = video.currentTime;
    const guide = sampleFrame(), sampledAt = performance.now();
    let result, faces, pose;
    if (step !== 'document') {
      inference = detector.estimateFaces(frame, { flipHorizontal: false });
      inferenceWait = new AbortController();
      faces = await withDeadline(inference, PERFORMANCE_LIMITS.inferenceTimeoutMs, inferenceWait.signal);
      if (token !== session || phase !== 'running' || captureMode !== 'auto') return;
      pose = faces.length === 1 ? estimatePose(cv, faces[0].keypoints, frame.width, frame.height) : null;
      result = step === 'face' ? evaluateFace(faces, guide, pose) : {};
      result.face = faces.length === 1 ? faces[0] : null;
    } else {
      const scale = Math.min(1, 640 / frame.height);
      documentCanvas.width = Math.round(frame.width * scale); documentCanvas.height = Math.round(frame.height * scale);
      documentCtx.drawImage(frame, 0, 0, documentCanvas.width, documentCanvas.height);
      const scaledGuide = Object.fromEntries(Object.entries(guide).map(([key, value]) => [key, value * scale]));
      const small = findDocument(cv, documentCtx.getImageData(0, 0, documentCanvas.width, documentCanvas.height), scaledGuide, documentOrientation);
      const observation = small ? { ...small, points: small.points.map(p => ({ x: p.x / scale, y: p.y / scale })) } : null;
      result = evaluateDocument(observation, guide, previousQuad);
      previousQuad = observation?.points;
    }
    const ms = performance.now() - sampledAt;
    if (document.hidden || $('help').open || epoch !== visibilityEpoch) { gate.reset(); motion.reset(); performanceGuard.reset(); previousQuad = null; }
    else {
      performanceSummary = performanceGuard.observe(ms, sampledAt);
      if (performanceSummary.fallback) { switchToManual('slow-inference'); return; }
      if (step === 'liveness') {
        result.motion = motion.update(pose, !performanceSummary.calibrating && ms <= LIMITS.maxGapMs && motionFaceReady(faces, guide, pose), sampledAt, facing === 'user');
        renderMotion(result, ms);
        if (result.motion.ready) { await finishMotion(token, sampledAt); return; }
      } else {
        const hold = gate.update(result.valid && !performanceSummary.calibrating && ms <= LIMITS.maxGapMs, sampledAt);
        renderAnalysis(result, hold, ms);
        if (hold.ready) { await capture(result, hold, token); return; }
      }
      if (performanceSummary.calibrating) setMessage('Проверяем скорость обработки', 'Если автосъёмка замедляет устройство, включится съёмка по кнопке.', 'ПРОВЕРКА УСТРОЙСТВА');
    }
    if (token === session && captureMode === 'auto') timer = setTimeout(() => tick(token), 60);
  } catch (error) {
    if (token !== session || captureMode !== 'auto') return;
    if (phase === 'running') switchToManual(error.name === 'TimeoutError' ? 'slow-inference' : 'model-error');
    else fail(error, token);
  }
}

async function showConfirmation(image, title, next, token) {
  phase = 'captured'; renderControls(); drawOverlay();
  $('captured-preview').src = image;
  $('captured-preview').style.transform = facing === 'user' ? 'scaleX(-1)' : 'none';
  $('capture-title').textContent = title; $('capture-next').textContent = next;
  $('capture-success').hidden = false;
  $('flash').classList.add('active'); setTimeout(() => $('flash').classList.remove('active'), 180);
  await new Promise(resolve => setTimeout(resolve, 1500));
  return token === session;
}

async function capture(result, hold, token) {
  // Save the exact analyzed frame, not a later unvalidated video frame.
  captures[step] = { image: frame.toDataURL('image/jpeg', .94), width: frame.width, height: frame.height, timestamp: new Date().toISOString(), mode: captureMode, validated: captureMode === 'auto', fallbackReason: captureMode === 'manual' ? manualReason : null, performance: performanceSummary, heldMs: captureMode === 'auto' ? Math.round(hold.elapsed) : null, orientation: step === 'document' ? documentOrientation : null, metrics: result?.metrics ?? null, checks: result?.checks ?? [] };
  const wasFace = step === 'face';
  if (!await showConfirmation(captures[step].image, wasFace ? 'Фото лица готово' : 'Фото паспорта готово', wasFace ? 'Далее — раскрытый паспорт' : 'Далее — круговое движение лица', token)) return;
  step = wasFace ? 'document' : 'liveness'; facing = wasFace ? 'environment' : 'user'; phase = 'loading';
  renderStep();
  if (step === 'liveness' && captureMode === 'manual') { stopStream(); $('idle-background').hidden = false; }
  else {
    setMessage(wasFace ? 'Теперь — раскрытый паспорт' : 'Теперь — движение лица', 'Переключаем камеру…', wasFace ? 'ШАГ 02 / 03' : 'ШАГ 03 / 03');
    if (!await openCamera(token)) return;
    detector?.reset?.();
  }
  $('capture-success').hidden = true;
  runCapture(token);
}

async function finishMotion(token, now) {
  motionResult = { status: 'passed', kind: 'head-motion-challenge', antiSpoofingVerified: false, timestamp: new Date().toISOString(), elapsedMs: Math.round(now - motion.startedAt), checkpoints: motion.completed, baseline: motion.baseline, performance: performanceSummary };
  if (!await showConfirmation(frame.toDataURL('image/jpeg', .9), 'Круг пройден', 'Два снимка и результат движения готовы', token)) return;
  stopStream(); releaseModels(); $('capture-success').hidden = true; showResults();
}

function download(url, filename) { const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); }
function showResults() {
  phase = 'result'; renderStep();
  document.querySelector('.capture-column').hidden = true;
  document.querySelector('.intro').classList.add('completed');
  const out = $('results'); out.hidden = false;
  const allValidated = Object.values(captures).every(c => c.validated);
  out.innerHTML = `<div class="success-mark">${icon('check', 30)}</div><span class="eyebrow">СЪЁМКА ЗАВЕРШЕНА</span><h2>Оба кадра пойманы.</h2><p class="result-lead">${allValidated ? 'Лицо и документ прошли условия автосъёмки.' : 'Фотографии готовы. Снимки по кнопке не проходили автоматическую проверку.'}</p><div class="result-photos">${['face', 'document'].map((key, i) => `<article><div class="photo-wrap"><img src="${captures[key].image}" alt="Снимок ${key === 'face' ? 'лица' : 'документа'}"/><span>${icon(captures[key].validated ? 'check' : 'camera', 14)} ${captures[key].validated ? 'Авто' : 'По кнопке'}</span></div><h3>0${i + 1} / ${key === 'face' ? 'Лицо' : 'Документ'}</h3><p>${captures[key].validated ? `${captures[key].heldMs} мс удержания` : 'Без проверки'} · ${captures[key].width} × ${captures[key].height}</p><button class="download-photo text-button" data-key="${key}">${icon('download', 17)} Скачать фото</button></article>`).join('')}</div><article class="motion-result ${motionResult?.status === 'passed' ? 'passed' : 'unchecked'}"><span class="step-number">03</span><div><h3>${motionResult?.status === 'passed' ? 'Круговое движение выполнено' : 'Движение не проверено'}</h3><p>${motionResult?.status === 'passed' ? 'Последовательность поворотов и возврат в центр зафиксированы.' : 'Шаг пропущен. Результат проверки живости не получен.'}</p></div></article><div class="result-actions"><button class="primary-button" id="restart">Пройти ещё раз ${icon('arrow')}</button><button class="text-button" id="download-report">${icon('download', 18)} Отчёт JSON</button></div><p class="result-note">${allValidated ? 'Проверены положение лица, направление взгляда и границы документа.' : 'Для снимков по кнопке положение лица, взгляд и границы документа не проверялись.'}<br>Распознавание раскрытого паспорта приблизительное. Подлинность документа, личность и защита от подмены фото или видео не проверяются.</p>`;
  $('restart').onclick = reset;
  out.querySelectorAll('.download-photo').forEach(button => button.onclick = () => download(captures[button.dataset.key].image, `capture-${button.dataset.key}.jpg`));
  $('download-report').onclick = () => {
    const report = { status: 'completed', allValidated, allStepsPassed: allValidated && motionResult?.status === 'passed', motion: motionResult, motionThresholds: MOTION_LIMITS, thresholds: LIMITS, performanceThresholds: PERFORMANCE_LIMITS, faceModel: captures.face.validated ? '@tensorflow-models/face-landmarks-detection / MediaPipeFaceMesh' : null, documentDetector: captures.document.validated ? 'OpenCV.js contours + crease heuristic (not a trained neural model)' : null, captures: Object.fromEntries(Object.entries(captures).map(([key, { image, ...data }]) => [key, data])) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    download(url, 'capture-report.json'); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  window.scrollTo(0, 0);
}

$('start').onclick = start;
$('manual-mode').onclick = () => {
  if (phase === 'captured' || phase === 'result') return;
  if (captureMode === 'manual' && ['idle', 'error'].includes(phase)) {
    captureMode = 'auto'; manualReason = null; performanceSummary = null;
    start();
  } else {
    const shouldStart = ['idle', 'error'].includes(phase);
    switchToManual('user');
    if (shouldStart) start();
  }
};
$('manual-capture').onclick = async () => {
  if (step === 'liveness') return;
  if (phase !== 'running' || captureMode !== 'manual' || document.hidden || $('help').open) return;
  if (video.readyState < 2 || !video.videoWidth) { $('hint').textContent = 'Камера ещё не готова. Попробуйте через мгновение.'; return; }
  const token = session;
  try { sampleFrame(); await capture(null, null, token); } catch (error) { fail(error, token); }
};
$('skip-motion').onclick = () => {
  if (step !== 'liveness' || !['running', 'error'].includes(phase)) return;
  motionResult = { status: captureMode === 'manual' || phase === 'error' ? 'unavailable' : 'skipped', reason: phase === 'error' ? 'camera-error' : manualReason || 'user', antiSpoofingVerified: false };
  session++; stopStream(); releaseModels(); showResults();
};
$('document-orientation').querySelectorAll('button').forEach(button => button.onclick = () => {
  if (step !== 'document' || phase !== 'running') return;
  documentOrientation = button.dataset.orientation;
  $('document-orientation').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  gate.reset(); previousQuad = null; latest = null; drawOverlay();
  if (captureMode === 'manual') renderManual();
});
$('close-camera').onclick = reset;
$('flip').onclick = async () => {
  if (phase !== 'running' || step === 'liveness') return;
  const token = ++session; phase = 'loading'; gate.reset(); previousQuad = null; latest = null;
  $('flip').hidden = true;
  setMessage('Меняем камеру', 'Одно мгновение…', 'ПОДКЛЮЧЕНИЕ');
  facing = facing === 'user' ? 'environment' : 'user';
  try {
    if (captureMode === 'auto' && inference) {
      try { await withDeadline(inference, PERFORMANCE_LIMITS.inferenceTimeoutMs); }
      catch { if (token === session) { switchToManual('slow-inference'); phase = 'loading'; } }
    }
    if (token !== session || !await openCamera(token)) return;
    runCapture(token);
  } catch (error) { fail(error, token); }
};
$('debug').onchange = () => drawOverlay();
document.querySelectorAll('.help-trigger').forEach(button => button.onclick = () => { visibilityEpoch++; gate.reset(); motion.reset(); performanceGuard.reset(); $('help').showModal(); });
document.querySelectorAll('.dialog-close, .dialog-done').forEach(button => button.onclick = () => $('help').close());
$('help').addEventListener('click', e => { if (e.target === $('help')) $('help').close(); });
document.addEventListener('visibilitychange', () => { visibilityEpoch++; gate.reset(); motion.reset(); performanceGuard.reset(); previousQuad = null; });
window.addEventListener('pagehide', () => { session++; stopStream(); releaseModels(); phase = 'error'; });
window.addEventListener('pageshow', e => { if (e.persisted) reset(); });
const onResize = () => { gate.reset(); motion.reset(); performanceGuard.reset(); previousQuad = null; drawOverlay(); };
if (window.ResizeObserver) new ResizeObserver(onResize).observe(shell);
else window.addEventListener('resize', onResize);
renderStep();
