import test from 'node:test';
import assert from 'node:assert/strict';
import cv from '@techstark/opencv-js';
import { findDocument, estimatePose, POSE_INDICES, POSE_POINTS } from '../src/vision.js';
import { evaluateDocument } from '../src/geometry.js';
if (!cv.Mat) await new Promise(resolve => { cv.onRuntimeInitialized = () => resolve(); });
const guide = { x: 50, y: 100, width: 300, height: 212 };
function documentImage(rect = { x: 70, y: 120, width: 260, height: 170 }, crease = true, orientation = 'landscape') {
  const width = 400, height = 500, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inside = rect && x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
    const fold = inside && crease && (orientation === 'landscape' ? Math.abs(x - rect.x - rect.width / 2) < 3 : Math.abs(y - rect.y - rect.height / 2) < 3);
    const i = (y * width + x) * 4, color = inside ? fold ? 100 : 230 : 40;
    data[i] = color; data[i + 1] = color; data[i + 2] = color; data[i + 3] = 255;
  }
  return { width, height, data };
}
test('real OpenCV pipeline finds four edges of a document and passes the frame gate', () => {
  const points = findDocument(cv, documentImage(), guide);
  assert.equal(points.points.length, 4);
  assert.equal(evaluateDocument(points, guide, points.points).valid, true);
});
test('empty scenes are rejected; clipped documents remain candidates but cannot pass', () => {
  assert.equal(findDocument(cv, documentImage(null), guide), null);
  const clipped = findDocument(cv, documentImage({ x: -20, y: 120, width: 350, height: 170 }), guide);
  assert.ok(clipped); assert.equal(clipped.fullyVisible, false);
  assert.deepEqual(clipped.cornerVisible, [false, true, true, false]);
  assert.equal(evaluateDocument(clipped, guide, clipped.points).valid, false);
});
test('detected document outside the frame cannot trigger capture', () => {
  const points = findDocument(cv, documentImage({ x: 30, y: 120, width: 300, height: 170 }), guide);
  assert.ok(points); assert.equal(evaluateDocument(points, guide, points.points).valid, false);
});
test('plain rectangle and closed single-page proportions do not pass', () => {
  const plain = findDocument(cv, documentImage(undefined, false), guide);
  assert.ok(plain); assert.equal(plain.spread.visible, false);
  assert.equal(evaluateDocument(plain, guide, plain.points).valid, false);
  const closed = findDocument(cv, documentImage({ x: 140, y: 120, width: 120, height: 170 }), guide);
  assert.equal(evaluateDocument(closed, guide, closed.points).checks.find(c => c.id === 'alignment').ok, false);
});
test('vertical spread detects a horizontal fold and accepts the matching frame', () => {
  const g = { x: 90, y: 70, width: 220, height: 312 };
  const candidate = findDocument(cv, documentImage({ x: 107, y: 90, width: 186, height: 270 }, true, 'portrait'), g, 'portrait');
  assert.ok(candidate.spread.visible);
  assert.equal(evaluateDocument(candidate, g, candidate.points).valid, true);
});
test('small and off-center documents are detected early for guidance', () => {
  const small = findDocument(cv, documentImage({ x: 155, y: 175, width: 90, height: 64 }), guide);
  assert.ok(small); assert.match(evaluateDocument(small, guide, small.points).guidance.title, /ближе/);
  const offset = findDocument(cv, documentImage({ x: 5, y: 130, width: 180, height: 128 }), guide);
  assert.ok(offset); assert.equal(evaluateDocument(offset, guide, offset.points).guidance.direction, 'right');
});
function project(yaw, pitch, roll) {
  const ry = yaw * Math.PI / 180, rx = pitch * Math.PI / 180, rz = roll * Math.PI / 180;
  const points = Array.from({ length: 478 }, () => ({ x: 0, y: 0 }));
  for (let i = 0; i < POSE_INDICES.length; i++) {
    const [x, y, z] = POSE_POINTS.slice(i * 3, i * 3 + 3);
    const y1 = y * Math.cos(rx) - z * Math.sin(rx), z1 = y * Math.sin(rx) + z * Math.cos(rx);
    const x2 = x * Math.cos(ry) + z1 * Math.sin(ry), z2 = -x * Math.sin(ry) + z1 * Math.cos(ry);
    const x3 = x2 * Math.cos(rz) - y1 * Math.sin(rz), y3 = x2 * Math.sin(rz) + y1 * Math.cos(rz);
    points[POSE_INDICES[i]] = { x: 800 * x3 / (z2 + 60) + 200, y: 800 * y3 / (z2 + 60) + 400 };
  }
  return points;
}
test('real solvePnP recovers frontal pose and yaw/pitch/roll with the expected conventions', () => {
  for (const [yaw, pitch, roll] of [[0, 0, 0], [25, 0, 0], [-25, 0, 0], [0, 22, 0], [0, -22, 0], [0, 0, 18], [16, 12, 8]]) {
    const result = estimatePose(cv, project(yaw, pitch, roll), 400, 800);
    assert.ok(result, 'pose should exist');
    for (const [field, target] of Object.entries({ yaw, pitch, roll })) assert.ok(Math.abs(result[field] - target) < 0.1, `${field}: ${result[field]} vs ${target}`);
  }
});
