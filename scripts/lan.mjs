import https from 'node:https';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { X509Certificate } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const interfaces = Object.entries(os.networkInterfaces()).flatMap(([name, items]) => items.filter((item) => item.family === 'IPv4' && !item.internal).map((item) => ({ ...item, name })));
const supplied = process.env.LIVENESS_LAN_IP || process.argv[2];
const candidates = interfaces.filter((item) => !/vpn|virtual|vEthernet|tun|tap|wsl/i.test(item.name));
const local = supplied ? interfaces.find((item) => item.address === supplied) : candidates.length === 1 ? candidates[0] : null;
if (!local) throw new Error('请指定本机局域网 IPv4：npm run dev:lan -- 192.168.x.x');
const ip = local.address;
const tlsDir = process.env.LIVENESS_TLS_DIR || path.join(root, '.certs');
const caName = process.env.LIVENESS_TLS_CA || 'ca.cer';
const [cert, key, ca] = await Promise.all(['server.pem', 'server-key.pem', caName].map((file) => readFile(path.join(tlsDir, file))));
const certificate = new X509Certificate(cert);
if (!certificate.checkIP(ip) || Date.parse(certificate.validTo) < Date.now()) throw new Error('测试证书已过期或不包含当前 IP。请更新测试证书，或通过 LIVENESS_TLS_DIR 指定有效证书目录。');
await stat(path.join(dist, 'index.html'));
const number = (address) => address.split('.').reduce((value, octet) => ((value << 8) | Number(octet)) >>> 0, 0);
function allowed(req) {
  const remote = req.socket.remoteAddress?.replace(/^::ffff:/, '');
  return remote && (number(remote) & number(local.netmask)) === (number(ip) & number(local.netmask));
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.task': 'application/octet-stream', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8' };
const server = https.createServer({ cert, key }, async (req, res) => {
  if (!allowed(req)) { res.writeHead(403); res.end(); return; }
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=()');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'https://localhost').pathname);
    const target = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!target.startsWith(dist + path.sep)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(target);
    res.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream');
    res.setHeader('Cache-Control', /\.(onnx|task|wasm)$/.test(target) ? 'public, max-age=3600' : 'no-cache');
    res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
const onboarding = http.createServer((req, res) => {
  if (!allowed(req)) { res.writeHead(403); res.end(); return; }
  if (req.url === '/ca.cer') { res.setHeader('Content-Type', 'application/x-x509-ca-cert'); res.setHeader('Content-Disposition', 'attachment; filename=liveness-test-ca.cer'); res.end(ca); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><title>活体实验室 · 手机测试</title><style>body{font-family:system-ui;padding:32px 22px;max-width:520px;margin:auto;line-height:1.9;color:#25463b}a{display:block;color:#137e70;margin:22px 0}small{color:#829387}</style><h1>手机测试入口</h1><p>手机与电脑连接同一 Wi-Fi。相机需要可信的 HTTPS。</p><p>若此前已安装并信任本实验室测试 CA，可直接进入。否则请手动安装下方测试证书；iPhone 还需在“设置 → 通用 → 关于本机 → 证书信任设置”开启完全信任。</p><a href="/ca.cer">下载本机测试 CA 证书</a><a href="https://${ip}:8445/">进入活体实验室 →</a><small>只在你信任的测试设备上安装。测试结束后可移除该 CA；本项目不会自动修改系统信任或防火墙。检测画面在浏览器内处理。</small></html>`);
});
server.listen(8445, ip, () => console.log(`手机活体测试：https://${ip}:8445/`));
onboarding.listen(8085, ip, () => console.log(`证书与测试引导：http://${ip}:8085/`));
function close() { server.close(); onboarding.close(); }
process.on('SIGINT', close); process.on('SIGTERM', close);
