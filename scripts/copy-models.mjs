import { mkdir, readdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.join(root, 'public/models/face_mesh');
await mkdir(target, { recursive: true });
const source = path.join(root, 'node_modules/@mediapipe/face_mesh');
for (const name of await readdir(source)) {
  if (/\.(js|wasm|data|binarypb)$/.test(name)) await copyFile(path.join(source, name), path.join(target, name));
}
await copyFile(path.join(root, 'node_modules/@techstark/opencv-js/dist/opencv.js'), path.join(root, 'public/models/opencv.js'));
console.log('MediaPipe и OpenCV скопированы: модели загружаются с локального сервера.');
