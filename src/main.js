import './style.css';
import './mobile.css';
import { ACTIONS, randomActions, LivenessSession, qualityIssue, median, neutral, clamp } from './core.js';
import { RuntimeClient } from './runtime-client.js';
import { AudioPrompts } from './audio-prompts.js';
import { LocalVideoRecorder } from './video-recorder.js';
import { selectFaceCandidate, jpegBlob } from './capture-evidence.js';
import { version as appVersion } from '../package.json';

const $ = (id) => document.getElementById(id);
$('copyright-year').textContent = String(new Date().getFullYear());
$('app-version').textContent = `v${appVersion}`;
$('technical-guide-link').href = `${import.meta.env.BASE_URL}technical-guide.html`;
const runtime = new RuntimeClient();
const voice = new AudioPrompts($('voice-player'), new URL(`${import.meta.env.BASE_URL}audio/`, location.href).href, (hint) => {
  $('voice-hint').textContent = hint;
  renderVoice();
});
function renderVoice() {
  $('voice-toggle').textContent = !voice.enabled ? '语音关闭' : voice.blocked ? '点按启用语音' : '语音开启';
  $('voice-toggle').setAttribute('aria-pressed', String(voice.enabled));
  $('voice-toggle').setAttribute('aria-label', !voice.enabled ? '开启语音提示' : voice.blocked ? '启用语音提示' : '关闭语音提示');
  $('voice-replay').disabled = !voice.enabled;
}
const video = $('video');
const frame = document.createElement('canvas');
const frameContext = frame.getContext('2d', { willReadFrequently: true });
let ready = false, active = false, stream, session, best, result, sequence = 0, lastRGB;
let lastVideoTime = -1, lastFrameAt = 0, nextFrameTimer, watchdog;
let recording, recordingResult, recordingPending = false, recordingGeneration = 0, recordingTimer;
let identityLoading = false;

function renderIdentity() {
  const enabled = session?.settings.identityEnabled ?? $('identity-enabled').checked;
  $('identity-details').hidden = !enabled;
  if (!enabled) return;
  const guard = session?.identity;
  const labels = { reference: '建立参考', confirmed: '本轮一致', unknown: '待确认', mismatch: '正在复核', failed: '未通过', passed: '校验完成' };
  $('identity-status').textContent = identityLoading ? '加载模型' : labels[guard?.status] || '待开始';
  $('identity-score').textContent = Number.isFinite(guard?.score) ? guard.score.toFixed(3) : '—';
  $('identity-count').textContent = String(guard?.checks.length || 0);
  $('identity-hint').textContent = guard?.hint || '固定本轮参考，过程抽检，动作前后与最终照片强制比对。';
}

const clockText = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
function recordingState(status, error = '') {
  const labels = { recording: '录制中', saving: '正在保存', recorded: '已保存', partial: '部分录像', unsupported: '不支持录制', empty: '无有效录像' };
  $('recording-state').textContent = labels[status] || '待开始';
  $('recording-state').dataset.status = status;
  $('recording-badge').hidden = status !== 'recording';
  $('recording-hint').textContent = error || ({ recording: '正在本机录制原始相机画面，不含声音。', saving: '正在整理本次录像，请稍候…', recorded: '录像保留在本页，可预览或下载；重新开始会清除。', partial: '录像提前结束，不能视为完整检测过程。', empty: '本轮没有生成有效视频，可重新检测。' }[status] || '开启检测后自动录像，仅保存在本页，不录音。');
  if (status !== 'recording') clearInterval(recordingTimer);
}
function clearRecording() {
  recordingGeneration++; clearInterval(recordingTimer); recording?.dispose(); recording = null;
  if (recordingResult?.url) URL.revokeObjectURL(recordingResult.url);
  recordingResult = null; recordingPending = false;
  $('recording-preview').pause(); $('recording-preview').removeAttribute('src'); $('recording-preview').load(); $('recording-preview').hidden = true;
  $('download-recording').disabled = true; $('recording-meta').textContent = ''; recordingState('idle');
}
function startRecording(camera) {
  const generation = recordingGeneration;
  recording = new LocalVideoRecorder({ onChange: (status, error) => { if (generation === recordingGeneration) recordingState(status, error); } });
  recording.start(new MediaStream(camera.getVideoTracks()));
  if (recording.status === 'recording') {
    const tick = () => { $('recording-time').textContent = clockText(performance.now() - recording.started); };
    tick(); recordingTimer = setInterval(tick, 500);
  }
}
function stopRecording(outcome) {
  if (!recording || recordingPending || recordingResult) return;
  const current = recording, generation = recordingGeneration;
  recordingPending = true;
  const outcomeLabel = { passed: '检测通过', failed: '检测未通过', stopped: '检测已停止' }[outcome] || '检测已结束';
  const reason = outcome === 'passed' ? '' : session?.reason || '';
  current.stop().then((saved) => {
    if (generation !== recordingGeneration || !saved) return;
    const { blob, ...metadata } = saved;
    recordingResult = { blob, metadata: { ...metadata, outcome, reason, mirrored: false, ...current.dimensions }, url: blob ? URL.createObjectURL(blob) : null };
    if (result) result.metadata.recording = recordingResult.metadata;
    $('recording-meta').textContent = `${outcomeLabel} · ${clockText(saved.durationMs)} · ${(saved.bytes / 1024 / 1024).toFixed(2)} MB${saved.blob ? ` · ${saved.extension.toUpperCase()}` : ''}`;
    $('download-recording').disabled = !blob;
    if (blob) { $('recording-preview').src = recordingResult.url; $('recording-preview').hidden = false; }
  }).finally(() => { if (generation === recordingGeneration) { recordingPending = false; controls(); } });
}

function message(text, error = false) { $('status-message').textContent = text; $('status-message').classList.toggle('error', error); }
function controls() {
  $('start').disabled = !ready || active || recordingPending || identityLoading; $('stop').disabled = !active;
  $('self-test').disabled = !ready || active || recordingPending || identityLoading; $('settings').disabled = active || identityLoading;
  $('identity-enabled').disabled = active || identityLoading;
  $('download-report').disabled = recordingPending;
}
function releaseCamera(outcome) {
  active = false; clearTimeout(nextFrameTimer); clearInterval(watchdog);
  stopRecording(outcome);
  if (session?.identity && outcome !== 'passed') { session.identity.status = 'failed'; session.identity.hint = session.reason || '本轮已停止，一致性校验未完成'; renderIdentity(); }
  session?.identity?.clearSensitive();
  stream?.getTracks().forEach((track) => track.stop()); stream = null; video.srcObject = null;
  $('viewfinder').classList.remove('live'); $('camera-dot').classList.remove('active');
  $('camera-label').textContent = '相机已关闭'; $('placeholder').hidden = false; controls();
}
function cancel(reason = '检测已停止，可以重新开始') {
  if (session && !['passed', 'failed'].includes(session.phase)) session.fail(reason, performance.now());
  sequence++; releaseCamera('stopped');
  $('viewfinder').dataset.phase = 'idle';
  voice.end(document.hidden ? null : 'stopped');
  best = null;
  $('instruction-title').textContent = '检测已停止'; $('instruction-subtitle').textContent = '重新开始将重新抽取两个动作';
  $('session-state').textContent = '已停止'; $('start').textContent = '重新开始检测'; message(reason);
}
function failure(error) {
  if (session && session.phase !== 'failed') session.fail(error.message || String(error), performance.now());
  sequence++; releaseCamera('failed'); best = null; result = null;
  $('viewfinder').dataset.phase = 'failed';
  voice.end('failed');
  $('instruction-title').textContent = '本次未通过'; $('instruction-subtitle').textContent = '调整拍摄条件后，可重新检测';
  $('session-state').textContent = '未通过'; $('start').textContent = '重新检测';
  message(error.message || String(error), true);
}
function renderActions() {
  $('action-list').replaceChildren(...session.actions.map((action, index) => {
    const row = document.createElement('div');
    row.className = `action-row ${session.completed.includes(action.id) ? 'done' : session.phase === 'action' && session.actionIndex === index ? 'current' : ''}`;
    const num = document.createElement('span'); num.className = 'action-number'; num.textContent = `0${index + 1}`;
    const label = document.createElement('span'); label.textContent = action.label;
    const status = document.createElement('span'); status.className = 'action-state'; status.textContent = session.completed.includes(action.id) ? '已完成 ✓' : session.phase === 'action' && session.actionIndex === index ? '进行中' : '待完成';
    row.append(num, label, status); return row;
  }));
}
function render(m, state) {
  renderActions();
  renderIdentity();
  voice.update(state, session.actions);
  $('viewfinder').dataset.phase = state.phase;
  const phaseNumber = { prepare: 0, action: 1, capture: 2, passed: 3, failed: -1 }[state.phase];
  [...$('stage-list').children].forEach((element, index) => { element.className = `stage ${index < phaseNumber ? 'done' : index === phaseNumber ? 'current' : ''}`; });
  $('session-state').textContent = { prepare: '正脸检查', action: `动作 ${Math.min(state.index + 1, 2)} / 2`, capture: '优选照片', passed: '检测通过', failed: '未通过' }[state.phase];
  const action = session.actions[state.index];
  $('instruction-title').textContent = state.phase === 'prepare' ? '请正视镜头' : state.phase === 'action' ? (state.subphase === 'neutral' ? '请先保持正面' : state.subphase === 'return' ? (action.id === 'blink' ? '请睁开双眼' : action.id === 'mouth' ? '请自然闭嘴' : '请回正并恢复自然表情') : action.label) : state.phase === 'capture' ? '请保持正面' : state.phase === 'passed' ? '检测完成' : '本次未通过';
  $('action-symbol').textContent = state.phase === 'action' ? action.symbol : state.phase === 'passed' ? '✓' : '◎';
  const hint = state.phase === 'action' && state.subphase === 'neutral' && state.hint === action.guide ? '正面稍作停留，听到动作提示后再开始' : state.hint;
  $('instruction-subtitle').textContent = hint; message(hint, state.phase === 'failed');
  const face = m.count === 1;
  $('chip-face').textContent = face ? '✓ 单人入镜' : '○ 单人入镜'; $('chip-face').classList.toggle('ok', face);
  const light = face && m.brightness >= 55 && m.brightness <= 215 && m.darkRatio <= 0.4 && m.brightRatio <= 0.3;
  $('chip-light').textContent = light ? '✓ 光线合适' : '○ 光线合适'; $('chip-light').classList.toggle('ok', light);
  const clear = face && m.sharpness >= session.settings.sharpness;
  $('chip-clear').textContent = clear ? '✓ 画面清晰' : '○ 画面清晰'; $('chip-clear').classList.toggle('ok', clear);
  $('frame-time').textContent = `${Math.round(m.duration)} ms`;
  $('pose-value').textContent = face ? [m.yaw, m.pitch, m.roll].map((n) => `${n.toFixed(1)}°`).join(' / ') : '—';
  $('quality-value').textContent = face ? `${m.brightness.toFixed(0)} / ${m.sharpness.toFixed(0)}` : '—';
  $('sample-count').textContent = `${state.preCount} / ${state.postCount}`;
  if (m.rgb) {
    lastRGB = m.rgb;
    $('rgb-score').textContent = m.rgb.score.toFixed(3); $('rgb-meter').style.width = `${m.rgb.score * 100}%`;
    $('rgb-meter').style.background = m.rgb.score >= session.settings.rgbThreshold ? '#248d70' : '#c99254';
    $('model-scores').textContent = m.rgb.scores.map((s) => s.toFixed(3)).join(' / ');
    $('rgb-caption').textContent = `当前帧分数 · 测试阈值 ${session.settings.rgbThreshold.toFixed(2)}`;
  } else if (!face || performance.now() - (lastRGB?.t ?? 0) > 1800) {
    $('rgb-score').textContent = '—'; $('rgb-meter').style.width = '0%'; $('rgb-caption').textContent = '请回正并保持自然表情，等待新的 RGB 样本';
  }
}

function considerPhoto(m, t) { best = selectFaceCandidate(frame, m, session, best, t); }
const blobOf = jpegBlob;
async function finish(run) {
  if (!best || !session.padAccepts(session.post)) return;
  const selected = best;
  const [originalBlob, portraitBlob] = await Promise.all([blobOf(selected.original), blobOf(selected.portrait)]);
  if (run !== sequence || !active) return;
  if (!session.finishCapture(true, performance.now(), selected.metrics)) throw new Error(session.identity?.status === 'failed' ? session.identity.hint : '照片、RGB 或一致性证据不足');
  const leftEye = selected.metrics.landmarks.filter((p) => [33, 133].includes(p.index));
  const rightEye = selected.metrics.landmarks.filter((p) => [263, 362].includes(p.index));
  const centre = (points) => ({ x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length });
  const facePoints = [centre(leftEye), centre(rightEye), ...[1, 61, 291].map((i) => selected.metrics.landmarks.find((p) => p.index === i))];
  const metadata = {
    schema: 'liveness-lab/v1', capturedAt: new Date().toISOString(), purpose: 'browser-local experimental liveness',
    actions: session.actions.map((a) => a.label), completedActions: session.completed,
    settings: session.settings, runtime: runtime.mode,
    identity: session.identity ? { ...session.identity.report(), finalPhoto: selected.metrics.identity } : { enabled: false, status: 'not_evaluated' },
    rgb: { beforeMedian: median(session.pre.map((p) => p.score)), afterMedian: median(session.post.map((p) => p.score)), photoFrame: selected.metrics.rgb, beforeSamples: session.pre.length, afterSamples: session.post.length },
    quality: { brightness: selected.metrics.brightness, sharpness: selected.metrics.sharpness, yaw: selected.metrics.yaw, pitch: selected.metrics.pitch, roll: selected.metrics.roll },
    photo: { mirrored: false, beautified: false, aligned: false, originalWidth: selected.original.width, originalHeight: selected.original.height, portraitCrop: selected.crop, faceBox: selected.metrics.box,
      landmarkOrder: ['imageLeftEye', 'imageRightEye', 'noseTip', 'imageLeftMouth', 'imageRightMouth'],
      originalLandmarks: facePoints.map((p) => ({ x: p.x * selected.original.width, y: p.y * selected.original.height })),
      portraitLandmarks: facePoints.map((p) => ({ x: p.x * selected.original.width - selected.crop.x, y: p.y * selected.original.height - selected.crop.y })),
    }, events: session.events,
    limitations: session.identity ? '已执行会话内固定参考与抽样人脸一致性校验；未执行证件身份比对；不能保证排除视频注入或前端篡改。' : '实验性动作活体与 RGB 防伪；未执行身份一致性或证件比对；不证明全程同一身份或排除视频注入。',
  };
  clearResult();
  result = { originalBlob, portraitBlob, metadata, url: URL.createObjectURL(portraitBlob) };
  $('portrait').src = result.url; $('photo-empty').hidden = true; $('photo-result').hidden = false;
  $('photo-meta').textContent = `${selected.portrait.width} × ${selected.portrait.height} · 未镜像 · 无美颜`;
  $('capture-flash').classList.add('flash');
  render(selected.metrics, session.snapshot()); releaseCamera('passed'); best = null;
  $('instruction-subtitle').textContent = '照片已保留在本页，可下载用于后续比对';
  $('start').textContent = '重新检测'; $('camera-label').textContent = '检测完成 · 相机已关闭';
  message('两个动作与 RGB 检查完成，已截取优选正脸照片');
  voice.end('success');
}
function clearResult() {
  if (result?.url) URL.revokeObjectURL(result.url);
  result = null; $('portrait').removeAttribute('src'); $('photo-empty').hidden = false; $('photo-result').hidden = true;
}

async function loop(run) {
  if (run !== sequence || !active) return;
  try {
    if (video.readyState < 2 || video.currentTime === lastVideoTime) { nextFrameTimer = setTimeout(() => loop(run), 35); return; }
    lastVideoTime = video.currentTime; lastFrameAt = performance.now();
    if (!video.videoWidth || !video.videoHeight) throw new Error('摄像头尚未输出有效画面');
    frame.width = video.videoWidth; frame.height = video.videoHeight;
    frameContext.drawImage(video, 0, 0);
    const t = performance.now();
    const m = await runtime.frame(frame, t, session.identity ? { enabled: true, force: session.identity.force, reference: !session.identity.reference, capture: session.phase === 'capture', settings: { sharpness: session.settings.sharpness } } : {});
    if (run !== sequence || !active) return;
    const state = session.update(m, t); render(m, state);
    if (state.phase === 'failed') { failure(new Error(session.reason)); return; }
    if (state.phase === 'capture') { considerPhoto(m, t); await finish(run); }
    if (active && run === sequence) nextFrameTimer = setTimeout(() => loop(run), Math.max(0, 65 - (performance.now() - t)));
  } catch (error) { if (run === sequence) failure(error); }
}

$('start').addEventListener('click', async () => {
  if (active || !ready || recordingPending || identityLoading) return;
  if (!$('rgb-threshold').reportValidity() || !$('sharpness-threshold').reportValidity() || ($('identity-enabled').checked && !$('identity-threshold').reportValidity())) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { message('相机需要可信 HTTPS 或 localhost，请使用手机测试 HTTPS 地址', true); return; }
  clearResult(); clearRecording(); best = null; lastRGB = null; lastVideoTime = -1;
  session = new LivenessSession(randomActions(), { rgbThreshold: Number($('rgb-threshold').value), sharpness: Number($('sharpness-threshold').value), identityEnabled: $('identity-enabled').checked, identityThreshold: Number($('identity-threshold').value) });
  active = true; const run = ++sequence; controls(); renderActions();
  $('viewfinder').dataset.phase = 'prepare';
  voice.begin();
  $('rgb-score').textContent = '—'; $('rgb-meter').style.width = '0%';
  $('instruction-title').textContent = '正在开启摄像头'; $('instruction-subtitle').textContent = '请允许使用前置摄像头'; message('请在浏览器提示中允许使用摄像头');
  let permissionTimer;
  try {
    identityLoading = true; controls(); renderIdentity();
    if (session.identity) { $('instruction-title').textContent = '正在准备一致性校验'; message('正在加载本地人脸一致性模型，首次约 13 MB…'); }
    try { await runtime.configureIdentity(Boolean(session.identity)); }
    catch (error) { throw new Error(`一致性模型准备失败：${error.message}。已勾选时不会跳过校验，请检查模型后重试。`); }
    finally { identityLoading = false; controls(); renderIdentity(); }
    if (run !== sequence || !active) return;
    $('instruction-title').textContent = '正在开启摄像头'; message('请在浏览器提示中允许使用摄像头');
    const request = navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } } });
    request.then((camera) => { if (run !== sequence) camera.getTracks().forEach((track) => track.stop()); }, () => {});
    const camera = await Promise.race([request, new Promise((_, reject) => { permissionTimer = setTimeout(() => reject(new Error('相机授权等待超时，请允许权限后重新开始')), 25000); })]);
    clearTimeout(permissionTimer);
    if (run !== sequence || !active) { camera.getTracks().forEach((track) => track.stop()); return; }
    stream = camera;
    stream.getVideoTracks()[0].addEventListener('ended', () => { if (active && run === sequence) cancel('摄像头已断开，请重新开始'); });
    video.srcObject = stream; await video.play();
    if (run !== sequence || !active) return;
    startRecording(stream);
    recording.dimensions = { width: video.videoWidth, height: video.videoHeight };
    $('viewfinder').classList.add('live'); $('placeholder').hidden = true; $('camera-dot').classList.add('active'); $('camera-label').textContent = '前置相机已开启';
    lastFrameAt = performance.now();
    watchdog = setInterval(() => { if (active && performance.now() - lastFrameAt > 5500) failure(new Error('视频或推理已中断，请重新开始')); }, 1000);
    loop(run);
  } catch (error) {
    clearTimeout(permissionTimer);
    if (run !== sequence) return;
    const texts = { NotAllowedError: '相机权限未开启，请在浏览器或微信设置中允许相机', NotFoundError: '未找到可用摄像头，请使用有前置相机的手机', NotReadableError: '相机被其他应用占用，请关闭后重试' };
    failure(new Error(texts[error.name] || error.message));
  }
});
$('stop').addEventListener('click', () => cancel());
$('identity-enabled').addEventListener('change', () => {
  $('identity-details').hidden = !$('identity-enabled').checked;
  $('identity-threshold-row').hidden = !$('identity-enabled').checked;
  $('identity-threshold').disabled = !$('identity-enabled').checked;
  $('identity-status').textContent = '待开始'; $('identity-score').textContent = '—'; $('identity-count').textContent = '0';
  $('identity-hint').textContent = '固定本轮参考，过程抽检，动作前后与最终照片强制比对。';
});
$('voice-toggle').addEventListener('click', () => { voice.toggle(); renderVoice(); });
$('voice-replay').addEventListener('click', () => voice.replay());
renderVoice();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  if (active) cancel('页面已切到后台，为保证连续性，本次检测已停止');
  else voice.end(null);
});
window.addEventListener('pagehide', () => { if (active) cancel(); voice.end(null); clearResult(); clearRecording(); session?.identity?.clearSensitive(); });
function download(blob, suffix) {
  if (!blob) return;
  const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url;
  anchor.download = `liveness-${new Date().toISOString().replace(/[:.]/g, '-')}-${suffix}`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
$('download-portrait').addEventListener('click', () => result && download(result.portraitBlob, 'portrait.jpg'));
$('download-original').addEventListener('click', () => result && download(result.originalBlob, 'original.jpg'));
$('download-report').addEventListener('click', () => result && download(new Blob([JSON.stringify(result.metadata, null, 2)], { type: 'application/json' }), 'report.json'));
$('download-recording').addEventListener('click', () => recordingResult?.blob && download(recordingResult.blob, `video.${recordingResult.metadata.extension}`));
$('self-test').addEventListener('click', async () => {
  $('self-test').disabled = true; $('start').disabled = true; $('self-test-result').textContent = '正在执行真实模型推理…';
  try {
    const check = await runtime.diagnostic();
    $('self-test-result').textContent = `链路正常：空白图检测到 ${check.faceCount} 张脸，${check.models} 个 RGB 模型已实际推理，输出 ${check.rgb.scores.map((n) => n.toFixed(4)).join(' / ')}。此检查不代表活体通过。`;
  } catch (error) { $('self-test-result').textContent = `链路检查失败：${error.message}`; }
  finally { controls(); }
});

try {
  await runtime.init((text) => message(text));
  ready = true; $('runtime-mode').textContent = runtime.mode; $('start').textContent = '开始活体检测'; controls(); message('模型已就绪，点击开始后再开启相机');
} catch (error) {
  $('runtime-mode').textContent = '初始化失败'; $('start').textContent = '模型加载失败';
  message(`本地模型加载失败：${error.message}。请检查模型文件后刷新页面。`, true);
}
