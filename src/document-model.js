import { ModelWorker } from './model-worker.js';

export class DocumentDetector extends ModelWorker {
  estimateDocument(imageData) { return this.request('detect', { imageData }); }
}
export async function loadDocumentDetector({ signal, executionProviders } = {}) {
  const detector = new DocumentDetector(new Worker(new URL('./document.worker.js', import.meta.url), { type: 'module' }));
  return detector.initialize(signal, { executionProviders });
}
