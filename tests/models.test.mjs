import test from 'node:test';
import assert from 'node:assert/strict';
import { documentTensor, decodeDocumentHeatmap } from '../src/docaligner.js';
import { normalizeFaces, faceInputSize } from '../src/face-points.js';
import { STEPS, PHOTO_STEPS, nextStep, CaptureStats } from '../src/comparison.js';
import { guideFor } from '../src/geometry.js';
import { ModelWorker } from '../src/model-worker.js';

test('Face Landmarker normalized points become pixel coordinates, including iris and z', () => {
  const points = Array.from({ length: 478 }, (_, i) => ({ x: i / 1000, y: .25, z: -.05 }));
  const [face] = normalizeFaces({ faceLandmarks: [points] }, 400, 800);
  assert.equal(face.keypoints.length, 478);
  assert.deepEqual(face.keypoints[473], { x: 189.2, y: 200, z: -20 });
  assert.equal(face.box.width, .477 * 400);
  assert.deepEqual(normalizeFaces({ faceLandmarks: [] }, 400, 800), []);
});
test('DocAligner tensor matches reference BGR CHW, not browser RGBA', () => {
  assert.deepEqual([...documentTensor(new Uint8ClampedArray([255, 0, 128, 255, 0, 255, 0, 255]))], [Math.fround(128 / 255), 0, 0, 1, 1, 0]);
});
const heatmap = () => {
  const data = new Float32Array(4 * 32 * 32);
  for (const [c, x, y] of [[0, 4, 5], [1, 26, 5], [2, 26, 25], [3, 4, 25]]) {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) data[c * 1024 + (y + dy) * 32 + x + dx] = .8;
  }
  return data;
};
test('DocAligner heatmaps scale corners to full source and ignore isolated noise', () => {
  const data = heatmap(); data[31] = 1;
  assert.deepEqual(decodeDocumentHeatmap(data, [1, 4, 32, 32], 320, 640), [{ x: 50, y: 120 }, { x: 270, y: 120 }, { x: 270, y: 520 }, { x: 50, y: 520 }]);
});
test('DocAligner rejects missing/weak corners, invalid tensors and degenerate polygons', () => {
  const data = heatmap(); data.fill(0, 3072);
  assert.equal(decodeDocumentHeatmap(data, [1, 4, 32, 32], 320, 640), null);
  assert.equal(decodeDocumentHeatmap(data, [1, 3, 32, 32], 320, 640), null);
  const flat = new Float32Array(4096).fill(.2);
  assert.equal(decodeDocumentHeatmap(flat, [1, 4, 32, 32], 320, 640), null);
  flat.fill(.8);
  assert.equal(decodeDocumentHeatmap(flat, [1, 4, 32, 32], 320, 640), null);
});
test('four-step sequence keeps two distinct document captures and identical guides', () => {
  assert.deepEqual(STEPS.map(nextStep), ['document', 'document-ml', 'liveness', undefined]);
  assert.equal(PHOTO_STEPS.length, 3);
  for (const orientation of ['portrait', 'landscape']) assert.deepEqual(guideFor(400, 700, 'document', orientation), guideFor(400, 700, 'document-ml', orientation));
});
test('comparison excludes warmup and measures all attempt frames, resets between engines', () => {
  const stats = new CaptureStats();
  [2400, 1800, 900, 800, 10, 20, 30, 40].forEach((ms, i) => stats.observe(ms, i % 2 === 0));
  assert.deepEqual(stats.snapshot(), { samples: 4, meanMs: 25, p95Ms: 40, detectedFrames: 2, detectionRate: .5 });
  stats.reset(); assert.equal(stats.snapshot().meanMs, null); assert.equal(stats.snapshot().samples, 0);
});
test('worker termination cancels pending inference and loading without leaving native work alive', async () => {
  let stopped = false;
  const worker = new ModelWorker({ postMessage() {}, terminate() { stopped = true; } });
  const pending = worker.request('detect');
  worker.dispose();
  await assert.rejects(pending, /остановлена/); assert.equal(stopped, true);
  const controller = new AbortController(); stopped = false;
  const loading = new ModelWorker({ postMessage() {}, terminate() { stopped = true; } });
  const init = loading.initialize(controller.signal); controller.abort();
  await assert.rejects(init, { name: 'AbortError' }); assert.equal(stopped, true);
});

test('face inference input is bounded without shrinking the photo coordinate system', () => {
  assert.deepEqual(faceInputSize(590, 960), { width: 393, height: 640 });
  assert.deepEqual(faceInputSize(1280, 720), { width: 640, height: 360 });
  assert.deepEqual(faceInputSize(320, 240), { width: 320, height: 240 });
  const [face] = normalizeFaces({ faceLandmarks: [[{ x: .5, y: .5, z: .1 }]] }, 590, 960);
  assert.deepEqual(face.keypoints[0], { x: 295, y: 480, z: 59 });
});
