import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionChallenge, motionFaceReady } from '../src/liveness.js';
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
    for (let j = 0; j < 4; j++) feed(poseAt(target));
  }
}
test('a continuous full circle plus stable return passes; the circle alone does not', () => {
  const { motion, feed } = harness(); circle(feed);
  assert.equal(motion.stage, 'return'); assert.equal(motion.snapshot().ready, false);
  for (let i = 0; i < 8; i++) feed();
  assert.equal(motion.stage, 'passed'); assert.equal(motion.snapshot().progress, 1);
});
test('a still face cannot pass regardless of how long it is visible', () => {
  const { motion, feed } = harness(); for (let i = 0; i < 300; i++) feed();
  assert.equal(motion.completed, 0); assert.equal(motion.snapshot().ready, false);
});
test('teleporting between checkpoints and going the wrong way cannot pass', () => {
  let { motion, feed } = harness();
  for (let i = 0; i <= 8; i++) for (let j = 0; j < 4; j++) feed(poseAt(-Math.PI / 2 + i * Math.PI / 4));
  assert.notEqual(motion.stage, 'return');
  ({ motion, feed } = harness()); circle(feed, -1); assert.notEqual(motion.stage, 'return');
});
test('lost face, multiple faces, stale frames and large gaps reset progress', () => {
  for (const [valid, dt] of [[false, 80], [true, 500], [true, 0]]) {
    const { motion, feed } = harness(); for (let i = 0; i < 4; i++) feed(poseAt(-Math.PI / 2));
    assert.ok(motion.completed > 0); feed(neutral, valid, dt);
    assert.equal(motion.stage, 'calibrate'); assert.equal(motion.completed, 0);
  }
  assert.equal(motionFaceReady([], {}, neutral), false);
  assert.equal(motionFaceReady([{}, {}], {}, neutral), false);
});
test('passing through center cannot substitute for moving around the circle', () => {
  const { motion, feed } = harness();
  for (let i = 0; i < 4; i++) feed(poseAt(-Math.PI / 2));
  feed(); assert.equal(motion.completed, 0);
});
test('unstable calibration cannot lock an arbitrary moving pose', () => {
  const motion = new MotionChallenge();
  for (let i = 1; i < 20; i++) motion.update({ ...neutral, yaw: i % 2 ? 6 : -6 }, true, i * 80);
  assert.equal(motion.stage, 'calibrate');
});
