import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const base = new URL('../public/models/', import.meta.url);
export async function checkModels({ allowMissing = false } = {}) {
  const read = async file => JSON.parse(await readFile(new URL(file, base), 'utf8'));
  const face = await read('mediapipe-source.json'), rgb = await read('rgb-source.json'), identity = await read('identity-source.json');
  const models = [{ file: 'face_landmarker.task', ...face }, ...rgb.models, identity];
  for (const model of models) {
    let data;
    try { data = await readFile(new URL(model.file, base)); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (allowMissing) { console.warn(`源码构建跳过缺失模型：${model.file}；产物不能用于检测。`); continue; }
      throw new Error(`缺少模型：${model.file}。先阅读 public/models/README.md，再运行 npm run assets -- --accept-model-terms。`);
    }
    if ((model.bytes && data.length !== model.bytes) || createHash('sha256').update(data).digest('hex') !== model.sha256) throw new Error(`模型 SHA-256 校验失败：${model.file}。不会自动覆盖，请核对来源后恢复。`);
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await checkModels(); console.log('全部四个模型 SHA-256 校验通过。');
}
