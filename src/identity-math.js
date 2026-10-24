// Same five-point convention and least-squares alignment as face-compare-lab.
export const TEMPLATE = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];
export function similarityTransform(source, target = TEMPLATE) {
  if (source.length !== 5 || target.length !== 5 || [...source, ...target].some(p => p.length !== 2 || !p.every(Number.isFinite))) throw new Error('人脸关键点无效');
  const centre = points => points.reduce((v, p) => [v[0] + p[0] / 5, v[1] + p[1] / 5], [0, 0]);
  const [sx, sy] = centre(source), [tx, ty] = centre(target);
  let den = 0, re = 0, im = 0;
  for (let i = 0; i < 5; i++) {
    const x = source[i][0] - sx, y = source[i][1] - sy, u = target[i][0] - tx, v = target[i][1] - ty;
    den += x * x + y * y; re += x * u + y * v; im += x * v - y * u;
  }
  if (den < 1e-8) throw new Error('人脸对齐关键点重合');
  const a = re / den, b = im / den;
  if (a * a + b * b < 1e-10) throw new Error('无法完成人脸对齐');
  return [a, b, -b, a, tx - a * sx + b * sy, ty - b * sx - a * sy];
}
export function fivePoints(landmarks, width, height) {
  const point = id => { const p = landmarks.find(p => p.index === id); if (!p) throw new Error('人脸五点不足'); return [p.x * width, p.y * height]; };
  const eye = (a, b) => { const x = point(a), y = point(b); return [(x[0] + y[0]) / 2, (x[1] + y[1]) / 2]; };
  const points = [eye(33, 133), eye(362, 263), point(1), point(61), point(291)];
  if (points.flat().some(v => !Number.isFinite(v)) || points.some(([x, y]) => x < 0 || y < 0 || x >= width || y >= height)) throw new Error('人脸五点不完整');
  if (Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]) < 20) throw new Error('人脸有效分辨率不足');
  return points;
}
export function identityTensor(rgba) {
  const n = rgba.length / 4, data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) data[c * n + i] = (rgba[i * 4 + c] - 127.5) / 127.5;
  return data;
}
export function normalize(vector) {
  if (!vector?.length || Array.from(vector).some(v => !Number.isFinite(v))) throw new Error('人脸特征无效');
  const norm = Math.hypot(...vector);
  if (norm < 1e-8) throw new Error('人脸特征无效');
  return Float32Array.from(vector, v => v / norm);
}
export function cosine(a, b) {
  if (a.length !== b.length) throw new Error('人脸特征维度不一致');
  const x = normalize(a), y = normalize(b);
  return Math.max(-1, Math.min(1, x.reduce((sum, v, i) => sum + v * y[i], 0)));
}
