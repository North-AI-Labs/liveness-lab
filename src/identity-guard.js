import { normalize, cosine } from './identity-math.js';

export const IDENTITY_DEFAULTS = Object.freeze({ threshold: 0.45, referenceThreshold: 0.55, intervalMs: 500, maxGapMs: 2000, seedCount: 3, seedSpanMs: 800 });
// Session-local, immutable reference; vectors are never included in reports.
export class FaceIdentityGuard {
  constructor(settings = {}) {
    this.settings = { ...IDENTITY_DEFAULTS, ...settings };
    this.seeds = []; this.reference = null; this.status = 'reference'; this.hint = '请保持正面，正在建立本轮人脸参考';
    this.checks = []; this.checkpoints = []; this.accepted = new Map(); this.mismatches = 0; this.maxGapMs = 0;
    this.lastMatchedAt = null; this.lastSampleAt = -Infinity; this.lastBox = null; this.force = false; this.blocked = false;
  }
  fail(reason) { this.status = 'failed'; this.hint = reason; this.blocked = true; }
  unavailable(t) {
    if (!this.reference) { this.seeds = []; return; }
    this.trackGap(t); this.blocked = true; this.force = true;
    if (this.status !== 'failed') { this.status = 'unknown'; this.hint = '暂时无法确认人脸一致性，请调整姿态并保持清晰'; }
  }
  trackGap(t) {
    if (this.lastMatchedAt === null) return;
    this.maxGapMs = Math.max(this.maxGapMs, t - this.lastMatchedAt);
    if (t - this.lastMatchedAt > this.settings.maxGapMs) this.fail('人脸一致性超过 2 秒未能确认，请重新检测');
  }
  update(m, t, { valid, referenceAllowed }) {
    if (this.closed || this.status === 'failed') return;
    this.trackGap(t); if (this.status === 'failed') return;
    if (!valid) { this.unavailable(t); return; }
    if (this.reference && this.lastBox) {
      const a = this.lastBox, b = m.box;
      if (Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.h / 2 - b.y - b.h / 2) > Math.max(a.w, a.h) * .9 || b.w / a.w > 1.8 || a.w / b.w > 1.8) {
        this.blocked = true; this.force = true;
        this.status = 'unknown'; this.hint = '人脸位置突变，正在重新确认一致性';
      }
    }
    this.lastBox = { ...m.box };
    if (m.identity?.t !== t || !m.identity.embedding) return;
    const embedding = normalize(m.identity.embedding);
    if (embedding.length !== 512) throw new Error('一致性模型特征维度无效');
    this.lastSampleAt = t;
    if (!this.reference) {
      if (!referenceAllowed) return;
      if (this.seeds.some(seed => cosine(seed.embedding, embedding) < this.settings.referenceThreshold)) { this.fail('准备阶段人脸参考不一致，请重新检测'); return; }
      if (!this.seeds.length || t - this.seeds.at(-1).t >= 300) this.seeds.push({ embedding, t });
      this.hint = `正在建立本轮人脸参考 ${this.seeds.length} / ${this.settings.seedCount}`;
      if (this.seeds.length >= this.settings.seedCount && t - this.seeds[0].t >= this.settings.seedSpanMs) {
        this.reference = normalize(embedding.map((_, i) => this.seeds.reduce((sum, seed) => sum + seed.embedding[i], 0) / this.seeds.length));
        this.seedTimes = this.seeds.map(seed => seed.t); this.seeds = [];
        this.lastMatchedAt = t; this.status = 'confirmed'; this.hint = '本轮固定参考已建立'; this.blocked = false;
      }
      return;
    }
    const score = cosine(this.reference, embedding), matched = score >= this.settings.threshold;
    this.checks.push({ t, score, matched }); this.score = score;
    if (matched) {
      this.lastMatchedAt = t; this.mismatches = 0; this.blocked = false; this.force = false; this.status = 'confirmed'; this.hint = '本轮人脸一致';
      this.accepted.set(t, score);
    } else {
      this.mismatches++; this.blocked = true; this.force = true; this.status = 'mismatch'; this.hint = '人脸一致性存疑，请保持正面等待复核';
      if (this.mismatches >= 2) this.fail('连续两次人脸特征不匹配，请重新检测');
    }
  }
  get ready() { return Boolean(this.reference) && !this.closed && !this.blocked && this.status !== 'failed'; }
  fresh(t) { return this.ready && this.accepted.has(t); }
  checkpoint(key, t) {
    if (!this.fresh(t)) { this.force = true; this.hint = '正在确认动作检查点的人脸一致性，请稍候'; return false; }
    if (!this.checkpoints.some(item => item.key === key)) this.checkpoints.push({ key, t, score: this.accepted.get(t) });
    return true;
  }
  frameSummary(t) { return { t, matched: this.fresh(t), score: this.accepted.get(t) ?? null }; }
  approvesPhoto(m) { return this.ready && m?.identity?.matched === true && this.accepted.has(m.identity.t) && m.identity.t === m.t && this.accepted.get(m.t) === m.identity.score; }
  canFinish(m, t) {
    this.trackGap(t);
    return this.approvesPhoto(m) && ['action-0-start', 'action-0-end', 'action-1-start', 'action-1-end'].every(key => this.checkpoints.some(item => item.key === key));
  }
  report() {
    return { enabled: true, status: this.status, model: 'MobileFaceNet / w600k_mbf.onnx', alignment: 'MediaPipe five-point similarity transform / 112x112', settings: { ...this.settings }, seedTimes: this.seedTimes || [], comparisons: this.checks.map(item => ({ ...item })), checkpoints: this.checkpoints.map(item => ({ ...item })), minSimilarity: this.checks.length ? Math.min(...this.checks.map(item => item.score)) : null, maxUnverifiedMs: this.maxGapMs, note: '会话内固定参考与抽样比对；不等于实名核验或防视频注入。' };
  }
  clearSensitive() { this.reference?.fill(0); for (const seed of this.seeds) seed.embedding.fill(0); this.reference = null; this.seeds = []; this.accepted.clear(); this.closed = true; }
}
