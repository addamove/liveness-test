import test from 'node:test';
import assert from 'node:assert/strict';
import { preflightReason, PerformanceGuard, withDeadline } from '../src/performance.js';

test('unsupported capabilities and known low resource hints choose manual before loading', () => {
  assert.equal(preflightReason({ wasm: false, webgl: true }), 'unsupported');
  assert.equal(preflightReason({ wasm: true, webgl: false }), 'unsupported');
  assert.equal(preflightReason({ wasm: true, webgl: true, memoryGB: 2, cores: 8 }), 'limited-resources');
  assert.equal(preflightReason({ wasm: true, webgl: true, memoryGB: 8, cores: 2 }), 'limited-resources');
});
test('missing or invalid hints do not misclassify an unknown device as slow', () => {
  for (const hints of [{}, { memoryGB: undefined, cores: undefined }, { memoryGB: 0, cores: 0 }, { memoryGB: 8, cores: 8 }]) {
    assert.equal(preflightReason({ wasm: true, webgl: true, ...hints }), null);
  }
});
test('warmup and one isolated stall do not force manual capture', () => {
  const guard = new PerformanceGuard();
  assert.equal(guard.observe(600, 0).calibrating, true);
  assert.equal(guard.observe(600, 660).fallback, false);
  for (let i = 0; i < 8; i++) assert.equal(guard.observe(i === 2 ? 360 : 30, 1320 + i * 100).fallback, false);
});
test('sustained slow processing switches even when face detection returns no face', () => {
  const guard = new PerformanceGuard(); let result;
  for (let i = 0; i < 6; i++) result = guard.observe(260, i * 320);
  assert.equal(result.fallback, true);
  assert.equal(result.meanMs, 260);
});
test('three severe stalls switch without waiting for the full sample window', () => {
  const guard = new PerformanceGuard(); let result;
  for (let i = 0; i < 5; i++) result = guard.observe(500, i * 560);
  assert.equal(result.fallback, true);
});
test('a severe synchronous stall triggers fallback even on the first warmup frame', () => {
  assert.equal(new PerformanceGuard().observe(1800, 0).fallback, true);
});
test('low actual cadence also triggers fallback, even with short individual calls', () => {
  const guard = new PerformanceGuard(); let result;
  for (let i = 0; i < 6; i++) result = guard.observe(30, i * 450);
  assert.equal(result.fallback, true);
});
test('reset excludes hidden-tab and camera-switch time from cadence', () => {
  const guard = new PerformanceGuard();
  guard.observe(30, 0); guard.observe(30, 90); guard.reset();
  let result;
  for (let i = 0; i < 6; i++) result = guard.observe(30, 100000 + i * 90);
  assert.equal(result.fallback, false); assert.equal(result.calibrating, false);
});
test('deadline accepts success and propagates model failure', async () => {
  assert.equal(await withDeadline(Promise.resolve(42), 100), 42);
  await assert.rejects(withDeadline(Promise.reject(new Error('WASM failed')), 100), /WASM failed/);
});
test('deadline releases caller on timeout and observes late model rejection', async () => {
  let rejectLate;
  const pending = new Promise((resolve, reject) => { rejectLate = reject; });
  await assert.rejects(withDeadline(pending, 5), { name: 'TimeoutError' });
  rejectLate(new Error('Late failure'));
  await new Promise(resolve => setTimeout(resolve, 5));
});
test('switching to manual cancels model wait without waiting for the model', async () => {
  const controller = new AbortController();
  const wait = withDeadline(new Promise(() => {}), 5000, controller.signal);
  controller.abort(); await assert.rejects(wait, { name: 'AbortError' });
});
