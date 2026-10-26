export function normalizeFaces(result, width, height) {
  return result.faceLandmarks.map(landmarks => {
    const keypoints = landmarks.map(p => ({ x: p.x * width, y: p.y * height, z: p.z * width }));
    const xs = keypoints.map(p => p.x), ys = keypoints.map(p => p.y);
    const xMin = Math.min(...xs), yMin = Math.min(...ys), xMax = Math.max(...xs), yMax = Math.max(...ys);
    return { keypoints, box: { xMin, yMin, xMax, yMax, width: xMax - xMin, height: yMax - yMin } };
  });
}
