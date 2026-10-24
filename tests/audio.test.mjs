import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIONS } from '../src/core.js';
import { AudioPrompts, cueForState } from '../src/audio-prompts.js';

function player() {
  return { played: [], paused: 0, addEventListener() {}, pause() { this.paused++; }, play() { this.played.push(this.src); return Promise.resolve(); } };
}
test('frame updates speak once per action stage and correctly prompt eye/mouth recovery', () => {
  const audio = player(), voice = new AudioPrompts(audio, '/audio/');
  const actions = [ACTIONS.find((a) => a.id === 'blink'), ACTIONS.find((a) => a.id === 'mouth')];
  voice.begin();
  for (let i = 0; i < 100; i++) voice.update({ phase: 'prepare' }, actions);
  assert.deepEqual(audio.played, ['/audio/prepare.wav']);
  for (const subphase of ['neutral', 'perform', 'return']) for (let i = 0; i < 100; i++) voice.update({ phase: 'action', index: 0, subphase }, actions);
  assert.deepEqual(audio.played.slice(1), ['/audio/front.wav', '/audio/blink.wav', '/audio/openEyes.wav']);
  voice.update({ phase: 'action', index: 1, subphase: 'return' }, actions);
  assert.equal(audio.played.at(-1), '/audio/closeMouth.wav');
});
test('muting stops sound while preserving the latest prompt for re-enabling', () => {
  const audio = player(), voice = new AudioPrompts(audio, '/audio/'); voice.begin(); voice.toggle();
  const before = audio.played.length;
  voice.update({ phase: 'action', index: 0, subphase: 'perform' }, [ACTIONS[1]]);
  assert.equal(audio.played.length, before); assert.equal(voice.enabled, false);
  voice.toggle(); assert.equal(audio.played.at(-1), '/audio/left.wav');
  voice.end(null); assert.equal(voice.active, false); assert.equal(voice.currentClip, null);
});
test('blocked autoplay does not flood retries and recovers from explicit replay', async () => {
  const audio = player(); audio.play = function () { this.played.push(this.src); return Promise.reject(new Error('NotAllowedError')); };
  const voice = new AudioPrompts(audio, '/audio/'); voice.begin(); await Promise.resolve();
  assert.equal(voice.blocked, true);
  voice.update({ phase: 'capture' }, []); assert.equal(audio.played.length, 1);
  audio.play = function () { this.played.push(this.src); return Promise.resolve(); };
  voice.replay(); await Promise.resolve(); assert.equal(voice.blocked, false); assert.equal(audio.played.at(-1), '/audio/capture.wav');
});
test('all prompts used by the flow are shipped as non-empty PCM WAV files', async () => {
  const prompts = JSON.parse(await readFile(new URL('../public/audio/prompts.json', import.meta.url), 'utf8'));
  for (const clip of Object.keys(prompts)) {
    const bytes = await readFile(new URL(`../public/audio/${clip}.wav`, import.meta.url));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.toString('ascii', 8, 12), 'WAVE'); assert.ok(bytes.length > 1000, clip);
  }
  for (const action of ACTIONS) assert.ok(prompts[cueForState({ phase: 'action', index: 0, subphase: 'perform' }, [action]).clip]);
});
