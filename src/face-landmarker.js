import { ModelWorker } from './model-worker.js';

export class FaceDetector extends ModelWorker {
  async estimateFaces(source) {
    const bitmap = await createImageBitmap(source);
    if (!this.worker) { bitmap.close(); throw new Error('Обработка остановлена'); }
    return this.request('detect', { bitmap, timestamp: performance.now() }, [bitmap]);
  }
}

export async function createFaceDetector({ signal } = {}) {
  const detector = new FaceDetector(new Worker(new URL('./face.worker.js', import.meta.url), { type: 'module' }));
  return detector.initialize(signal);
}
