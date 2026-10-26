import { ModelWorker } from './model-worker.js';
import { faceInputSize } from './face-points.js';

export class FaceDetector extends ModelWorker {
  async estimateFaces(source) {
    const width = source.videoWidth || source.naturalWidth || source.width;
    const height = source.videoHeight || source.naturalHeight || source.height;
    const size = faceInputSize(width, height);
    this.inputCanvas ??= document.createElement('canvas');
    if (this.inputCanvas.width !== size.width || this.inputCanvas.height !== size.height) {
      this.inputCanvas.width = size.width; this.inputCanvas.height = size.height;
    }
    this.inputCanvas.getContext('2d').drawImage(source, 0, 0, size.width, size.height);
    const bitmap = await createImageBitmap(this.inputCanvas);
    if (!this.worker) { bitmap.close(); throw new Error('Обработка остановлена'); }
    // Landmarks are returned in the original photo's coordinates, not the smaller input's.
    return this.request('detect', { bitmap, width, height, timestamp: performance.now() }, [bitmap]);
  }
}

export async function createFaceDetector({ signal } = {}) {
  const detector = new FaceDetector(new Worker(new URL('./face.worker.js', import.meta.url), { type: 'module' }));
  return detector.initialize(signal);
}
