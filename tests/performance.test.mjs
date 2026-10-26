import test from 'node:test';
import assert from 'node:assert/strict';
import { preflightReason, PerformanceGuard, PERFORMANCE_LIMITS, withDeadline, DEVICE_PERFORMANCE_CHECKS_ENABLED, performanceDeadline, inspectDevice } from '../src/performance.js';

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
const runFrames = (guard, times, start = 0) => {
  let at = start;
  return times.map(ms => { const result = guard.observe(ms, at); at += ms + 60; return result; });
};
const warmup = guard => runFrames(guard, Array(PERFORMANCE_LIMITS.warmupFrames).fill(30));
test('cold worker calls longer than the old 1.5s limit are excluded from speed and cadence', () => {
  const guard = new PerformanceGuard();
  assert.equal(guard.deadlineMs, 8000);
  for (const r of runFrames(guard, [2400, 1800, 900, 500])) {
    assert.equal(r.calibrating, true); assert.equal(r.fallback, false);
  }
  assert.equal(guard.deadlineMs, 4000);
  const results = runFrames(guard, Array(12).fill(30), 6000);
  assert.equal(results.at(-1).meanMs, 30);
  assert.equal(results.at(-1).meanIntervalMs, 90);
  assert.equal(results.some(r => r.fallback), false);
  assert.equal(results.at(-1).calibrating, false);
});
test('one slow worker result after warmup does not permanently disable automatic capture', () => {
  const guard = new PerformanceGuard(); warmup(guard);
  const results = runFrames(guard, [...Array(12).fill(30), 3500, ...Array(20).fill(30)], 400);
  assert.equal(results.some(r => r.fallback), false);
  assert.equal(results.at(-1).slowForMs, 0);
});
test('sustained slow processing needs a full window plus three seconds of evidence', () => {
  const guard = new PerformanceGuard(); warmup(guard);
  const results = runFrames(guard, Array(24).fill(260), 400);
  const first = results.findIndex(r => r.fallback);
  assert.ok(first > PERFORMANCE_LIMITS.minSamples);
  assert.equal(results[first].trigger, 'processing');
  assert.ok(results[first].slowForMs >= 3000);
  assert.equal(results[first].meanMs, 260);
});
test('a severe synchronous OpenCV stall still stops immediately, including warmup', () => {
  const r = new PerformanceGuard().observe(1800, 0, { blocking: true });
  assert.equal(r.fallback, true); assert.equal(r.trigger, 'ui-stall');
});
test('sustained low cadence is reported separately from model processing', () => {
  const guard = new PerformanceGuard(); warmup(guard); let result;
  for (let i = 0; i < 20; i++) result = guard.observe(30, 400 + i * 450);
  assert.equal(result.fallback, true); assert.equal(result.trigger, 'cadence');
});
test('recovery and hidden-tab resets discard previous slow evidence', () => {
  const guard = new PerformanceGuard(); warmup(guard);
  runFrames(guard, Array(10).fill(260), 400);
  guard.reset(); assert.equal(guard.deadlineMs, 8000);
  const results = runFrames(guard, Array(20).fill(30), 100000);
  assert.equal(results.some(r => r.fallback), false);
  assert.equal(results.at(-1).calibrating, false);
  assert.equal(results.at(-1).meanIntervalMs, 90);
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

test('temporary demo policy skips resource hints and speed deadlines but keeps cancellation', async () => {
  assert.equal(DEVICE_PERFORMANCE_CHECKS_ENABLED, false);
  assert.equal(performanceDeadline(12000), null);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { deviceMemory: 1, hardwareConcurrency: 1 } });
  try { assert.equal(inspectDevice({ needsWebGL: false }), null); }
  finally { if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor); else delete globalThis.navigator; }
  assert.equal(await withDeadline(new Promise(resolve => setTimeout(() => resolve(42), 20)), null), 42);
  const controller = new AbortController();
  const wait = withDeadline(new Promise(() => {}), null, controller.signal);
  controller.abort(); await assert.rejects(wait, { name: 'AbortError' });
});
