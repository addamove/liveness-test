import { FACE_OUTLINE, HoldGate } from './geometry.js';

export const MOTION_LIMITS = { yaw: 18, pitch: 13, maxGapMs: 350, minimumMs: 4000, timeoutMs: 45000 };
const TAU = Math.PI * 2;
const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export function motionFaceReady(faces, guide, pose) {
  if (faces.length !== 1 || !pose || faces[0].keypoints.length < 478) return false;
  const points = FACE_OUTLINE.map(i => faces[0].keypoints[i]);
  const height = Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y));
  return height > guide.height * .55 && height < guide.height * 1.12 && Math.abs(pose.roll) < 25
    && Math.abs(pose.yaw) < 38 && Math.abs(pose.pitch) < 38
    && points.every(p => ((p.x - guide.x - guide.width / 2) / (guide.width * .62)) ** 2 + ((p.y - guide.y - guide.height / 2) / (guide.height * .62)) ** 2 <= 1);
}

// A pose-motion challenge only. No identity, depth or presentation-attack check.
export class MotionChallenge {
  constructor() { this.reset(); }
  reset() {
    this.stage = 'calibrate'; this.baseline = null; this.neutral = null;
    this.completed = 0; this.travel = 0; this.lastAngle = null; this.lastAt = null;
    this.startedAt = null; this.centerGate = new HoldGate(450); this.targetGate = new HoldGate(120);
    this.cursor = { x: 0, y: 0 }; this.reason = '';
  }
  snapshot() {
    const angle = -Math.PI / 2 + this.completed * TAU / 8;
    return { stage: this.stage, completed: this.completed, progress: this.stage === 'passed' ? 1 : this.completed / 10,
      target: this.stage === 'circle' ? { x: Math.cos(angle), y: Math.sin(angle) } : { x: 0, y: 0 },
      cursor: this.cursor, reason: this.reason, ready: this.stage === 'passed' };
  }
  update(pose, valid, now, mirrored = true) {
    if (this.stage === 'passed') return this.snapshot();
    if (!valid || !pose || (this.lastAt !== null && (now - this.lastAt > MOTION_LIMITS.maxGapMs || now <= this.lastAt))
      || (this.startedAt !== null && now - this.startedAt > MOTION_LIMITS.timeoutMs)) {
      this.reset(); this.reason = valid ? 'Начнём круг заново. Посмотрите прямо.' : 'Верните одно лицо в овал.';
      return this.snapshot();
    }
    this.lastAt = now; this.reason = '';
    if (this.stage === 'calibrate') {
      const frontal = Math.abs(pose.yaw) < 13 && Math.abs(pose.pitch) < 16 && Math.abs(pose.roll) < 10;
      const steady = !this.neutral || Math.hypot(pose.yaw - this.neutral.yaw, pose.pitch - this.neutral.pitch) < 3;
      if (!frontal || !steady) { this.centerGate.reset(); this.neutral = null; }
      if (frontal) {
        this.neutral ||= { ...pose };
        if (this.centerGate.update(true, now).ready) {
          this.baseline = { ...this.neutral }; this.stage = 'circle'; this.startedAt = now;
        }
      }
      return this.snapshot();
    }
    this.cursor = { x: (pose.yaw - this.baseline.yaw) / MOTION_LIMITS.yaw * (mirrored ? 1 : -1), y: (pose.pitch - this.baseline.pitch) / MOTION_LIMITS.pitch };
    const radius = Math.hypot(this.cursor.x, this.cursor.y);
    if (this.stage === 'return') {
      if (this.centerGate.update(radius < .32 && Math.abs(pose.roll) < 10, now).ready && now - this.startedAt >= MOTION_LIMITS.minimumMs) this.stage = 'passed';
      return this.snapshot();
    }
    if (this.completed > 0) {
      if (radius < .4 || radius > 1.7) {
        this.completed = 0; this.travel = 0; this.lastAngle = null; this.targetGate.reset();
        this.reason = 'Ведите лицо по окружности, не через центр.';
      } else {
        const angle = Math.atan2(this.cursor.y, this.cursor.x), delta = this.lastAngle === null ? 0 : angleDelta(angle, this.lastAngle);
        if (Math.abs(delta) > .7 || delta < -.3) {
          this.completed = 0; this.travel = 0; this.lastAngle = null; this.targetGate.reset();
          this.reason = 'Плавно следуйте за точкой по часовой стрелке.';
        } else { this.travel += delta; this.lastAngle = angle; }
      }
    }
    const target = this.snapshot().target;
    const close = Math.hypot(this.cursor.x - target.x, this.cursor.y - target.y) < .32;
    if (this.targetGate.update(close, now).ready) {
      if (this.completed === 0) { this.lastAngle = Math.atan2(this.cursor.y, this.cursor.x); this.startedAt = now; }
      this.completed++; this.targetGate.reset();
      if (this.completed === 9) {
        if (this.travel < 5.5) { this.completed = 0; this.travel = 0; this.lastAngle = null; }
        else { this.stage = 'return'; this.centerGate.reset(); }
      }
    }
    return this.snapshot();
  }
}
