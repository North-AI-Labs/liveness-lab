export class RuntimeClient {
  async init(notify) {
    if (this.closed) throw new Error('检测页面已关闭');
    const base = new URL(import.meta.env.BASE_URL, location.href).href;
    if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function') {
      try {
        this.worker = new Worker(`${base}vision-worker.js`);
        this.pending = new Map(); this.sequence = 0;
        this.worker.onmessage = ({ data }) => {
          if (data.type === 'progress') { notify(data.message); return; }
          const pending = this.pending.get(data.id);
          if (!pending) return;
          clearTimeout(pending.timer); this.pending.delete(data.id);
          data.error ? pending.reject(new Error(data.error)) : pending.resolve(data.result);
        };
        this.worker.onerror = (event) => {
          for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(event.message || '推理线程异常')); }
          this.pending.clear();
        };
        await this.call('init', { base }, [], 90000);
        if (this.closed) throw new Error('检测页面已关闭');
        this.mode = 'Worker · WASM'; return;
      } catch (error) { console.warn('Worker unavailable, using main-thread inference', error); this.worker?.terminate(); this.worker = null; }
    }
    if (this.closed) throw new Error('检测页面已关闭');
    notify('启用兼容模式，正在加载本地模型');
    const { VisionRuntime } = await import('./vision-runtime.js');
    this.runtime = new VisionRuntime(); await this.runtime.init(base, notify);
    this.mode = '兼容模式 · WASM';
    if (this.closed) { this.runtime.close(); throw new Error('检测页面已关闭'); }
  }
  call(type, payload = {}, transfer = [], timeout = 15000) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('本地推理超时，请重新加载页面')); }, timeout);
      this.pending.set(id, { resolve, reject, timer }); this.worker.postMessage({ id, type, ...payload }, transfer);
    });
  }
  serial(task) {
    const pending = (this.serialQueue || Promise.resolve()).then(() => { if (this.closed) throw new Error('检测页面已关闭'); return task(); });
    this.serialQueue = pending.catch(() => {}); return pending;
  }
  configureIdentity(enabled) { return this.worker ? this.call('identity', { enabled }, [], 90000) : this.serial(() => this.runtime.configureIdentity(enabled)); }
  async frame(canvas, t, identity = {}) {
    if (!this.worker) return this.serial(() => this.runtime.analyze(canvas, t, false, identity));
    const image = await createImageBitmap(canvas);
    return this.call('frame', { image, t, identity }, [image]);
  }
  diagnostic() { return this.worker ? this.call('diagnostic') : this.serial(() => this.runtime.diagnostic()); }
  close() {
    this.closed = true;
    for (const pending of this.pending?.values() || []) { clearTimeout(pending.timer); pending.reject(new Error('检测页面已关闭')); }
    this.pending?.clear(); this.worker?.terminate(); this.worker = null;
    if (this.runtime) (this.serialQueue || Promise.resolve()).then(() => this.runtime.close());
  }
}
