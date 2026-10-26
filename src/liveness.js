import { FACE_OUTLINE, HoldGate } from './geometry.js';

export const MOTION_LIMITS = { yaw: 18, pitch: 13, maxGapMs: 350, lostFaceGraceMs: 1200, smoothingMs: 150, minimumMs: 4000, timeoutMs: 60000 };
const TAU = Math.PI * 2;
const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

// For the motion cursor, use scale/translation/roll-independent landmark ratios.
// Unlike a six-point PnP solve, these cannot flip to another 3D solution.
// Values are approximate control angles, calibrated to the user's neutral face.
export function estimateMotionPose(points) {
  const left = points?.[33], right = points?.[263], nose = points?.[1], chin = points?.[152];
  if (![left, right, nose, chin].every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return null;
  const width = Math.hypot(right.x - left.x, right.y - left.y);
  if (width < 10) return null;
  const ex = (right.x - left.x) / width, ey = (right.y - left.y) / width;
  const cx = (right.x + left.x) / 2, cy = (right.y + left.y) / 2;
  const along = p => ((p.x - cx) * ex + (p.y - cy) * ey) / width;
  const down = p => (p.x - cx) * -ey + (p.y - cy) * ex;
  const height = down(chin);
  if (height < width * .4) return null;
  return { yaw: -along(nose) * 120, pitch: (down(nose) / height - .34) * 150, roll: Math.atan2(ey, ex) * 180 / Math.PI };
}

export function motionFaceReady(faces, guide, pose) {
  if (faces.length !== 1 || !pose || faces[0].keypoints.length < 478) return false;
  const points = FACE_OUTLINE.map(i => faces[0].keypoints[i]);
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  // The oval is a guide during movement, not the strict selfie capture boundary.
  return maxY - minY > guide.height * .45 && maxY - minY < guide.height * 1.4
    && Math.abs((minX + maxX) / 2 - guide.x - guide.width / 2) < guide.width * .4
    && Math.abs((minY + maxY) / 2 - guide.y - guide.height / 2) < guide.height * .4
    && Math.abs(pose.roll) < 40 && Math.abs(pose.yaw) < 55 && Math.abs(pose.pitch) < 55;
}

// A pose-motion challenge only. No identity, depth or presentation-attack check.
export class MotionChallenge {
  constructor() { this.reset(); }
  reset() {
    this.stage = 'calibrate'; this.baseline = null; this.neutralSamples = [];
    this.completed = 0; this.lastAt = null; this.lastGoodAt = null; this.filteredAt = null;
    this.startedAt = null; this.centerGate = new HoldGate(450); this.targetGate = new HoldGate(120);
    this.history = []; this.filtered = null; this.cursor = { x: 0, y: 0 }; this.reason = ''; this.paused = false;
  }
  snapshot() {
    const angle = -Math.PI / 2 + this.completed * TAU / 8;
    return { stage: this.stage, completed: this.completed, progress: this.stage === 'passed' ? 1 : this.completed / 10,
      target: this.stage === 'circle' ? { x: Math.cos(angle), y: Math.sin(angle) } : { x: 0, y: 0 },
      cursor: this.cursor, paused: this.paused, reason: this.reason, ready: this.stage === 'passed' };
  }
  pause(now, reason) {
    this.centerGate.reset(); this.targetGate.reset(); this.paused = true; this.reason = reason;
    if (this.lastGoodAt !== null && now - this.lastGoodAt > MOTION_LIMITS.lostFaceGraceMs) {
      this.reset(); this.reason = 'Лицо потеряно надолго. Посмотрите прямо, чтобы начать снова.';
    }
    return this.snapshot();
  }
  update(pose, valid, now, mirrored = true) {
    if (this.stage === 'passed') return this.snapshot();
    if (this.lastAt !== null && now <= this.lastAt) return this.snapshot();
    const gap = this.lastAt === null ? 0 : now - this.lastAt;
    this.lastAt = now;
    if (this.startedAt !== null && now - this.startedAt > MOTION_LIMITS.timeoutMs) { this.reset(); this.reason = 'Попробуем ещё раз. Посмотрите прямо.'; return this.snapshot(); }
    if (!valid || !pose || ![pose.yaw, pose.pitch, pose.roll].every(Number.isFinite)) return this.pause(now, 'Верните одно лицо к центру овала — прогресс сохранён.');
    if (this.lastGoodAt !== null && now - this.lastGoodAt > MOTION_LIMITS.lostFaceGraceMs) { this.reset(); this.lastAt = now; }
    if (gap > MOTION_LIMITS.maxGapMs) { this.centerGate.reset(); this.targetGate.reset(); this.history = []; }
    // A single tracking spike must neither move the cursor nor advance a target.
    if (this.filtered && Math.hypot(pose.yaw - this.filtered.yaw, pose.pitch - this.filtered.pitch) > 28) return this.pause(now, 'Двигайтесь плавнее — прогресс сохранён.');
    this.lastGoodAt = now; this.paused = false; this.reason = '';
    this.history.push({ ...pose }); if (this.history.length > 3) this.history.shift();
    const stable = Object.fromEntries(['yaw', 'pitch', 'roll'].map(key => [key, median(this.history.map(p => p[key]))]));
    const alpha = this.filteredAt === null ? 1 : 1 - Math.exp(-Math.min(now - this.filteredAt, 180) / MOTION_LIMITS.smoothingMs);
    this.filtered ||= { ...stable };
    for (const key of ['yaw', 'pitch', 'roll']) this.filtered[key] += alpha * (stable[key] - this.filtered[key]);
    this.filteredAt = now;
    if (this.stage === 'calibrate') {
      const frontal = Math.abs(pose.yaw) < 18 && Math.abs(pose.pitch) < 22 && Math.abs(pose.roll) < 15;
      this.neutralSamples.push({ ...pose }); if (this.neutralSamples.length > 7) this.neutralSamples.shift();
      const steady = ['yaw', 'pitch'].every(key => Math.max(...this.neutralSamples.map(p => p[key])) - Math.min(...this.neutralSamples.map(p => p[key])) < 6);
      if (this.centerGate.update(frontal && steady, now).ready) {
        this.baseline = Object.fromEntries(['yaw', 'pitch', 'roll'].map(key => [key, median(this.neutralSamples.map(p => p[key]))]));
        this.filtered = { ...this.baseline }; this.stage = 'circle'; this.startedAt = now; this.centerGate.reset();
      }
      return this.snapshot();
    }
    const normalized = p => ({ x: (p.yaw - this.baseline.yaw) / MOTION_LIMITS.yaw * (mirrored ? 1 : -1), y: (p.pitch - this.baseline.pitch) / MOTION_LIMITS.pitch });
    const cursor = normalized(this.filtered), raw = normalized(pose);
    const radius = Math.hypot(cursor.x, cursor.y), rawRadius = Math.hypot(raw.x, raw.y);
    // Radial clamping keeps the marker on the guide instead of at screen corners.
    const scale = Math.max(1, radius / 1.25);
    this.cursor = { x: cursor.x / scale, y: cursor.y / scale };
    if (this.stage === 'return') {
      if (this.centerGate.update(radius < .45 && rawRadius < .5 && Math.abs(pose.roll - this.baseline.roll) < 15, now).ready && now - this.startedAt >= MOTION_LIMITS.minimumMs) this.stage = 'passed';
      return this.snapshot();
    }
    const targetAngle = -Math.PI / 2 + this.completed * TAU / 8;
    const close = radius >= .55 && radius <= 1.65 && rawRadius >= .5 && rawRadius <= 1.8
      && Math.abs(angleDelta(Math.atan2(cursor.y, cursor.x), targetAngle)) < .45
      && Math.abs(angleDelta(Math.atan2(raw.y, raw.x), targetAngle)) < .5;
    if (this.targetGate.update(close, now).ready) {
      this.completed++; this.targetGate.reset();
      if (this.completed === 9) { this.stage = 'return'; this.centerGate.reset(); }
    }
    return this.snapshot();
  }
}
