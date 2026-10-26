// Temporary demo policy: keep measurements, but never classify a device as slow.
export const DEVICE_PERFORMANCE_CHECKS_ENABLED = false;
export const performanceDeadline = ms => DEVICE_PERFORMANCE_CHECKS_ENABLED ? ms : null;

export const PERFORMANCE_LIMITS = {
  loadTimeoutMs: 12000,
  warmupTimeoutMs: 8000,
  inferenceTimeoutMs: 4000,
  blockingStallMs: 1500,
  warmupFrames: 4,
  minSamples: 8,
  windowSize: 8,
  minSlowSamples: 4,
  meanProcessingMs: 220,
  meanIntervalMs: 350,
  sustainedSlowMs: 3000,
};

export function preflightReason({ wasm, webgl, memoryGB, cores }) {
  if (!wasm || !webgl) return 'unsupported';
  // These are conservative hints, not a reliable device age or speed measurement.
  // Missing or privacy-redacted information must not mean "slow".
  if ((memoryGB > 0 && memoryGB <= 2) || (cores > 0 && cores <= 2)) return 'limited-resources';
  return null;
}

export function inspectDevice({ needsWebGL = true } = {}) {
  const wasm = typeof WebAssembly === 'object';
  const memoryGB = DEVICE_PERFORMANCE_CHECKS_ENABLED ? navigator.deviceMemory : undefined;
  const cores = DEVICE_PERFORMANCE_CHECKS_ENABLED ? navigator.hardwareConcurrency : undefined;
  const earlyReason = preflightReason({ wasm, webgl: true, memoryGB, cores });
  if (earlyReason) return earlyReason;
  if (!needsWebGL) return null;
  const canvas = document.createElement('canvas');
  let gl;
  try { gl = canvas.getContext('webgl2') || canvas.getContext('webgl'); } catch { /* Unsupported or denied. */ }
  const webgl = Boolean(gl);
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return preflightReason({ wasm, webgl, memoryGB, cores });
}

export class PerformanceGuard {
  constructor() { this.reset(); }
  reset() { this.warmup = 0; this.samples = []; this.lastAt = null; this.slowSince = null; }
  get warmingUp() { return this.warmup < PERFORMANCE_LIMITS.warmupFrames; }
  get deadlineMs() { return this.warmingUp ? PERFORMANCE_LIMITS.warmupTimeoutMs : PERFORMANCE_LIMITS.inferenceTimeoutMs; }
  observe(processingMs, sampledAt, { blocking = false } = {}) {
    // OpenCV still runs on the UI thread: a real UI freeze must stop immediately.
    // Worker startup/compilation does not freeze the UI and has its own deadline.
    if (blocking && processingMs >= PERFORMANCE_LIMITS.blockingStallMs) return { calibrating: false, fallback: true, trigger: 'ui-stall', meanMs: processingMs };
    if (this.warmingUp) {
      this.warmup++;
      // Do not leak the last cold frame's duration into the first measured interval.
      this.lastAt = null;
      return { calibrating: true, warmingUp: true, warmupFrames: this.warmup, fallback: false };
    }
    const interval = this.lastAt === null ? null : sampledAt - this.lastAt;
    this.lastAt = sampledAt;
    this.samples.push({ processingMs, interval });
    if (this.samples.length > PERFORMANCE_LIMITS.windowSize) this.samples.shift();
    const count = this.samples.length;
    const meanMs = this.samples.reduce((sum, s) => sum + s.processingMs, 0) / count;
    const intervals = this.samples.map(s => s.interval).filter(n => n > 0);
    const meanIntervalMs = intervals.reduce((sum, n) => sum + n, 0) / (intervals.length || 1);
    const calibrating = count < PERFORMANCE_LIMITS.minSamples;
    // A single large outlier can skew the mean for seconds. Require several
    // independently slow samples, not just time spent waiting for one result.
    const slowProcessing = this.samples.filter(s => s.processingMs > PERFORMANCE_LIMITS.meanProcessingMs).length;
    const slowIntervals = intervals.filter(ms => ms > PERFORMANCE_LIMITS.meanIntervalMs).length;
    const trigger = meanMs > PERFORMANCE_LIMITS.meanProcessingMs && slowProcessing >= PERFORMANCE_LIMITS.minSlowSamples ? 'processing'
      : meanIntervalMs > PERFORMANCE_LIMITS.meanIntervalMs && slowIntervals >= PERFORMANCE_LIMITS.minSlowSamples ? 'cadence' : null;
    if (!calibrating && trigger) this.slowSince ??= sampledAt;
    else this.slowSince = null;
    const slowForMs = this.slowSince === null ? 0 : sampledAt - this.slowSince;
    const fallback = slowForMs >= PERFORMANCE_LIMITS.sustainedSlowMs;
    return { calibrating, warmingUp: false, fallback, trigger, slowForMs, meanMs, meanIntervalMs, samples: count };
  }
}

export function withDeadline(operation, ms, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (callback, value) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); callback(value); };
    const abort = () => finish(reject, Object.assign(new Error('Операция отменена'), { name: 'AbortError' }));
    // Always observe the original operation, including its late rejection after a timeout.
    Promise.resolve(operation).then(value => finish(resolve, value), error => finish(reject, error));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    if (ms != null) timer = setTimeout(() => finish(reject, Object.assign(new Error('Превышено время ожидания'), { name: 'TimeoutError' })), ms);
  });
}

export const MANUAL_REASONS = {
  user: 'Вы выбрали съёмку по кнопке.',
  unsupported: 'Автосъёмка недоступна в этом браузере.',
  'limited-resources': 'Для этого устройства выбран облегчённый режим.',
  'slow-inference': 'Автосъёмка работает медленно. Продолжите по кнопке.',
  'load-timeout': 'Автосъёмка загружается слишком долго. Продолжите по кнопке.',
  'model-error': 'Не удалось запустить автосъёмку. Камера работает по кнопке.',
};
