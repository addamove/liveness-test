export const PERFORMANCE_LIMITS = {
  loadTimeoutMs: 12000,
  inferenceTimeoutMs: 1500,
  warmupFrames: 2,
  minSamples: 4,
  windowSize: 8,
  meanProcessingMs: 220,
  meanIntervalMs: 350,
  consecutiveSlowFrames: 3,
};

export function preflightReason({ wasm, webgl, memoryGB, cores }) {
  if (!wasm || !webgl) return 'unsupported';
  // These are conservative hints, not a reliable device age or speed measurement.
  // Missing or privacy-redacted information must not mean "slow".
  if ((memoryGB > 0 && memoryGB <= 2) || (cores > 0 && cores <= 2)) return 'limited-resources';
  return null;
}

export function inspectDevice() {
  const wasm = typeof WebAssembly === 'object';
  const memoryGB = navigator.deviceMemory, cores = navigator.hardwareConcurrency;
  const earlyReason = preflightReason({ wasm, webgl: true, memoryGB, cores });
  if (earlyReason) return earlyReason;
  const canvas = document.createElement('canvas');
  let gl;
  try { gl = canvas.getContext('webgl2') || canvas.getContext('webgl'); } catch { /* Unsupported or denied. */ }
  const webgl = Boolean(gl);
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return preflightReason({ wasm, webgl, memoryGB, cores });
}

export class PerformanceGuard {
  constructor() { this.reset(); }
  reset() { this.warmup = 0; this.samples = []; this.lastAt = null; this.slowCount = 0; }
  observe(processingMs, sampledAt) {
    // A synchronous WASM call can block before a timeout callback gets a turn.
    // Stop after that first severe stall, including during warmup.
    if (processingMs >= PERFORMANCE_LIMITS.inferenceTimeoutMs) return { calibrating: false, fallback: true, meanMs: processingMs };
    const interval = this.lastAt === null ? null : sampledAt - this.lastAt;
    this.lastAt = sampledAt;
    if (this.warmup++ < PERFORMANCE_LIMITS.warmupFrames) return { calibrating: true, fallback: false };
    this.samples.push({ processingMs, interval });
    if (this.samples.length > PERFORMANCE_LIMITS.windowSize) this.samples.shift();
    this.slowCount = processingMs > 350 ? this.slowCount + 1 : 0;
    const count = this.samples.length;
    const meanMs = this.samples.reduce((sum, s) => sum + s.processingMs, 0) / count;
    const intervals = this.samples.map(s => s.interval).filter(n => n > 0);
    const meanIntervalMs = intervals.reduce((sum, n) => sum + n, 0) / (intervals.length || 1);
    const calibrating = count < PERFORMANCE_LIMITS.minSamples;
    const fallback = this.slowCount >= PERFORMANCE_LIMITS.consecutiveSlowFrames || (!calibrating && (meanMs > PERFORMANCE_LIMITS.meanProcessingMs || meanIntervalMs > PERFORMANCE_LIMITS.meanIntervalMs));
    return { calibrating, fallback, meanMs, meanIntervalMs, samples: count };
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
    timer = setTimeout(() => finish(reject, Object.assign(new Error('Превышено время ожидания'), { name: 'TimeoutError' })), ms);
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
