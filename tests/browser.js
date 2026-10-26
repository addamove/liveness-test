import { loadDocumentDetector } from '../src/document-model.js';
import { loadOpenCV, loadFaceDetector, estimatePose, findDocument, observeDocumentCorners } from '../src/vision.js';
import { guideFor, evaluateFace, evaluateDocument } from '../src/geometry.js';
const output = document.querySelector('#output');
const log = value => { output.textContent += `${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`; };
document.querySelector('#run').onclick = async () => {
  output.textContent = ''; document.querySelector('#run').disabled = true;
  let detector, documentModel;
  try {
    log('Загрузка OpenCV и MediaPipe…');
    const [{ cv }, model] = await Promise.all([loadOpenCV(), loadFaceDetector()]); detector = model;
    log('PASS: оба движка загружены.');
    const img = new Image(); img.src = '/tests/fixtures/portrait.jpg'; await img.decode();
    const original = await detector.estimateFaces(img, { staticImageMode: true });
    if (original.length !== 1 || original[0].keypoints.length !== 478) throw new Error('Ожидалось одно лицо с 478 точками');
    log('PASS: настоящая модель нашла 478 точек на тестовом портрете.');
    const canvas = document.querySelector('#canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
    const guide = guideFor(canvas.width, canvas.height, 'face');
    const box = original[0].box, scale = guide.height * .78 / box.height;
    ctx.fillStyle = '#283528'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, canvas.width / 2 - (box.xMin + box.width / 2) * scale, guide.y + guide.height / 2 - (box.yMin + box.height / 2) * scale, img.width * scale, img.height * scale);
    const faces = await detector.estimateFaces(canvas, { staticImageMode: true });
    const pose = estimatePose(cv, faces[0].keypoints, canvas.width, canvas.height);
    const result = evaluateFace(faces, guide, pose);
    log({ faceChecks: result.checks, metrics: result.metrics });
    if (!result.valid) throw new Error('Фронтальный тестовый портрет не прошёл условия');
    const doc = document.createElement('canvas'); doc.width = 424; doc.height = 690;
    const dc = doc.getContext('2d'), dg = guideFor(doc.width, doc.height, 'document');
    dc.fillStyle = '#222'; dc.fillRect(0, 0, doc.width, doc.height); dc.fillStyle = '#eee'; dc.fillRect(dg.x + 15, dg.y + 15, dg.width - 30, dg.height - 30);
    dc.fillStyle = '#888'; dc.fillRect(doc.width / 2 - 3, dg.y + 15, 6, dg.height - 30);
    const points = findDocument(cv, dc.getImageData(0, 0, doc.width, doc.height), dg);
    if (!evaluateDocument(points, dg, points.points).valid) throw new Error('Синтетический документ не прошёл условия');
    log('PASS: OpenCV нашёл документ, все углы внутри рамки.');
    documentModel = await loadDocumentDetector({ executionProviders: [new URLSearchParams(location.search).has('webgpu') ? 'webgpu' : 'wasm'] });
    log(`PASS: DocAligner LCNet100 загружен (${documentModel.backend}).`);
    const imageData = dc.getImageData(0, 0, doc.width, doc.height);
    const corners = await documentModel.estimateDocument(imageData);
    log({ docAlignerCorners: corners });
    const observation = observeDocumentCorners(cv, imageData, corners);
    if (!observation) throw new Error('DocAligner не нашёл синтетический разворот');
    const assessment = evaluateDocument(observation, dg, corners);
    log({ docAlignerChecks: assessment.checks });
    if (!assessment.valid) throw new Error('DocAligner не прошёл общие условия');
    dc.fillStyle = '#222'; dc.fillRect(0, 0, doc.width, doc.height);
    if (await documentModel.estimateDocument(dc.getImageData(0, 0, doc.width, doc.height))) throw new Error('DocAligner нашёл документ на пустом фоне');
    log('MODEL TESTS PASSED');
  } catch (error) { log(`FAIL: ${error.stack || error}`); }
  finally { detector?.dispose(); documentModel?.dispose(); document.querySelector('#run').disabled = false; }
};
