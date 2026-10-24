import { cp, copyFile, mkdir } from 'node:fs/promises';
import { checkModels } from './check-models.mjs';
const root = new URL('../', import.meta.url);
await checkModels({ allowMissing: process.argv.includes('--allow-missing-models') });
await mkdir(new URL('public/vendor/ort/', root), { recursive: true });
await cp(new URL('node_modules/@mediapipe/tasks-vision/wasm/', root), new URL('public/vendor/mediapipe/', root), { recursive: true });
for (const file of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  await copyFile(new URL(`node_modules/onnxruntime-web/dist/${file}`, root), new URL(`public/vendor/ort/${file}`, root));
}
await copyFile(new URL('public/ORT-LICENSE.txt', root), new URL('public/vendor/ort/LICENSE.txt', root));
await copyFile(new URL('public/ORT-ThirdPartyNotices.txt', root), new URL('public/vendor/ort/ThirdPartyNotices.txt', root));
await copyFile(new URL('public/models/MediaPipe-LICENSE.txt', root), new URL('public/vendor/mediapipe/LICENSE.txt', root));
await copyFile(new URL('LICENSE', root), new URL('public/PROJECT-LICENSE.txt', root));
await copyFile(new URL('NOTICE', root), new URL('public/PROJECT-NOTICE.txt', root));
console.log('本地 WASM 运行库与许可证已准备。');
