import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, randomActions, LivenessSession, bgrTensor, liveScore, scaledCrop, imageQuality, poseFromMatrix, qualityIssue } from '../src/core.js';

const action = (id) => ACTIONS.find((a) => a.id === id);
const metric = (extra = {}) => ({ count: 1, box: { x: 300, y: 150, w: 300, h: 340 }, ratio: 0.35, edge: false, brightness: 130, darkRatio: 0, brightRatio: 0, sharpness: 100, yaw: 0, pitch: 0, roll: 0, blink: 0, blinkLeft: 0, blinkRight: 0, jaw: 0, ...extra });
function rig(ids = ['left', 'mouth']) {
  const session = new LivenessSession(ids.map(action));
  let t = 0;
  const step = (extra = {}, rgb, gap = 100) => {
    t += gap;
    const m = metric(extra);
    if (rgb !== undefined) m.rgb = { score: rgb, t, scores: [rgb, rgb] };
    return session.update(m, t);
  };
  const repeat = (n, extra = {}, rgb) => { for (let i = 0; i < n; i++) step(extra, rgb); };
  const prepare = () => { for (let i = 0; i < 30 && session.phase === 'prepare'; i++) step({}, i % 3 === 0 ? 0.95 : undefined); assert.equal(session.phase, 'action'); };
  return { session, step, repeat, prepare, now: () => t };
}

test('all 20 ordered pairs are reachable and never duplicate', () => {
  const pairs = new Set();
  for (let a = 0; a < 5; a++) for (let b = 0; b < 4; b++) {
    const values = [a, b]; const selected = randomActions(() => values.shift());
    assert.notEqual(selected[0].id, selected[1].id); pairs.add(selected.map((v) => v.id).join(','));
  }
  assert.equal(pairs.size, 20);
});
test('model preprocessing is BGR CHW and keeps upstream 0..255 range', () => assert.deepEqual([...bgrTensor(new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]))], [30, 60, 20, 50, 10, 40]));
test('live class is index 1 and softmax handles very large logits', () => { assert.ok(liveScore([1000, 1010, 1001]) > 0.99); assert.ok(liveScore([1000, 990, 1001]) < 0.001); assert.throws(() => liveScore([NaN, 1, 2])); });
test('expanded crops stay inside image even near edges', () => {
  for (const box of [{ x: 1, y: 1, w: 100, h: 150 }, { x: 550, y: 330, w: 80, h: 140 }]) for (const scale of [2.7, 4]) {
    const crop = scaledCrop(box, 640, 480, scale);
    assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x + crop.w <= 640 && crop.y + crop.h <= 480);
  }
});
test('flat images are detected as blurry and exposure is measured', () => {
  const pixels = new Uint8ClampedArray(16 * 16 * 4).fill(120);
  const q = imageQuality(pixels, 16); assert.equal(q.sharpness, 0); assert.ok(Math.abs(q.brightness - 120) < 0.001);
});
test('column-major yaw/pitch direction agrees with subject-left and nod-down convention', () => {
  const rad = 25 * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
  assert.ok(Math.abs(poseFromMatrix([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, -50, 1]).yaw - 25) < 0.001);
  assert.ok(Math.abs(poseFromMatrix([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, -50, 1]).pitch - 25) < 0.001);
});
test('no RGB evidence never advances preparation', () => { const r = rig(); r.repeat(50); assert.equal(r.session.phase, 'prepare'); });
test('failed RGB rejects even with good face quality', () => { const r = rig(); r.repeat(10, {}, 0.2); assert.equal(r.session.phase, 'failed'); });
test('stale RGB timestamps are not counted', () => { const r = rig(); r.repeat(30, { rgb: { score: 1, t: -1 } }); assert.equal(r.session.pre.length, 0); });
test('multiple faces immediately invalidate the session', () => { const r = rig(); r.step({ count: 2 }); assert.equal(r.session.phase, 'failed'); });
test('short face loss cannot count as holding an action', () => {
  const r = rig(); r.prepare(); r.repeat(12); r.step({ yaw: 25 }); r.step({ count: 0 }); r.step({ yaw: 25 }); assert.equal(r.session.subphase, 'perform');
});
test('prolonged face loss and frame interruption invalidate session', () => {
  const a = rig(); a.prepare(); a.repeat(11, { count: 0 }); assert.equal(a.session.phase, 'failed');
  const b = rig(); b.prepare(); b.step({}, undefined, 2000); assert.equal(b.session.phase, 'failed');
});
test('wrong turn direction does not complete the requested action', () => {
  const r = rig(); r.prepare(); r.repeat(12); r.repeat(8, { yaw: -25 }); r.repeat(8); assert.equal(r.session.completed.length, 0);
});
const motion = {
  left: { yaw: 25 }, right: { yaw: -25 }, nod: { pitch: 24 },
  blink: { blink: 0.85, blinkLeft: 0.85, blinkRight: 0.85 }, mouth: { jaw: 0.7 },
};
for (const id of Object.keys(motion)) test(`${id}: require neutral, sustained motion, then neutral return`, () => {
  const r = rig([id, id === 'mouth' ? 'left' : 'mouth']); r.prepare();
  r.repeat(13); assert.equal(r.session.subphase, 'perform');
  r.step(motion[id]); assert.equal(r.session.subphase, 'perform', 'single frame cannot pass');
  r.repeat(5, motion[id]); assert.equal(r.session.subphase, 'return'); assert.equal(r.session.completed.length, 0);
  r.repeat(5); assert.equal(r.session.completed[0], id);
});
test('one eye closed does not pass a blink challenge', () => {
  const r = rig(['blink', 'mouth']); r.prepare(); r.repeat(13); r.repeat(7, { blink: 0.9, blinkLeft: 0.9, blinkRight: 0.1 }); assert.equal(r.session.subphase, 'perform');
});
test('held-open mouth at prompt cannot bypass initial neutral requirement', () => {
  const r = rig(['mouth', 'left']); r.prepare(); r.repeat(15, { jaw: 0.8 }); assert.equal(r.session.subphase, 'neutral');
});
test('full flow requires post-action RGB plus encoded photo before passing', () => {
  const r = rig(); r.prepare();
  for (const id of ['left', 'mouth']) { r.repeat(13); r.repeat(5, motion[id]); r.repeat(5); }
  assert.equal(r.session.phase, 'capture'); assert.equal(r.session.finishCapture(true, r.now()), false);
  r.repeat(23, {}, 0.95); assert.ok(r.session.post.length >= 6);
  assert.equal(r.session.finishCapture(false, r.now()), false);
  assert.equal(r.session.finishCapture(true, r.now()), true); assert.equal(r.session.phase, 'passed');
});
test('poor quality never produces a capture-ready sample', () => {
  const r = rig(); r.prepare(); for (const id of ['left', 'mouth']) { r.repeat(13); r.repeat(5, motion[id]); r.repeat(5); }
  r.repeat(20, { sharpness: 0 }, 0.99); assert.equal(r.session.post.length, 0); assert.equal(r.session.captureReady, false);
});
test('quality rejects undersized, cropped and overexposed faces', () => {
  const settings = { sharpness: 35 };
  for (const extra of [{ box: { w: 100, h: 120 } }, { edge: true }, { brightRatio: 0.8 }, { brightness: 20 }]) assert.notEqual(qualityIssue(metric(extra), settings), '');
});
