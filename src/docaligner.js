import { orderQuad, polygonArea, distance } from './geometry.js';

// Reference input: OpenCV BGR, float32 NCHW / 255, squashed to 256 x 256.
// https://github.com/DocsaidLab/DocAligner/blob/main/docaligner/heatmap_reg/infer.py
export function documentTensor(rgba) {
  const plane = rgba.length / 4, data = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) {
    data[i] = rgba[i * 4 + 2] / 255;
    data[i + plane] = rgba[i * 4 + 1] / 255;
    data[i + plane * 2] = rgba[i * 4] / 255;
  }
  return data;
}

// Largest connected region in each corner heatmap. Low-confidence or malformed
// outputs are missing detections; no geometry is invented for missing corners.
export function decodeDocumentHeatmap(data, dims, width, height, threshold = .3) {
  const [batch, channels, h, w] = dims;
  if (batch !== 1 || channels !== 4 || !h || !w || data.length !== 4 * h * w) return null;
  const plane = h * w, visited = new Uint8Array(plane), queue = new Int32Array(plane), points = [];
  for (let c = 0; c < 4; c++) {
    visited.fill(0);
    let best = null;
    const offset = c * plane;
    for (let i = 0; i < plane; i++) {
      if (visited[i] || !(data[offset + i] >= threshold)) continue;
      let head = 0, tail = 1, sumX = 0, sumY = 0;
      queue[0] = i; visited[i] = 1;
      while (head < tail) {
        const p = queue[head++], x = p % w, y = Math.floor(p / w);
        sumX += x; sumY += y;
        for (const n of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
          if (n >= 0 && !visited[n] && data[offset + n] >= threshold) { visited[n] = 1; queue[tail++] = n; }
        }
      }
      if (!best || tail > best.area) best = { area: tail, x: (sumX / tail + .5) * width / w, y: (sumY / tail + .5) * height / h };
    }
    if (!best) return null;
    points.push({ x: best.x, y: best.y });
  }
  const quad = orderQuad(points), lengths = quad.map((p, i) => distance(p, quad[(i + 1) % 4]));
  const cross = quad.map((p, i) => {
    const b = quad[(i + 1) % 4], c = quad[(i + 2) % 4];
    return (b.x - p.x) * (c.y - b.y) - (b.y - p.y) * (c.x - b.x);
  });
  if (!cross.every(n => n > 0) || Math.min(...lengths) < 22 || polygonArea(quad) < width * height * .015) return null;
  return quad;
}
