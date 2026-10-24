import { FaceIdentityGuard } from './identity-guard.js';

export const ACTIONS = Object.freeze([
  { id: 'nod', label: '请点头', guide: '缓慢低头，然后回到正面', symbol: '↕' },
  { id: 'left', label: '向左转头', guide: '向你自己的左侧转头，然后回正', symbol: '←' },
  { id: 'right', label: '向右转头', guide: '向你自己的右侧转头，然后回正', symbol: '→' },
  { id: 'blink', label: '请眨眼', guide: '缓慢闭上双眼，稍停后再睁开', symbol: '◡' },
  { id: 'mouth', label: '请张嘴', guide: '张开嘴巴，稍作停留后闭合', symbol: '○' },
]);

export function randomActions(randomIndex = (n) => {
  const buffer = new Uint32Array(1);
  const limit = 2 ** 32 - (2 ** 32 % n);
  do { crypto.getRandomValues(buffer); } while (buffer[0] >= limit);
  return buffer[0] % n;
}) {
  const pool = [...ACTIONS];
  const first = pool.splice(randomIndex(pool.length), 1)[0];
  return [first, pool.splice(randomIndex(pool.length), 1)[0]];
}

export const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const frontal = (m) => Math.abs(m.yaw) < 12 && Math.abs(m.pitch) < 14 && Math.abs(m.roll) < 10;
export const neutral = (m) => frontal(m) && m.blink < 0.3 && m.jaw < 0.22;

// MediaPipe Matrix.data is column-major. Positive yaw = subject turns left.
export function poseFromMatrix(m) {
  if (!m || m.length !== 16 || !m.every(Number.isFinite)) throw new Error('人脸姿态矩阵无效');
  const scale = Math.hypot(m[0], m[1], m[2]);
  if (scale < 0.01) throw new Error('人脸姿态矩阵无效');
  const deg = 180 / Math.PI;
  return {
    yaw: Math.atan2(-m[2], Math.hypot(m[0], m[1])) * deg,
    pitch: Math.atan2(m[6], m[10]) * deg,
    roll: Math.atan2(m[1], m[0]) * deg,
  };
}

// Match upstream CropImage: expand, shift inside the image, inclusive endpoints.
export function scaledCrop(box, width, height, factor) {
  const scale = Math.min((height - 1) / box.h, (width - 1) / box.w, factor);
  const w = box.w * scale, h = box.h * scale;
  let x = box.x + box.w / 2 - w / 2, y = box.y + box.h / 2 - h / 2;
  x = clamp(x, 0, width - 1 - w);
  y = clamp(y, 0, height - 1 - h);
  const right = Math.trunc(x + w), bottom = Math.trunc(y + h);
  x = Math.trunc(x); y = Math.trunc(y);
  return { x, y, w: right - x + 1, h: bottom - y + 1 };
}

export function bgrTensor(rgba) {
  const n = rgba.length / 4;
  const data = new Float32Array(n * 3);
  // Upstream functional.to_tensor(ndarray) intentionally does NOT divide by 255.
  for (let i = 0; i < n; i++) {
    data[i] = rgba[i * 4 + 2];
    data[n + i] = rgba[i * 4 + 1];
    data[n * 2 + i] = rgba[i * 4];
  }
  return data;
}

export function liveScore(logits) {
  if (logits.length !== 3 || !Array.from(logits).every(Number.isFinite)) throw new Error('RGB 模型输出无效');
  const max = Math.max(...logits);
  const exp = Array.from(logits, (v) => Math.exp(v - max));
  return exp[1] / exp.reduce((a, b) => a + b, 0);
}

export function imageQuality(rgba, size) {
  const gray = new Float32Array(size * size);
  let total = 0, dark = 0, bright = 0, sum = 0, squares = 0, count = 0;
  for (let i = 0; i < gray.length; i++) {
    const y = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    gray[i] = y; total += y; dark += y < 25; bright += y > 238;
  }
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    const i = y * size + x;
    const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - size] - gray[i + size];
    sum += lap; squares += lap * lap; count++;
  }
  return { brightness: total / gray.length, darkRatio: dark / gray.length, brightRatio: bright / gray.length, sharpness: squares / count - (sum / count) ** 2 };
}

export function qualityIssue(m, settings) {
  if (m.count !== 1) return m.count ? '请保持只有一人入镜' : '请将面部移入取景框';
  if (!Number.isFinite(m.yaw + m.pitch + m.roll + m.blink + m.jaw)) return '人脸数据不足，请重新入框';
  if (m.box.w < 180 || m.box.h < 180 || m.ratio < 0.22) return '请靠近一点，让面部更清晰';
  if (m.ratio > 0.68) return '请稍微远离镜头';
  if (m.edge) return '请将完整面部放在画面中间';
  if (m.brightness < 55 || m.darkRatio > 0.4) return '光线较暗，请面向光源';
  if (m.brightness > 215 || m.brightRatio > 0.3) return '光线过强，请避开直射光';
  if (m.sharpness < settings.sharpness) return '画面模糊，请保持手机稳定';
  return '';
}

export class LivenessSession {
  constructor(actions, settings = {}) {
    this.settings = { rgbThreshold: 0.8, sharpness: 35, actionTimeout: 14000, totalTimeout: 65000, ...settings };
    this.identity = this.settings.identityEnabled ? new FaceIdentityGuard({ threshold: this.settings.identityThreshold ?? 0.45 }) : null;
    if (actions.length !== 2 || new Set(actions.map((a) => a.id)).size !== 2 || actions.some((a) => !ACTIONS.some((b) => b.id === a.id))) throw new Error('需要两个不重复的有效动作');
    this.actions = actions;
    this.phase = 'prepare'; this.actionIndex = 0; this.subphase = 'neutral';
    this.started = null; this.phaseStarted = null; this.last = -1;
    this.holdSince = null; this.holdFrames = 0; this.missingSince = null;
    this.baselineFrames = []; this.baseline = null;
    this.pre = []; this.post = []; this.events = []; this.completed = [];
    this.captureStarted = null; this.captureReady = false; this.actionReadyAt = null;
  }
  resetHold() { this.holdSince = null; this.holdFrames = 0; }
  hold(condition, t, duration, frames = 2) {
    if (!condition) { this.resetHold(); return false; }
    if (this.holdSince === null) this.holdSince = t;
    this.holdFrames++;
    return t - this.holdSince >= duration && this.holdFrames >= frames;
  }
  fail(reason, t) { this.phase = 'failed'; this.reason = reason; this.events.push({ type: 'failed', reason, t }); }
  padAccepts(samples) {
    return samples.length >= 6 && median(samples.map((x) => x.score)) >= this.settings.rgbThreshold && samples.filter((x) => x.score >= this.settings.rgbThreshold).length / samples.length >= 0.75;
  }
  update(m, t) {
    if (['failed', 'passed'].includes(this.phase)) return this.snapshot();
    if (!Number.isFinite(t) || t <= this.last) return this.snapshot();
    if (this.started === null) { this.started = t; this.phaseStarted = t; }
    if (this.last >= 0 && t - this.last > 1400) {
      this.fail('视频中断，请重新检测', t); return this.snapshot();
    }
    this.last = t;
    if (t - this.started > this.settings.totalTimeout) this.fail('检测超时，请调整光线后重试', t);
    if (this.phase === 'failed') return this.snapshot();
    if (m.count > 1) { this.fail('检测到多人入镜，请重新开始', t); return this.snapshot(); }
    if (m.count !== 1) {
      this.identity?.unavailable(t);
      if (this.identity?.status === 'failed') { this.fail(this.identity.hint, t); return this.snapshot(); }
      this.missingSince ??= t; this.resetHold();
      if (this.phase === 'prepare') { this.baselineFrames = []; this.pre = []; }
      if (t - this.missingSince > 900 && this.phase !== 'prepare') this.fail('面部离开画面，请重新检测', t);
      this.hint = '请将面部移入取景框'; return this.snapshot();
    }
    this.missingSince = null;
    const issue = qualityIssue(m, this.settings);
    if (this.identity) {
      this.identity.update(m, t, { valid: !issue && Math.abs(m.yaw) < 42 && Math.abs(m.pitch) < 35 && Math.abs(m.roll) < 18,
        referenceAllowed: this.phase === 'prepare' && neutral(m) && !issue && m.rgb?.t === t && m.rgb.score >= this.settings.rgbThreshold });
      m.identity = this.identity.frameSummary(t);
      if (this.identity.status === 'failed') { this.fail(this.identity.hint, t); return this.snapshot(); }
      if (this.phase !== 'prepare' && !this.identity.ready) { this.resetHold(); this.captureReady = false; this.hint = this.identity.hint; return this.snapshot(); }
    }
    this.hint = issue;
    if (issue) { this.resetHold(); if (this.phase === 'prepare') this.baselineFrames = []; return this.snapshot(); }
    const freshRGB = m.rgb && m.rgb.t === t && Number.isFinite(m.rgb.score);
    if (this.phase === 'prepare') {
      if (!neutral(m)) { this.hint = '请正视镜头，睁眼并自然闭嘴'; this.baselineFrames = []; this.resetHold(); return this.snapshot(); }
      this.baselineFrames.push({ yaw: m.yaw, pitch: m.pitch, t });
      this.baselineFrames = this.baselineFrames.filter((v) => t - v.t < 1600);
      if (freshRGB) this.pre.push({ score: m.rgb.score, t });
      this.pre = this.pre.filter((v) => t - v.t < 6000);
      if (this.pre.length >= 8 && !this.padAccepts(this.pre)) { this.fail('RGB 防伪未达阈值，请使用真人正脸并调整光线重试', t); return this.snapshot(); }
      this.hint = '请保持正面，正在检查画面与 RGB 防伪';
      if (this.identity && !this.identity.ready) this.hint = this.identity.hint;
      if (this.baselineFrames.length >= 8 && t - this.baselineFrames[0].t >= 700 && this.padAccepts(this.pre) && (!this.identity || this.identity.ready)) {
        this.baseline = { yaw: median(this.baselineFrames.map((v) => v.yaw)), pitch: median(this.baselineFrames.map((v) => v.pitch)) };
        this.phase = 'action'; this.phaseStarted = t; this.actionReadyAt = t + 700; this.resetHold();
        this.events.push({ type: 'prepared', t });
      }
    } else if (this.phase === 'action') {
      if (t - this.phaseStarted > this.settings.actionTimeout) { this.fail('动作超时，请重新开始', t); return this.snapshot(); }
      const a = this.actions[this.actionIndex];
      const yaw = m.yaw - this.baseline.yaw, pitch = m.pitch - this.baseline.pitch;
      const front = Math.abs(yaw) < 10 && Math.abs(pitch) < 12 && Math.abs(m.roll) < 12;
      this.hint = this.subphase === 'return' ? (a.id === 'blink' ? '请睁开双眼' : a.id === 'mouth' ? '请自然闭嘴' : '请回到正面') : a.guide;
      if (t < this.actionReadyAt) { this.resetHold(); return this.snapshot(); }
      if (this.subphase === 'neutral') {
        if (this.hold(front && m.blink < 0.3 && m.jaw < 0.22, t, 220)) {
          if (this.identity && !this.identity.checkpoint(`action-${this.actionIndex}-start`, t)) { this.hint = this.identity.hint; return this.snapshot(); }
          this.subphase = 'perform'; this.resetHold();
        }
      } else if (this.subphase === 'perform') {
        let condition = false, duration = 220;
        if (a.id === 'left') condition = yaw > 19 && yaw < 48 && Math.abs(pitch) < 18;
        if (a.id === 'right') condition = yaw < -19 && yaw > -48 && Math.abs(pitch) < 18;
        if (a.id === 'nod') condition = pitch > 15 && pitch < 45 && Math.abs(yaw) < 14;
        if (a.id === 'mouth') { condition = front && m.jaw > 0.48; duration = 180; }
        if (a.id === 'blink') { condition = front && m.blinkLeft > 0.55 && m.blinkRight > 0.55; duration = 55; }
        if (this.hold(condition, t, duration)) { this.subphase = 'return'; this.resetHold(); this.events.push({ type: 'action-motion', action: a.id, t }); }
      } else if (this.hold(front && m.blink < 0.3 && m.jaw < 0.22, t, 260)) {
        if (this.identity && !this.identity.checkpoint(`action-${this.actionIndex}-end`, t)) { this.hint = this.identity.hint; return this.snapshot(); }
        this.completed.push(a.id); this.events.push({ type: 'action-completed', action: a.id, t });
        this.actionIndex++; this.subphase = 'neutral'; this.phaseStarted = t; this.actionReadyAt = t + 700; this.resetHold();
        if (this.actionIndex === 2) { this.phase = 'capture'; this.captureStarted = t; }
      }
    } else if (this.phase === 'capture') {
      this.hint = '动作已完成，请正视镜头，正在优选清晰照片';
      if (t - this.captureStarted > 14000) { this.fail('未取得合格正脸与 RGB 样本，请重试', t); return this.snapshot(); }
      const steady = this.hold(neutral(m), t, 500, 4);
      if (freshRGB && steady) {
        this.post.push({ score: m.rgb.score, t });
        this.captureReady = m.rgb.score >= this.settings.rgbThreshold && (!this.identity || this.identity.fresh(t));
      } else this.captureReady = false;
      if (this.post.length >= 8 && !this.padAccepts(this.post)) this.fail('动作完成后 RGB 防伪未达阈值，请重试', t);
    }
    return this.snapshot();
  }
  finishCapture(hasPhoto, t, photoMetrics) {
    if (this.phase !== 'capture' || !hasPhoto || !this.padAccepts(this.post)) return false;
    if (this.identity && !this.identity.canFinish(photoMetrics, t)) return false;
    if (this.identity) this.identity.status = 'passed';
    this.phase = 'passed'; this.events.push({ type: 'passed', t }); return true;
  }
  snapshot() { return { phase: this.phase, hint: this.reason || this.hint || '请正视镜头', index: this.actionIndex, subphase: this.subphase, completed: [...this.completed], preCount: this.pre.length, postCount: this.post.length, captureReady: this.captureReady }; }
}
