import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
const files = git(['ls-files', '--cached', '-z']).toString('utf8').split('\0').filter(Boolean);
if (!files.length) throw new Error('请先 git add 暂存发布文件，再运行检查。');
const forbidden = /(^|\/)(node_modules|dist|artifacts|\.cache|\.certs|\.private|\.venv|\.model-source|uploads|data|vendor)(\/|$)|(^|\/)\.env(?:\.|$)|\.(onnx|task|pth|wasm|zip|part|pem|key|pfx|p12|cer|crt|log|pid|jpe?g|png|webp|mp4|webm|go|exe|dll|pyc)$/i;
const privateFiles = new Set(['capture.html', 'src/capture-page.js', 'src/capture-controller.js', 'src/capture.css', 'src/capture-zoom.js', 'tests/capture-fixture.js', 'tests/capture-identity.test.mjs', 'public/vision-worker.js', 'public/PROJECT-LICENSE.txt', 'public/PROJECT-NOTICE.txt', '.npmrc']);
const issues = [];
const prompts = JSON.parse(git(['show', ':public/audio/prompts.json']).toString('utf8'));
let bytes = 0;
for (const file of files) {
  if (forbidden.test(file) || privateFiles.has(file)) issues.push(`禁止发布的本地文件：${file}`);
  const data = git(['show', `:${file}`]); bytes += data.length;
  if (data.length > 5 * 1024 * 1024) issues.push(`大于 5 MiB：${file}`);
  if (/\.wav$/i.test(file) && (!Object.keys(prompts).some(key => file === `public/audio/${key}.wav`) || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE')) issues.push(`非预置提示音：${file}`);
  const source = data.toString('utf8');
  if (/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(source)) issues.push(`发现私钥：${file}`);
  if (/(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,}|AKIA[0-9A-Z]{16})/.test(source)) issues.push(`疑似凭据：${file}`);
}
const pkg = JSON.parse(git(['show', ':package.json']).toString('utf8'));
if (pkg.license !== 'Apache-2.0') issues.push('源码许可须与 LICENSE 一致为 Apache-2.0。');
if (pkg.dependencies?.['onnxruntime-node'] || pkg.dependencies?.['@napi-rs/canvas']) issues.push('前端依赖不应包含 Node 推理适配器。');
for (const needed of ['LICENSE', 'NOTICE', 'README.md', 'package-lock.json', 'public/models/mediapipe-source.json', 'public/models/rgb-source.json', 'public/models/identity-source.json', 'public/models/README.md', 'docs/PUBLISHING.md']) {
  if (!files.includes(needed)) issues.push(`缺少发布文件：${needed}`);
}
if (issues.length) throw new Error(issues.join('\n'));
console.log(`发布索引检查通过：${files.length} 个文件，${(bytes / 1024).toFixed(1)} KiB；不含模型权重、照片、录像、证书和本地业务适配器。`);
console.log('此检查覆盖常见误提交，不代替人工审阅 git diff --cached。');
