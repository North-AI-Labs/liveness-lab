import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
await build({
  entryPoints: [fileURLToPath(new URL('../src/vision-worker.js', import.meta.url))],
  bundle: true, outfile: fileURLToPath(new URL('../public/vision-worker.js', import.meta.url)),
  format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'warning',
});
console.log('本地推理 Worker 已更新。');
