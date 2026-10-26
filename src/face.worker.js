import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { normalizeFaces } from './face-points.js';

let model;
self.onmessage = async ({ data: { id, type, bitmap, timestamp } }) => {
  try {
    let result;
    if (type === 'init') {
      const files = await FilesetResolver.forVisionTasks('/models/face_landmarker/wasm', true);
      let lastError;
      for (const delegate of ['GPU', 'CPU']) {
        try {
          model = await FaceLandmarker.createFromOptions(files, {
            baseOptions: { modelAssetPath: '/models/face_landmarker/face_landmarker.task', delegate },
            runningMode: 'VIDEO', numFaces: 2,
            minFaceDetectionConfidence: .5, minFacePresenceConfidence: .5, minTrackingConfidence: .5,
            outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false,
          });
          result = delegate; break;
        } catch (error) { lastError = error; }
      }
      if (!model) throw lastError;
    } else {
      result = normalizeFaces(model.detectForVideo(bitmap, timestamp), bitmap.width, bitmap.height);
    }
    self.postMessage({ id, result });
  } catch (error) { self.postMessage({ id, error: error.message || String(error) }); }
  finally { bitmap?.close(); }
};
