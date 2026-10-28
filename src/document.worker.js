import { documentTensor, decodeDocumentHeatmap } from './docaligner.js';

let ort, model, original, context;
const resized = new OffscreenCanvas(256, 256), resizedContext = resized.getContext('2d', { willReadFrequently: true });
self.onmessage = async ({ data: { id, type, imageData, executionProviders } }) => {
  const startedAt = performance.now();
  try {
    let result;
    if (type === 'init') {
      const providers = executionProviders || ['wasm'];
      // The CPU path loads the pure WASM runtime, not the WebGPU/Asyncify build.
      ort = await (providers.includes('webgpu') ? import('onnxruntime-web/webgpu') : import('onnxruntime-web/wasm'));
      ort.env.wasm.wasmPaths = new URL(`${import.meta.env.BASE_URL}models/ort/`, self.location.origin).href;
      ort.env.wasm.numThreads = 1;
      const response = await fetch(`${import.meta.env.BASE_URL}models/docaligner/lcnet100.onnx`);
      if (!response.ok) throw new Error('Не удалось загрузить DocAligner');
      const bytes = await response.arrayBuffer();
      let lastError;
      for (const backend of providers) {
        try {
          model = await ort.InferenceSession.create(bytes, { executionProviders: [backend], graphOptimizationLevel: 'all' });
          result = backend; break;
        } catch (error) { lastError = error; }
      }
      if (!model) throw lastError;
    } else {
      if (!original || original.width !== imageData.width || original.height !== imageData.height) {
        original = new OffscreenCanvas(imageData.width, imageData.height);
        context = original.getContext('2d');
      }
      context.putImageData(imageData, 0, 0);
      resizedContext.drawImage(original, 0, 0, 256, 256);
      const tensor = new ort.Tensor('float32', documentTensor(resizedContext.getImageData(0, 0, 256, 256).data), [1, 3, 256, 256]);
      let outputs;
      try {
        outputs = await model.run({ [model.inputNames[0]]: tensor });
        const heatmap = outputs.heatmap;
        if (!heatmap) throw new Error('DocAligner не вернул heatmap');
        result = decodeDocumentHeatmap(heatmap.data, heatmap.dims, imageData.width, imageData.height);
      } finally { tensor.dispose(); Object.values(outputs || {}).forEach(t => t.dispose()); }
    }
    self.postMessage({ id, result, processingMs: performance.now() - startedAt });
  } catch (error) { self.postMessage({ id, error: error.message || String(error) }); }
};
