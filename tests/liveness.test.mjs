import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionChallenge, motionFaceReady, estimateMotionPose, MOTION_LIMITS } from '../src/liveness.js';
const neutral = { yaw: 0, pitch: 5, roll: 0 };
const poseAt = (angle, radius = 1) => ({ yaw: 18 * Math.cos(angle) * radius, pitch: 5 + 13 * Math.sin(angle) * radius, roll: 0 });
function harness() {
  const motion = new MotionChallenge(); let now = 0;
  const feed = (pose = neutral, valid = true, dt = 80) => motion.update(pose, valid, now += dt);
  for (let i = 0; i < 8; i++) feed();
  assert.equal(motion.stage, 'circle');
  return { motion, feed };
}
function circle(feed, sign = 1) {
  for (let i = 0; i <= 8; i++) {
    const target = -Math.PI / 2 + sign * i * Math.PI / 4;
    if (i) for (let j = 1; j <= 4; j++) feed(poseAt(target - sign * Math.PI / 4 + sign * j * Math.PI / 16));
    for (let j = 0; j < 8; j++) feed(poseAt(target));
  }
}
test('a continuous full circle plus stable return passes; the circle alone does not', () => {
  const { motion, feed } = harness(); circle(feed);
  assert.equal(motion.stage, 'return'); assert.equal(motion.snapshot().ready, false);
  for (let i = 0; i < 12; i++) feed();
  assert.equal(motion.stage, 'passed'); assert.equal(motion.snapshot().progress, 1);
});
test('a still face cannot pass regardless of how long it is visible', () => {
  const { motion, feed } = harness(); for (let i = 0; i < 300; i++) feed();
  assert.equal(motion.completed, 0); assert.equal(motion.snapshot().ready, false);
});
test('out-of-order and opposite targets cannot complete the circle', () => {
  let { motion, feed } = harness();
  for (let i = 0; i < 40; i++) for (let j = 0; j < 6; j++) feed(poseAt(i % 2 ? Math.PI / 2 : -Math.PI / 2));
  assert.notEqual(motion.stage, 'return');
  ({ motion, feed } = harness()); circle(feed, -1); assert.notEqual(motion.stage, 'return');
});
test('brief tracking loss and a single slow frame preserve completed targets', () => {
  for (const dt of [80, 500]) {
    const { motion, feed } = harness(); for (let i = 0; i < 9; i++) feed(poseAt(-Math.PI / 2));
    const completed = motion.completed; assert.ok(completed > 0);
    const paused = feed(null, false, dt);
    assert.equal(paused.stage, 'circle'); assert.equal(paused.completed, completed); assert.equal(paused.paused, true);
    const resumed = feed(poseAt(-Math.PI / 2));
    assert.equal(resumed.stage, 'circle'); assert.equal(resumed.completed, completed); assert.equal(resumed.paused, false);
  }
});
test('extended loss resets; duplicate frames never advance a checkpoint', () => {
  const { motion, feed } = harness(); for (let i = 0; i < 9; i++) feed(poseAt(-Math.PI / 2));
  const completed = motion.completed;
  for (let i = 0; i < 30; i++) feed(poseAt(0), true, 0);
  assert.equal(motion.completed, completed);
  feed(null, false, MOTION_LIMITS.lostFaceGraceMs + 1);
  assert.equal(motion.stage, 'calibrate'); assert.equal(motion.completed, 0);
  assert.equal(motionFaceReady([], {}, neutral), false);
  assert.equal(motionFaceReady([{}, {}], {}, neutral), false);
});
test('a tracking spike cannot throw the cursor across the screen or earn progress', () => {
  const { motion, feed } = harness(); for (let i = 0; i < 9; i++) feed(poseAt(-Math.PI / 2));
  const before = motion.snapshot();
  const after = feed({ yaw: 130, pitch: -150, roll: 0 });
  assert.equal(after.stage, 'circle'); assert.equal(after.completed, before.completed);
  assert.deepEqual(after.cursor, before.cursor); assert.equal(after.paused, true);
});
test('passing through the center pauses progress without restarting calibration', () => {
  const { motion, feed } = harness(); for (let i = 0; i < 9; i++) feed(poseAt(-Math.PI / 2));
  const completed = motion.completed;
  for (let i = 0; i < 15; i++) feed();
  assert.equal(motion.completed, completed); assert.equal(motion.stage, 'circle');
});
test('noisy motion with occasional dropped detections still completes', () => {
  const { motion, feed } = harness(); let frame = 0;
  const noisyFeed = pose => {
    if (++frame % 17 === 0) feed(null, false);
    return feed({ ...pose, yaw: pose.yaw + Math.sin(frame * 2) * 1.3, pitch: pose.pitch + Math.cos(frame * 3) * .8 });
  };
  circle(noisyFeed);
  for (let i = 0; i < 18; i++) noisyFeed(neutral);
  assert.equal(motion.stage, 'passed');
});
test('cursor movement is bounded and smoothed even for a valid step in pose', () => {
  const { feed } = harness();
  const first = feed(poseAt(-Math.PI / 2));
  assert.ok(Math.hypot(first.cursor.x, first.cursor.y) < .7);
  for (let i = 0; i < 15; i++) {
    const state = feed(poseAt(-Math.PI / 2, 1.5));
    assert.ok(Math.hypot(state.cursor.x, state.cursor.y) <= 1.250001);
  }
});
test('unstable calibration cannot lock an arbitrary moving pose', () => {
  const motion = new MotionChallenge();
  for (let i = 1; i < 20; i++) motion.update({ ...neutral, yaw: i % 2 ? 6 : -6 }, true, i * 80);
  assert.equal(motion.stage, 'calibrate');
});

function landmarkPose(yaw, pitch) {
  const p = Array.from({ length: 478 }, () => ({ x: 200, y: 230 }));
  p[33] = { x: 150, y: 180 }; p[263] = { x: 250, y: 180 }; p[152] = { x: 200, y: 310 };
  p[1] = { x: 200 - yaw / 120 * 100, y: 180 + (.34 + pitch / 150) * 130 };
  return p;
}
test('motion landmarks are invariant to face translation, camera scale and head roll', () => {
  for (const [yaw, pitch] of [[0, 0], [18, 0], [0, 13], [-12, -9]]) {
    const p = landmarkPose(yaw, pitch), angle = .2;
    const transformed = p.map(({ x, y }) => ({ x: 80 + 1.7 * (x * Math.cos(angle) - y * Math.sin(angle)), y: 30 + 1.7 * (x * Math.sin(angle) + y * Math.cos(angle)) }));
    for (const points of [p, transformed]) {
      const result = estimateMotionPose(points);
      assert.ok(Math.abs(result.yaw - yaw) < .001); assert.ok(Math.abs(result.pitch - pitch) < .001);
    }
  }
  assert.equal(estimateMotionPose([]), null);
});
