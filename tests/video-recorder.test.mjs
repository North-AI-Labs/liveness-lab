import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalVideoRecorder } from '../src/video-recorder.js';

class FakeRecorder {
  static isTypeSupported(type) { return type === 'video/webm;codecs=vp8'; }
  constructor(stream, options) { this.stream = stream; this.mimeType = options.mimeType || 'video/webm'; this.state = 'inactive'; }
  start() { this.state = 'recording'; }
  chunk(text) { this.ondataavailable?.({ data: new Blob([text], { type: this.mimeType }) }); }
  stop() { this.state = 'inactive'; queueMicrotask(() => { this.chunk('final'); this.onstop?.(); }); }
}
test('录像结束后才合并末尾数据，重复停止共用同一结果', async () => {
  const states = [], recording = new LocalVideoRecorder({ Recorder: FakeRecorder, onChange: (s) => states.push(s) });
  const stream = { marker: 'video-only', getTracks: () => { throw new Error('不得停止共享摄像头'); } };
  assert.equal(recording.start(stream), true);
  recording.recorder.chunk('first');
  const stopped = recording.stop(); assert.equal(recording.stop(), stopped);
  const saved = await stopped;
  assert.equal(await saved.blob.text(), 'firstfinal');
  assert.equal(saved.extension, 'webm'); assert.equal(saved.hasAudio, false);
  assert.equal(saved.status, 'recorded'); assert.equal(saved.bytes, 10);
  assert.deepEqual(states, ['recording', 'saving', 'recorded']);
});
test('不支持编码时明确报告，不能伪造有效录像', async () => {
  const recording = new LocalVideoRecorder({ Recorder: null });
  assert.equal(recording.start({}), false);
  const saved = await recording.stop();
  assert.equal(saved.status, 'unsupported'); assert.equal(saved.blob, null);
});
test('支持探测误报时尝试其他编码和浏览器默认格式', async () => {
  class DefaultOnly extends FakeRecorder {
    static isTypeSupported() { return true; }
    constructor(stream, options) { if (options.mimeType) throw new Error('不能使用显式格式'); super(stream, options); }
  }
  const recording = new LocalVideoRecorder({ Recorder: DefaultOnly });
  assert.equal(recording.start({}), true); assert.equal((await recording.stop()).status, 'recorded');
});
test('超出内存上限提前结束并标记片段，保留已有数据', async () => {
  const recording = new LocalVideoRecorder({ Recorder: FakeRecorder, maxBytes: 6 });
  recording.start({}); recording.recorder.chunk('one'); recording.recorder.chunk('too large');
  const saved = await recording.stop();
  assert.equal(saved.status, 'partial'); assert.equal(await saved.blob.text(), 'one'); assert.ok(saved.bytes <= 6);
});
test('离开页面清理后，迟到的编码事件不能恢复录像或通知界面', async () => {
  let notifications = 0;
  const recording = new LocalVideoRecorder({ Recorder: FakeRecorder, onChange: () => notifications++ });
  recording.start({}); const stopped = recording.stop(); recording.dispose();
  const after = notifications; assert.equal(await stopped, null);
  await Promise.resolve(); assert.equal(notifications, after); assert.equal(recording.chunks.length, 0);
});
test('浏览器不返回结束事件时有界等待，缺失末尾数据标记不完整', async () => {
  class Hung extends FakeRecorder { stop() { this.state = 'inactive'; } }
  const recording = new LocalVideoRecorder({ Recorder: Hung, finalizeTimeout: 5 });
  recording.start({}); recording.recorder.chunk('data');
  const saved = await recording.stop(); assert.equal(saved.status, 'partial'); assert.match(saved.error, /超时/);
});
test('编码错误不能标记为完整录像', async () => {
  const recording = new LocalVideoRecorder({ Recorder: FakeRecorder });
  recording.start({}); recording.recorder.chunk('data'); recording.recorder.onerror();
  assert.equal((await recording.stop()).status, 'partial');
});
test('相机先变为 inactive 时仍等待末尾数据和 stop 事件', async () => {
  const recording = new LocalVideoRecorder({ Recorder: FakeRecorder });
  recording.start({}); recording.recorder.state = 'inactive';
  const stopped = recording.stop();
  recording.recorder.chunk('tail'); recording.recorder.onstop();
  assert.equal(await (await stopped).blob.text(), 'tail');
});
test('浏览器自行结束录像时标明不完整，之后可获取已保存结果', async () => {
  const recording = new LocalVideoRecorder({ Recorder: FakeRecorder });
  recording.start({}); recording.recorder.chunk('video'); recording.recorder.state = 'inactive'; recording.recorder.onstop();
  assert.equal((await recording.stop()).status, 'partial');
});
