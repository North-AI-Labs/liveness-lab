export function cueForState(state, actions) {
  if (state.phase === 'prepare') return { key: 'prepare', clip: 'prepare' };
  if (state.phase === 'capture') return { key: 'capture', clip: 'capture' };
  if (state.phase !== 'action') return null;
  const action = actions[state.index];
  if (!action) return null;
  const key = `action:${state.index}:${state.subphase === 'neutral' ? 'neutral' : state.subphase === 'return' ? 'return' : 'perform'}`;
  if (state.subphase === 'neutral') return { key, clip: 'front' };
  if (state.subphase === 'return') return { key, clip: action.id === 'blink' ? 'openEyes' : action.id === 'mouth' ? 'closeMouth' : 'return' };
  return { key, clip: action.id };
}

// One shared audio element: unlock from a user click and replace stale prompts.
// No speech service or recording permission is involved.
export class AudioPrompts {
  constructor(player, base, notify = () => {}) {
    this.player = player; this.base = base; this.notify = notify;
    this.enabled = true; this.blocked = false; this.active = false;
    this.lastKey = ''; this.currentClip = null; this.revision = 0;
    player.preload = 'auto';
    player.addEventListener('error', () => {
      if (!this.enabled || !this.currentClip) return;
      this.blocked = true; this.notify('音频未能播放，点按语音按钮重试');
    });
  }
  stop() { this.revision++; this.player.pause(); }
  play(clip, fromGesture = false) {
    this.currentClip = clip;
    if (!this.enabled || (this.blocked && !fromGesture)) return;
    this.stop();
    if (fromGesture) this.blocked = false;
    const revision = this.revision;
    this.player.src = `${this.base}${clip}.wav`;
    const failed = () => {
      if (revision !== this.revision || !this.enabled) return;
      this.blocked = true; this.notify('点按语音按钮启用声音，文字提示可继续使用');
    };
    try {
      const playback = this.player.play();
      playback?.then(() => { if (revision === this.revision) { this.blocked = false; this.notify(''); } }, failed);
    } catch { failed(); }
  }
  begin() {
    this.active = true; this.lastKey = 'prepare';
    this.play('prepare', true);
  }
  update(state, actions) {
    if (!this.active) return;
    const cue = cueForState(state, actions);
    if (!cue || cue.key === this.lastKey) return;
    this.lastKey = cue.key; this.play(cue.clip);
  }
  end(clip) {
    this.active = false; this.lastKey = ''; this.currentClip = null;
    this.stop();
    if (clip) this.play(clip);
  }
  toggle() {
    if (this.blocked && this.enabled) { this.play(this.currentClip || 'enabled', true); return; }
    this.enabled = !this.enabled;
    if (!this.enabled) { this.stop(); this.notify(''); }
    else this.play(this.active ? this.currentClip || 'prepare' : 'enabled', true);
  }
  replay() { this.play(this.currentClip || 'enabled', true); }
}
