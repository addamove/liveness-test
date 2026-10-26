# Third-party components

- MediaPipe Tasks Vision 1.1.1, Google: Apache-2.0. [Project](https://github.com/google-ai-edge/mediapipe). Face Landmarker model: [official float16 revision 1](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task).
- DocAligner, DocsaidLab: Apache-2.0. [Project](https://github.com/DocsaidLab/DocAligner), [license text](./licenses/DocAligner-Apache-2.0.txt). We use the published LCNet100 heatmap ONNX weights. Our browser adapter follows its BGR CHW preprocessing and decodes the largest corner regions at heatmap resolution; it does not copy the complete Python postprocessing pipeline. Models remain separate downloads, with pinned checksums in `scripts/copy-models.mjs`.
- ONNX Runtime Web 1.30.0, Microsoft: MIT. [Project and license](https://github.com/microsoft/onnxruntime).
- OpenCV.js 4.12 via `@techstark/opencv-js`: [OpenCV Apache-2.0](https://github.com/opencv/opencv/blob/4.12.0/LICENSE), [npm distribution](https://github.com/TechStark/opencv-js).
- `tests/fixtures/portrait.jpg` is the public test image from [TensorFlow.js models](https://github.com/tensorflow/tfjs-models/blob/master/face-landmarks-detection/test_data/portrait.jpg). It is only used in development tests.

Model binaries, generated WASM assets, personal photographs, and local TLS keys are not committed. `npm install` downloads/copies model assets locally; the running app performs no remote inference or image uploads.
