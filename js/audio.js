/* =========================================================================
 * audio.js
 * Web Audio API で効果音とBGMを「その場で合成」する。音声ファイル不要・
 * 外部サーバー不要で、単一フォルダのまま音を鳴らせる。
 *   - 効果音(SE)：play('explode') のように名前で再生
 *   - BGM：簡単なループ曲をオシレーターで生成
 *   - モバイルの自動再生制限に対応（unlock() をユーザー操作時に呼ぶ）
 * 音量・パターンは下の定数を変えるだけで調整できる。
 * ========================================================================= */

const Sound = {
  ctx: null,        // AudioContext（最初のユーザー操作で生成）
  master: null,     // 全体音量＆ミュート用ゲイン
  enabledSE: true,  // 効果音 ON/OFF
  enabledBGM: false,// BGM ON/OFF
  muted: false,     // 🔊ボタンによる全体ミュート
  bgmTimer: null,
  bgmStep: 0,

  MASTER_VOL: 0.9,  // 全体音量

  /* AudioContext を用意（未生成なら作る） */
  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return; // 非対応ブラウザでは無音
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.MASTER_VOL;
    this.master.connect(this.ctx.destination);
  },

  /* モバイルの自動再生制限解除（「ゲーム開始」など操作時に呼ぶ） */
  unlock() {
    this.ensure();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  setSE(on) { this.enabledSE = on; },
  setBGM(on) {
    this.enabledBGM = on;
    if (on) this.startBGM(); else this.stopBGM();
  },

  /* 🔊ボタン：全体ミュート切替（現在のミュート状態を返す） */
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.MASTER_VOL;
    return this.muted;
  },

  /* ---- 低レベル合成ヘルパー ---------------------------------------- */

  // ホワイトノイズ音源（爆発などに使用）
  _noise(dur) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  },

  // 単音（エンベロープ付き）。melodic な効果音・BGMに使用
  _tone(freq, start, dur, type = 'sine', vol = 0.3) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(this.master);
    o.start(start);
    o.stop(start + dur + 0.02);
  },

  /* ---- 効果音 ------------------------------------------------------ */
  play(name) {
    if (!this.enabledSE || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    switch (name) {
      case 'throw': { // 投擲：上昇する短いチャープ
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(220, t);
        o.frequency.exponentialRampToValueAtTime(680, t + 0.15);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        o.connect(g).connect(this.master);
        o.start(t); o.stop(t + 0.18);
        break;
      }
      case 'explode': { // 爆発：ノイズ＋ローパスで減衰
        const src = this._noise(0.5);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(1400, t);
        lp.frequency.exponentialRampToValueAtTime(120, t + 0.4);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.9, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        src.connect(lp); lp.connect(g); g.connect(this.master);
        src.start(t); src.stop(t + 0.5);
        break;
      }
      case 'step': // 移動：短いクリック
        this._tone(520, t, 0.06, 'square', 0.12);
        break;
      case 'thud': // 開始マス破壊：低い衝撃音
        this._tone(90, t, 0.18, 'sine', 0.4);
        break;
      case 'ko': { // 脱落：下降する音
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(440, t);
        o.frequency.exponentialRampToValueAtTime(70, t + 0.4);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.3, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
        o.connect(g).connect(this.master);
        o.start(t); o.stop(t + 0.46);
        break;
      }
      case 'win': { // 勝利：上昇アルペジオ
        const notes = [523, 659, 784, 1047];
        notes.forEach((f, i) => this._tone(f, t + i * 0.12, 0.3, 'triangle', 0.3));
        break;
      }
    }
  },

  /* ---- BGM（簡単なループ曲） --------------------------------------- */
  // メロディ／ベースの音階（0=休符）。STEP_DUR ごとに1音進む。
  BGM_MELODY: [523, 659, 784, 659, 587, 659, 784, 880, 784, 659, 523, 587, 659, 587, 523, 0],
  BGM_BASS:   [131, 0, 0, 0, 196, 0, 0, 0, 165, 0, 0, 0, 196, 0, 0, 0],
  BGM_STEP_DUR: 0.22, // 1音の長さ(秒)

  startBGM() {
    this.ensure();
    if (!this.ctx || this.bgmTimer) return;
    this.bgmStep = 0;
    this.bgmTimer = setInterval(() => {
      if (!this.enabledBGM || !this.ctx) return;
      const t = this.ctx.currentTime + 0.02;
      const i = this.bgmStep % this.BGM_MELODY.length;
      if (this.BGM_MELODY[i]) this._tone(this.BGM_MELODY[i], t, this.BGM_STEP_DUR * 0.9, 'triangle', 0.06);
      if (this.BGM_BASS[i])   this._tone(this.BGM_BASS[i],   t, this.BGM_STEP_DUR * 1.8, 'sine', 0.08);
      this.bgmStep++;
    }, this.BGM_STEP_DUR * 1000);
  },

  stopBGM() {
    if (this.bgmTimer) { clearInterval(this.bgmTimer); this.bgmTimer = null; }
  },
};
