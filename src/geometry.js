export const FACE_OUTLINE = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
export const LIMITS = { holdMs: 400, maxGapMs: 350, yaw: 14.95, pitch: 17.25, roll: 11.5, gaze: 0.23, verticalGaze: 0.115, eyeOpen: 0.12 };
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function guideFor(width, height, step, orientation = 'landscape') {
  const face = step !== 'document' && step !== 'document-ml';
  const ratio = orientation === 'portrait' ? 1 / 1.42 : 1.42;
  const w = face ? Math.min(width * 0.70, height * 0.34) : Math.min(width * 0.84, height * 0.42 * ratio);
  const h = face ? w * 1.28 : w / ratio;
  return { x: (width - w) / 2, y: height * (face ? 0.37 : 0.41) - h / 2, width: w, height: h };
}

export function coverCrop(sourceWidth, sourceHeight, width, height) {
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  return { x: (sourceWidth - width / scale) / 2, y: (sourceHeight - height / scale) / 2, width: width / scale, height: height / scale };
}

export class HoldGate {
  constructor(duration = LIMITS.holdMs, maxGap = LIMITS.maxGapMs) { this.duration = duration; this.maxGap = maxGap; this.reset(); }
  reset() { this.started = null; this.last = null; this.samples = 0; }
  update(valid, now) {
    if (!valid) { this.reset(); return { progress: 0, elapsed: 0, ready: false }; }
    if (this.last === null || now - this.last > this.maxGap || now <= this.last) {
      this.started = now;
      this.samples = 0;
    }
    this.last = now;
    this.samples++;
    const elapsed = now - this.started;
    return { progress: Math.min(1, elapsed / this.duration), elapsed, ready: elapsed >= this.duration && this.samples >= 3 };
  }
}

const check = (id, label, ok, detail) => ({ id, label, ok: Boolean(ok), detail });
const outcome = (checks, metrics = {}) => ({ checks, valid: checks.every(c => c.ok), metrics });

export function evaluateFace(faces, guide, pose) {
  const one = faces.length === 1;
  const checks = [check('face', 'Одно лицо в кадре', one, faces.length ? `Лиц: ${faces.length}` : 'Лицо не найдено')];
  const p = one ? faces[0].keypoints : null;
  if (!p || p.length < 478) {
    return outcome([...checks, check('frame', 'Лицо внутри овала', false, 'Встаньте в рамку'), check('pose', 'Голова прямо', false, 'Ожидаем лицо'), check('gaze', 'Взгляд в камеру', false, 'Ожидаем глаза')]);
  }
  const outline = FACE_OUTLINE.map(i => p[i]);
  const cx = guide.x + guide.width / 2, cy = guide.y + guide.height / 2;
  const inFrame = outline.every(k => ((k.x - cx) / (guide.width / 2)) ** 2 + ((k.y - cy) / (guide.height / 2)) ** 2 <= 1);
  const faceHeight = Math.max(...outline.map(k => k.y)) - Math.min(...outline.map(k => k.y));
  const fill = faceHeight / guide.height;
  const centered = Math.abs((p[10].x + p[152].x) / 2 - cx) < guide.width * 0.15;
  checks.push(check('frame', 'Лицо внутри овала', inFrame && fill >= 0.62 && centered, !inFrame ? 'Отодвиньтесь или вернитесь в овал' : fill < 0.62 ? 'Поднесите камеру ближе' : !centered ? 'Расположитесь по центру' : 'Лицо целиком в рамке'));
  const straight = pose && Math.abs(pose.yaw) <= LIMITS.yaw && Math.abs(pose.pitch) <= LIMITS.pitch && Math.abs(pose.roll) <= LIMITS.roll;
  checks.push(check('pose', 'Голова прямо', straight, pose ? `↔ ${Math.round(pose.yaw)}°  ↕ ${Math.round(pose.pitch)}°  ⤾ ${Math.round(pose.roll)}°` : 'Не удалось оценить поворот'));
  const eyes = [[33, 133, 159, 145, 468], [362, 263, 386, 374, 473]].map(([a, b, top, bottom, iris]) => {
    const width = distance(p[a], p[b]);
    const vx = p[b].x - p[a].x, vy = p[b].y - p[a].y;
    const horizontal = ((p[iris].x - p[a].x) * vx + (p[iris].y - p[a].y) * vy) / (width * width);
    const opening = distance(p[top], p[bottom]) / width;
    const center = { x: (p[top].x + p[bottom].x) / 2, y: (p[top].y + p[bottom].y) / 2 };
    // Normalize vertical gaze by eye width, so blinking cannot explode the ratio.
    const vertical = Math.abs((p[iris].x - center.x) * -vy + (p[iris].y - center.y) * vx) / (width * width);
    return { horizontal, opening, vertical };
  });
  const eyesOpen = eyes.every(e => e.opening >= LIMITS.eyeOpen);
  const gaze = eyes.every(e => Math.abs(e.horizontal - 0.5) <= LIMITS.gaze && e.vertical <= LIMITS.verticalGaze);
  checks.push(check('gaze', 'Взгляд в камеру', eyesOpen && gaze, !eyesOpen ? 'Откройте глаза' : gaze ? 'Смотрите в объектив' : 'Переведите взгляд на объектив'));
  return outcome(checks, { ...pose, faceFill: fill, eyes });
}

export function polygonArea(points) {
  return Math.abs(points.reduce((a, p, i) => { const q = points[(i + 1) % points.length]; return a + p.x * q.y - q.x * p.y; }, 0) / 2);
}

export function orderQuad(points) {
  const cx = points.reduce((a, p) => a + p.x, 0) / 4, cy = points.reduce((a, p) => a + p.y, 0) / 4;
  const sorted = [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  const first = sorted.reduce((best, p, i) => p.x + p.y < sorted[best].x + sorted[best].y ? i : best, 0);
  return [...sorted.slice(first), ...sorted.slice(0, first)];
}

export function evaluateDocument(observation, guide, previous) {
  const points = observation?.points;
  const found = points?.length === 4;
  const inGuide = p => p.x >= guide.x && p.y >= guide.y && p.x <= guide.x + guide.width && p.y <= guide.y + guide.height;
  const inside = found && observation.fullyVisible && points.every(inGuide);
  const fill = found ? polygonArea(points) / (guide.width * guide.height) : 0;
  const motion = found && previous?.length === 4 ? Math.max(...points.map((p, i) => distance(p, previous[i]))) / guide.width : Infinity;
  const targets = [{ x: guide.x, y: guide.y }, { x: guide.x + guide.width, y: guide.y }, { x: guide.x + guide.width, y: guide.y + guide.height }, { x: guide.x, y: guide.y + guide.height }];
  const corners = found ? points.map((p, i) => Boolean(observation.cornerVisible?.[i] && inGuide(p) && Math.hypot((p.x - targets[i].x) / guide.width, (p.y - targets[i].y) / guide.height) < .24)) : [false, false, false, false];
  const lengths = found ? points.map((p, i) => distance(p, points[(i + 1) % 4])) : [];
  const ratio = found ? (lengths[0] + lengths[2]) / (lengths[1] + lengths[3]) : 0;
  const aspect = ratio / (guide.width / guide.height);
  const aligned = found && aspect > .78 && aspect < 1.25 && observation.rectangularity < .38;
  const spread = Boolean(observation?.spread?.visible);
  const checks = [
    check('document', 'Видны четыре края', found && observation.fullyVisible, found ? observation.fullyVisible ? 'Контур найден' : 'Часть документа обрезана' : 'Раскройте паспорт на контрастном фоне'),
    check('frame', 'Документ внутри рамки', inside, inside ? 'Все углы внутри' : 'Поместите все углы в рамку'),
    check('size', 'Подходящий размер', fill >= .55 && corners.every(Boolean), `Заполнение ${Math.round(fill * 100)}% · углы ${corners.filter(Boolean).length}/4`),
    check('alignment', 'Разворот параллельно рамке', aligned, aligned ? 'Форма разворота подходит' : 'Выровняйте разворот или переключите рамку'),
    check('spread', 'Виден центральный сгиб', spread, spread ? 'Видны признаки двух страниц' : 'Раскройте паспорт: обе страницы и сгиб должны быть видны'),
    check('stable', 'Камера неподвижна', motion < 0.025, motion < 0.025 ? 'Держите ещё мгновение' : 'Зафиксируйте камеру'),
  ];
  let guidance = { title: 'Покажите раскрытый паспорт', hint: 'Две страницы целиком, сгиб посередине. Лучше на однотонном тёмном фоне.' };
  if (found) {
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
    const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
    const dx = (minX + maxX) / 2 - (guide.x + guide.width / 2), dy = (minY + maxY) / 2 - (guide.y + guide.height / 2);
    if (!observation.fullyVisible || maxX - minX > guide.width || maxY - minY > guide.height) guidance = { title: 'Отодвиньте камеру чуть дальше', hint: 'Весь разворот должен поместиться внутри рамки.' };
    else if (Math.abs(dx) > guide.width * .07 || Math.abs(dy) > guide.height * .07) {
      const direction = Math.abs(dx / guide.width) > Math.abs(dy / guide.height) ? (dx > 0 ? 'left' : 'right') : (dy > 0 ? 'up' : 'down');
      guidance = { direction, title: 'Сдвиньте паспорт', hint: 'Совместите углы разворота с углами рамки.' };
    } else if (!aligned) guidance = { title: 'Выровняйте раскрытый паспорт', hint: 'Держите камеру над страницами. При необходимости переключите положение рамки.' };
    else if (fill < .55) guidance = { title: 'Поднесите камеру чуть ближе', hint: 'Разворот должен занять почти всю рамку.' };
    else if (!inside || !corners.every(Boolean)) guidance = { title: 'Совместите все четыре угла', hint: 'Зелёный угол уже на месте. Поправьте остальные.' };
    else if (!spread) guidance = { title: 'Покажите обе страницы и сгиб', hint: 'Паспорт должен быть раскрыт. Расправьте страницы и уберите блик со сгиба.' };
    else guidance = { title: 'Отлично. Не двигайтесь', hint: 'Все углы на месте — сейчас сделаем фото.' };
  }
  return { ...outcome(checks, { fill, ratio, motion: Number.isFinite(motion) ? motion : null, corners: points, spread: observation?.spread ?? null }), points, cornerStatus: corners, guidance };
}
