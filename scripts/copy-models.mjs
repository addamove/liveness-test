import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = path.join(root, 'public/models');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function download(relative, url, checksum) {
  const target = path.join(assets, relative);
  try { if (hash(await readFile(target)) === checksum) return; } catch { /* First install. */ }
  console.log(`Загрузка ${relative}…`);
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Не удалось загрузить ${relative}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== checksum) throw new Error(`Контрольная сумма ${relative} не совпала. Файл не сохранён.`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}
await mkdir(assets, { recursive: true });
await download('face_landmarker/face_landmarker.task',
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff');
await download('docaligner/lcnet100.onnx',
  'https://drive.usercontent.google.com/download?id=1IlbLPkCv-TdaBLOPh_4J97P1_KHYYJ7a&export=download&confirm=t',
  'f4117b786e3a18470f3865c93f3c2bd69d9b998edd60f385574a5c665e79594e');
for (const folder of ['face_landmarker/wasm', 'ort']) await mkdir(path.join(assets, folder), { recursive: true });
for (const extension of ['js', 'wasm']) await copyFile(
  path.join(root, `node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.${extension}`),
  path.join(assets, `face_landmarker/wasm/vision_wasm_module_internal.${extension}`));
for (const extension of ['mjs', 'wasm']) for (const suffix of ['', '.asyncify']) await copyFile(
  path.join(root, `node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded${suffix}.${extension}`),
  path.join(assets, `ort/ort-wasm-simd-threaded${suffix}.${extension}`));
await copyFile(path.join(root, 'node_modules/@techstark/opencv-js/dist/opencv.js'), path.join(assets, 'opencv.js'));
// Remove only the generated assets from the retired dependency.
await rm(path.join(assets, 'face_mesh'), { recursive: true, force: true });
for (const extension of ['mjs', 'wasm']) await rm(path.join(assets, `ort/ort-wasm-simd-threaded.jsep.${extension}`), { force: true });
console.log('Face Landmarker, DocAligner, ONNX Runtime и OpenCV готовы на локальном сервере.');
