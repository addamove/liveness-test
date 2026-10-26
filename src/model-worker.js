// One request in flight per detector. Termination also cancels native/WASM work.
export class ModelWorker {
  constructor(worker) {
    this.worker = worker;
    this.pending = new Map();
    this.sequence = 0;
    worker.onmessage = ({ data }) => {
      const request = this.pending.get(data.id);
      if (!request) return;
      this.pending.delete(data.id);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve(data.result);
    };
    worker.onerror = event => this.dispose(new Error(event.message || 'Ошибка обработки в Web Worker'));
  }
  request(type, payload = {}, transfer = []) {
    if (!this.worker) return Promise.reject(new Error('Обработка остановлена'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.worker.postMessage({ id, type, ...payload }, transfer); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }
  async initialize(signal, options = {}) {
    const abort = () => this.dispose(Object.assign(new Error('Загрузка отменена'), { name: 'AbortError' }));
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (signal?.aborted) abort();
      this.backend = await this.request('init', options);
      return this;
    } catch (error) { this.dispose(); throw error; }
    finally { signal?.removeEventListener('abort', abort); }
  }
  dispose(error = new Error('Обработка остановлена')) {
    this.worker?.terminate(); this.worker = null;
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}
