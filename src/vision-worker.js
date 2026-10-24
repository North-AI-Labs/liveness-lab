import { VisionRuntime } from './vision-runtime.js';
let runtime;
let queue = Promise.resolve();
async function handle(data) {
  const { id, type, base, image, t } = data;
  try {
    if (type === 'init') {
      runtime = new VisionRuntime();
      await runtime.init(base, (message) => self.postMessage({ type: 'progress', message }));
      self.postMessage({ id, result: { ready: true } });
    } else if (type === 'frame') {
      const result = await runtime.analyze(image, t, false, data.identity); self.postMessage({ id, result });
    } else if (type === 'identity') self.postMessage({ id, result: await runtime.configureIdentity(data.enabled) });
    else if (type === 'diagnostic') self.postMessage({ id, result: await runtime.diagnostic() });
  } catch (error) { self.postMessage({ id, error: error.message || String(error) }); }
  finally { image?.close?.(); }
}
self.onmessage = ({ data }) => { queue = queue.then(() => handle(data)).catch(error => self.postMessage({ id: data.id, error: error.message })); };
