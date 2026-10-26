import { orderQuad, polygonArea, distance } from './geometry.js';

let cvPromise;
export function loadOpenCV() {
  if (!cvPromise) cvPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => reject(new Error('OpenCV загружается слишком долго. Обновите страницу.')), 60000);
    script.src = '/models/opencv.js';
    script.onerror = () => { clearTimeout(timer); reject(new Error('Не удалось загрузить OpenCV. Проверьте соединение с компьютером.')); };
    script.onload = () => {
      try {
        const cv = window.cv;
        // OpenCV 4 is a self-resolving Emscripten thenable; awaiting it directly hangs.
        const ready = () => { clearTimeout(timer); resolve({ cv }); };
        if (cv?.Mat) ready();
        else if (cv) cv.onRuntimeInitialized = ready;
        else throw new Error('OpenCV не удалось запустить в этом браузере.');
      } catch (error) { clearTimeout(timer); reject(error); }
    };
    document.head.append(script);
  }).catch(error => { cvPromise = null; throw error; });
  return cvPromise;
}

export async function loadFaceDetector(options) {
  const { createFaceDetector } = await import('./face-landmarker.js');
  return createFaceDetector(options);
}

// MediaPipe canonical mesh, converted from +Y up/+Z forward to camera coordinates.
// https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj
export const POSE_INDICES = [1, 152, 33, 263, 61, 291];
export const POSE_POINTS = [0, 1.126865, -7.475604, 0, 9.403378, -4.264492, -4.445859, -2.663991, -3.173422, 4.445859, -2.663991, -3.173422, -2.456206, 4.342621, -4.283884, 2.456206, 4.342621, -4.283884];

export function estimatePose(cv, keypoints, width, height) {
  const allocated = [];
  const own = m => { allocated.push(m); return m; };
  try {
    const model = own(cv.matFromArray(6, 3, cv.CV_64F, POSE_POINTS));
    const image = own(cv.matFromArray(6, 2, cv.CV_64F, POSE_INDICES.flatMap(i => [keypoints[i].x, keypoints[i].y])));
    const focal = Math.max(width, height);
    const camera = own(cv.matFromArray(3, 3, cv.CV_64F, [focal, 0, width / 2, 0, focal, height / 2, 0, 0, 1]));
    const distortion = own(cv.Mat.zeros(4, 1, cv.CV_64F));
    const rotation = own(new cv.Mat()), translation = own(new cv.Mat()), matrix = own(new cv.Mat());
    if (!cv.solvePnP(model, image, camera, distortion, rotation, translation, false, cv.SOLVEPNP_ITERATIVE) || translation.data64F[2] <= 0) return null;
    cv.Rodrigues(rotation, matrix);
    const r = matrix.data64F, deg = 180 / Math.PI;
    const pitch = Math.atan2(r[7], r[8]) * deg;
    const yaw = Math.atan2(-r[6], Math.hypot(r[0], r[3])) * deg;
    const roll = Math.atan2(r[3], r[0]) * deg;
    return [pitch, yaw, roll].every(Number.isFinite) ? { pitch, yaw, roll } : null;
  } finally { allocated.reverse().forEach(m => m.delete()); }
}

// Rectify the candidate before looking for a continuous crease between two pages.
// This is a geometric/contrast heuristic, not passport classification.
export function findSpread(cv, gray, points, orientation = 'landscape') {
  const allocated = [], own = m => { allocated.push(m); return m; };
  try {
    const width = orientation === 'portrait' ? 128 : 180, height = orientation === 'portrait' ? 180 : 128;
    const src = own(cv.matFromArray(4, 1, cv.CV_32FC2, points.flatMap(p => [p.x, p.y])));
    const dst = own(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width - 1, 0, width - 1, height - 1, 0, height - 1]));
    const transform = own(cv.getPerspectiveTransform(src, dst)), flat = own(new cv.Mat());
    cv.warpPerspective(gray, flat, transform, new cv.Size(width, height), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    const vertical = orientation !== 'portrait', across = vertical ? width : height, along = vertical ? height : width;
    const pixel = (x, y) => flat.data[vertical ? y * width + x : x * width + y];
    let best = { visible: false, score: 0, contrast: 0 };
    for (let start = .42; start <= .581; start += .04) for (let end = .42; end <= .581; end += .04) {
      let supported = 0, count = 0, totalContrast = 0;
      const bands = Array(6).fill(0), samples = Array(6).fill(0);
      for (let y = Math.round(along * .12); y < along * .88; y += 2) {
        const x = Math.round(across * (start + (end - start) * y / along));
        const center = (pixel(x - 1, y) + pixel(x, y) + pixel(x + 1, y)) / 3;
        const side = (pixel(x - 7, y) + pixel(x + 7, y) + pixel(x - 10, y) + pixel(x + 10, y)) / 4;
        const contrast = side - center, band = Math.min(5, Math.floor((y / along - .12) / .76 * 6));
        samples[band]++; count++; totalContrast += Math.max(0, contrast);
        if (contrast > 7) { supported++; bands[band]++; }
      }
      const score = supported / count, contrast = totalContrast / count;
      const visible = score >= .58 && contrast >= 9 && bands.filter((n, i) => n / samples[i] >= .4).length >= 5;
      if (score > best.score) best = { visible, score, contrast, start, end };
    }
    return best;
  } finally { allocated.reverse().forEach(m => m.delete()); }
}

// OpenCV supplies the shared crease check, never substitutes missing ML corners.
export function observeDocumentCorners(cv, imageData, points, orientation = 'landscape') {
  if (!points || points.length !== 4) return null;
  const src = cv.matFromImageData(imageData), gray = new cv.Mat();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const cornerVisible = points.map(p => p.x > 3 && p.y > 3 && p.x < imageData.width - 4 && p.y < imageData.height - 4);
    const rectangularity = Math.max(...points.map((p, j) => {
      const a = points[(j + 3) % 4], b = points[(j + 1) % 4];
      return Math.abs(((a.x - p.x) * (b.x - p.x) + (a.y - p.y) * (b.y - p.y)) / (distance(a, p) * distance(b, p)));
    }));
    return { points, cornerVisible, fullyVisible: cornerVisible.every(Boolean), rectangularity, spread: findSpread(cv, gray, points, orientation) };
  } finally { gray.delete(); src.delete(); }
}

export function findDocument(cv, imageData, guide, orientation = 'landscape') {
  const allocated = [], own = m => { allocated.push(m); return m; };
  try {
    const src = own(cv.matFromImageData(imageData)), gray = own(new cv.Mat()), blurred = own(new cv.Mat()), edges = own(new cv.Mat());
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 35, 100);
    const kernel = own(cv.Mat.ones(3, 3, cv.CV_8U));
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
    // The threshold pass also yields a partial outline when a bright page touches
    // the video edge. Its clipped corners remain explicitly untrusted.
    const threshold = own(new cv.Mat());
    cv.threshold(blurred, threshold, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    const pageJoin = own(cv.Mat.ones(11, 11, cv.CV_8U));
    const padded = own(new cv.Mat());
    cv.copyMakeBorder(threshold, padded, 12, 12, 12, 12, cv.BORDER_CONSTANT, new cv.Scalar(0));
    cv.morphologyEx(padded, padded, cv.MORPH_CLOSE, pageJoin);
    const region = own(padded.roi(new cv.Rect(12, 12, src.cols, src.rows)));
    region.copyTo(threshold);
    const candidates = [];
    for (const mask of [edges, threshold]) {
      const contours = own(new cv.MatVector()), hierarchy = own(new cv.Mat());
      cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i), hull = new cv.Mat(), approx = new cv.Mat();
        try {
          const area = cv.contourArea(contour);
          if (area < guide.width * guide.height * .055 || area > src.cols * src.rows * .94) continue;
          cv.convexHull(contour, hull);
          if (area / cv.contourArea(hull) < .78) continue;
          for (const epsilon of [.018, .03, .045]) {
            cv.approxPolyDP(hull, approx, cv.arcLength(hull, true) * epsilon, true);
            if (approx.rows === 4) break;
          }
          if (approx.rows !== 4 || !cv.isContourConvex(approx)) continue;
          const points = orderQuad(Array.from({ length: 4 }, (_, j) => ({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] })));
          const lengths = points.map((p, j) => distance(p, points[(j + 1) % 4]));
          const ratio = (lengths[0] + lengths[2]) / (lengths[1] + lengths[3]);
          if (ratio < .35 || ratio > 2.8 || Math.min(...lengths) < 22) continue;
          const rectangularity = Math.max(...points.map((p, j) => {
            const a = points[(j + 3) % 4], b = points[(j + 1) % 4];
            return Math.abs(((a.x - p.x) * (b.x - p.x) + (a.y - p.y) * (b.y - p.y)) / (distance(a, p) * distance(b, p)));
          }));
          if (rectangularity > .65) continue;
          const cx = points.reduce((s, p) => s + p.x, 0) / 4, cy = points.reduce((s, p) => s + p.y, 0) / 4;
          const offset = Math.hypot((cx - guide.x - guide.width / 2) / guide.width, (cy - guide.y - guide.height / 2) / guide.height);
          if (offset > 1) continue;
          const cornerVisible = points.map(p => p.x > 3 && p.y > 3 && p.x < src.cols - 4 && p.y < src.rows - 4);
          candidates.push({ points, rectangularity, cornerVisible, fullyVisible: cornerVisible.every(Boolean), score: polygonArea(points) * (1 - .4 * Math.min(1, offset)) });
        } finally { contour.delete(); hull.delete(); approx.delete(); }
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (!best) return null;
    best.spread = findSpread(cv, gray, best.points, orientation);
    return best;
  } finally { allocated.reverse().forEach(m => m.delete()); }
}
