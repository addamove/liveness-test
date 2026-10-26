import test from 'node:test';
import assert from 'node:assert/strict';
import { HoldGate, coverCrop, guideFor, evaluateDocument, evaluateFace, FACE_OUTLINE, LIMITS } from '../src/geometry.js';

test('capture requires 400 ms and at least three fresh valid samples', () => {
  const gate = new HoldGate();
  assert.equal(gate.update(true, 0).ready, false);
  assert.equal(gate.update(true, 200).ready, false);
  assert.equal(gate.update(true, 399).ready, false);
  assert.equal(gate.update(true, 400).ready, true);
});
test('a failed frame resets the whole hold interval', () => {
  const gate = new HoldGate();
  gate.update(true, 0); gate.update(true, 200); gate.update(false, 300);
  assert.equal(gate.update(true, 400).elapsed, 0);
  assert.equal(gate.update(true, 600).ready, false);
  assert.equal(gate.update(true, 800).ready, true);
});
test('a stalled, duplicate or backward frame cannot complete capture', () => {
  const gate = new HoldGate();
  gate.update(true, 0);
  assert.equal(gate.update(true, 1000).elapsed, 0);
  gate.update(true, 1100);
  assert.equal(gate.update(true, 1100).elapsed, 0);
  assert.equal(gate.update(true, 1050).elapsed, 0);
});
test('cover geometry matches a landscape camera cropped into a portrait viewport', () => {
  const c = coverCrop(1280, 720, 400, 800);
  assert.deepEqual(c, { x: 460, y: 0, width: 360, height: 720 });
});
test('guide scales proportionally at different pixel densities', () => {
  for (const step of ['face', 'document']) {
    const a = guideFor(400, 800, step), b = guideFor(600, 1200, step);
    for (const key of Object.keys(a)) assert.ok(Math.abs(a[key] * 1.5 - b[key]) < 0.001);
  }
});
const guide = { x: 50, y: 100, width: 300, height: 200 };
const quad = [{ x: 70, y: 120 }, { x: 330, y: 120 }, { x: 330, y: 280 }, { x: 70, y: 280 }];
const observation = (points = quad, extra = {}) => ({ points, fullyVisible: true, cornerVisible: [true, true, true, true], rectangularity: 0, spread: { visible: true }, ...extra });
test('stable open spread wholly within guide passes', () => assert.equal(evaluateDocument(observation(), guide, quad).valid, true));
test('one corner outside stays white while the other three are green', () => {
  const outside = quad.map((p, i) => i === 1 ? { ...p, x: 360 } : p);
  const result = evaluateDocument(observation(outside), guide, outside);
  assert.equal(result.valid, false);
  assert.deepEqual(result.cornerStatus, [true, false, true, true]);
  assert.match(result.guidance.title, /угла/);
});
test('small, offset, lost and moving candidates give feedback without capture', () => {
  assert.equal(evaluateDocument(null, guide, quad).valid, false);
  assert.equal(evaluateDocument(observation(), guide, null).valid, false);
  const small = quad.map(p => ({ x: 200 + (p.x - 200) * .6, y: 200 + (p.y - 200) * .6 }));
  assert.match(evaluateDocument(observation(small), guide, small).guidance.title, /ближе/);
  const shifted = quad.map(p => ({ ...p, x: p.x + 35 }));
  assert.equal(evaluateDocument(observation(shifted), guide, shifted).guidance.direction, 'left');
  assert.equal(evaluateDocument(observation(quad.map(p => ({ ...p, x: p.x + 10 }))), guide, quad).valid, false);
  assert.deepEqual(evaluateDocument(null, guide, quad).cornerStatus, [false, false, false, false]);
});
test('aligned rectangle without a crease is never an automatically accepted spread', () => {
  const result = evaluateDocument(observation(quad, { spread: { visible: false } }), guide, quad);
  assert.equal(result.valid, false);
  assert.match(result.guidance.title, /сгиб/);
});
test('clipped corners are never green even when their coordinates are in the guide', () => {
  const result = evaluateDocument(observation(quad, { fullyVisible: false, cornerVisible: [false, true, true, true] }), guide, quad);
  assert.equal(result.valid, false); assert.equal(result.cornerStatus[0], false);
});
test('both spread guide orientations fit between controls and scale proportionally', () => {
  for (const orientation of ['landscape', 'portrait']) for (const [w, h] of [[390, 844], [375, 667], [424, 690]]) {
    const g = guideFor(w, h, 'document', orientation), bigger = guideFor(w * 1.5, h * 1.5, 'document', orientation);
    assert.ok(g.x > 0 && g.y > 100 && g.y + g.height < h * .64);
    assert.ok(Math.abs(g.width / g.height - (orientation === 'portrait' ? 1 / 1.42 : 1.42)) < .001);
    for (const key of Object.keys(g)) assert.ok(Math.abs(g[key] * 1.5 - bigger[key]) < .001);
  }
});
function faceFixture() {
  const g = { x: 100, y: 100, width: 200, height: 260 };
  const p = Array.from({ length: 478 }, () => ({ x: 200, y: 230, z: 0 }));
  FACE_OUTLINE.forEach((id, i) => { const angle = -Math.PI / 2 + i / FACE_OUTLINE.length * Math.PI * 2; p[id] = { x: 200 + 75 * Math.cos(angle), y: 230 + 105 * Math.sin(angle), z: 0 }; });
  for (const [a, b, t, d, iris, x] of [[33, 133, 159, 145, 468, 160], [362, 263, 386, 374, 473, 220]]) {
    p[a] = { x, y: 200 }; p[b] = { x: x + 30, y: 200 };
    p[t] = { x: x + 15, y: 196 }; p[d] = { x: x + 15, y: 204 }; p[iris] = { x: x + 15, y: 200 };
  }
  return { g, face: { keypoints: p }, pose: { yaw: 0, pitch: 0, roll: 0 } };
}
test('frontal centered face with open eyes and centered irises passes', () => {
  const { g, face, pose } = faceFixture(); assert.equal(evaluateFace([face], g, pose).valid, true);
});
test('no face, two faces, unknown pose and excessive head rotation fail', () => {
  const { g, face, pose } = faceFixture();
  assert.equal(evaluateFace([], g, pose).valid, false);
  assert.equal(evaluateFace([face, face], g, pose).valid, false);
  assert.equal(evaluateFace([face], g, null).valid, false);
  for (const field of ['yaw', 'pitch', 'roll']) assert.equal(evaluateFace([face], g, { ...pose, [field]: 30 }).valid, false);
});
test('looking sideways, closed eyes and partially clipped face fail', () => {
  let { g, face, pose } = faceFixture(); face.keypoints[468].x += 10;
  assert.equal(evaluateFace([face], g, pose).valid, false);
  ({ g, face, pose } = faceFixture()); face.keypoints[159] = face.keypoints[145];
  assert.equal(evaluateFace([face], g, pose).valid, false);
  ({ g, face, pose } = faceFixture()); face.keypoints[10].y = 80;
  assert.equal(evaluateFace([face], g, pose).valid, false);
});

test('selfie head and gaze tolerances are relaxed by exactly 15%, while limits still apply', () => {
  for (const [field, original] of Object.entries({ yaw: 13, pitch: 15, roll: 10 })) {
    const { g, face, pose } = faceFixture();
    assert.ok(Math.abs(LIMITS[field] - original * 1.15) < .00001);
    assert.equal(evaluateFace([face], g, { ...pose, [field]: original * 1.14 }).valid, true);
    assert.equal(evaluateFace([face], g, { ...pose, [field]: original * 1.16 }).valid, false);
  }
  for (const [fraction, expected] of [[.228, true], [.232, false]]) {
    const { g, face, pose } = faceFixture(); face.keypoints[468].x += 30 * fraction;
    assert.equal(evaluateFace([face], g, pose).valid, expected);
  }
  for (const [fraction, expected] of [[.114, true], [.116, false]]) {
    const { g, face, pose } = faceFixture(); face.keypoints[468].y += 30 * fraction;
    assert.equal(evaluateFace([face], g, pose).valid, expected);
  }
});
