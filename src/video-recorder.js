const TYPES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'];

// One instance per camera session. Does not stop the stream's shared tracks.
export class LocalVideoRecorder {
  constructor({ Recorder = globalThis.MediaRecorder, onChange = () => {}, maxBytes = 64 * 1024 * 1024, finalizeTimeout = 8000 } = {}) {
    this.Recorder = Recorder; this.onChange = onChange; this.maxBytes = maxBytes; this.finalizeTimeout = finalizeTimeout;
    this.chunks = []; this.bytes = 0; this.status = 'idle'; this.error = ''; this.disposed = false;
  }
  notify(status) { this.status = status; if (!this.disposed) this.onChange(status, this.error); }
  start(stream) {
    if (this.status !== 'idle') throw new Error('录像实例不能重复使用');
    if (!this.Recorder) { this.error = '当前浏览器不支持 MediaRecorder，可换用系统浏览器'; this.notify('unsupported'); return false; }
    const types = TYPES.filter((type) => this.Recorder.isTypeSupported?.(type));
    types.push(''); // Let the browser select its own format as a last attempt.
    for (const mimeType of types) {
      let recorder;
      try {
        recorder = new this.Recorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 1_500_000 });
        recorder.ondataavailable = ({ data }) => {
          if (this.disposed || this.settled || !data?.size) return;
          if (this.bytes + data.size > this.maxBytes) {
            this.error = `录像达到 ${Math.round(this.maxBytes / 1024 / 1024)} MB 内存上限，已提前结束，仅保留已有片段`; this.stop(); return;
          }
          this.chunks.push(data); this.bytes += data.size;
        };
        recorder.onerror = () => { this.error = '浏览器录像编码失败，片段可能不完整'; this.stop(); };
        recorder.onstop = () => {
          if (!this.pending) this.error ||= '录像意外提前结束，仅保留已有片段';
          if (!this.disposed) this.complete();
        };
        this.recorder = recorder;
        recorder.start(1000);
        this.startedAt = new Date().toISOString(); this.started = performance.now(); this.error = '';
        this.notify('recording'); return true;
      } catch {
        if (recorder) recorder.ondataavailable = recorder.onerror = recorder.onstop = null;
        this.recorder = null;
      }
    }
    this.error = '当前浏览器无法启动视频编码，可换用系统浏览器'; this.notify('unsupported'); return false;
  }
  stop() {
    if (this.pending) return this.pending;
    this.pending = new Promise((resolve) => { this.resolve = resolve; });
    if (!this.recorder || this.settled || this.disposed) { this.complete(); return this.pending; }
    this.stoppedAt = new Date().toISOString(); this.durationMs = Math.max(0, performance.now() - this.started);
    this.notify('saving');
    this.timer = setTimeout(() => { this.error ||= '录像结束等待超时，片段可能不完整'; this.complete(); }, this.finalizeTimeout);
    // A stream/error can set inactive before its final dataavailable/stop events.
    // Wait for those events even if the recorder has already become inactive.
    if (this.recorder.state !== 'inactive') {
      try { this.recorder.stop(); } catch { this.error ||= '录像结束异常，片段可能不完整'; this.complete(); }
    }
    return this.pending;
  }
  complete() {
    if (this.settled) { this.resolve?.(this.result); return; }
    this.settled = true; clearTimeout(this.timer);
    if (this.started !== undefined) this.durationMs ??= Math.max(0, performance.now() - this.started);
    const mimeType = this.recorder?.mimeType || this.chunks[0]?.type || 'video/webm';
    const blob = this.chunks.length ? new Blob(this.chunks, { type: mimeType }) : null;
    const status = blob ? (this.error ? 'partial' : 'recorded') : this.status === 'unsupported' ? 'unsupported' : 'empty';
    this.result = { blob, status, mimeType, extension: mimeType.includes('mp4') ? 'mp4' : 'webm', bytes: blob?.size || 0, durationMs: this.durationMs || 0, startedAt: this.startedAt || null, stoppedAt: this.stoppedAt || new Date().toISOString(), hasAudio: false, error: this.error };
    this.chunks = [];
    this.notify(status); this.resolve?.(this.result);
  }
  dispose() {
    this.disposed = true; clearTimeout(this.timer);
    if (this.recorder) {
      this.recorder.ondataavailable = this.recorder.onerror = this.recorder.onstop = null;
      if (this.recorder.state !== 'inactive') try { this.recorder.stop(); } catch { /* Page is leaving. */ }
    }
    this.chunks = []; this.result = null; this.settled = true; this.resolve?.(null);
  }
}
