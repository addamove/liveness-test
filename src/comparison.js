import { PERFORMANCE_LIMITS } from './performance.js';

export const STEPS = ['face', 'document', 'document-ml', 'liveness'];
export const PHOTO_STEPS = STEPS.slice(0, 3);
export const isDocumentStep = step => step === 'document' || step === 'document-ml';
export const STEP_LABELS = { face: 'Лицо', document: 'Паспорт · OpenCV', 'document-ml': 'Паспорт · DocAligner', liveness: 'Движение лица' };
export const nextStep = step => STEPS[STEPS.indexOf(step) + 1];
export const normalizeRun = value => STEPS.includes(value) ? value : 'flow';
export const firstStep = run => run === 'flow' ? 'face' : normalizeRun(run) === 'flow' ? 'face' : run;
export const nextRunStep = (step, run) => run === 'flow' ? nextStep(step) : undefined;
export const modelsForStep = step => ({ face: !isDocumentStep(step), document: step === 'document-ml', opencv: step !== 'liveness' });

export class CaptureStats {
  constructor() { this.reset(); }
  reset() { this.times = []; this.frames = 0; this.found = 0; }
  observe(ms, found) {
    // Match the performance guard's warmup frames. Keep all measured frames
    // for this attempt, rather than comparing only the final rolling window.
    if (++this.frames <= PERFORMANCE_LIMITS.warmupFrames) return;
    this.times.push(ms);
    if (found) this.found++;
  }
  snapshot() {
    const times = [...this.times].sort((a, b) => a - b), samples = times.length;
    return { samples, meanMs: samples ? times.reduce((a, b) => a + b, 0) / samples : null,
      p95Ms: samples ? times[Math.ceil(samples * .95) - 1] : null,
      detectedFrames: this.found, detectionRate: samples ? this.found / samples : null };
  }
}
