/* =========================================================================
 * main.js
 * 起動・画面遷移・設定画面の入力収集・ゲーム生成。
 * Game(モデル) と UI(描画) を接続する。
 * ========================================================================= */

// 設定画面の選択状態（既定値）
const setupState = {
  size: 'medium',
  count: 2,
  obstacles: false,
  revisit: 'allow',
  se: true,    // 効果音（既定ON）
  bgm: false,  // BGM（既定OFF）
  // 各プレイヤーの human/CPU 設定（Step2で本格使用）。既定は全員human。
  players: [
    { isCPU: false, difficulty: 'normal' },
    { isCPU: false, difficulty: 'normal' },
    { isCPU: false, difficulty: 'normal' },
    { isCPU: false, difficulty: 'normal' },
  ],
};

let game = null;

/* ---- 画面切り替え ------------------------------------------------- */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

/* ---- セグメントボタン（排他選択）の共通処理 ----------------------- */
function bindSegment(containerId, onSelect) {
  const container = document.getElementById(containerId);
  container.addEventListener('click', e => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    container.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    onSelect(btn.dataset.val);
  });
}

/* ---- プレイヤー設定UI（人数に応じて再描画） ----------------------- */
function renderPlayerOptions() {
  const wrap = document.getElementById('opt-players');
  wrap.innerHTML = '';
  for (let i = 0; i < setupState.count; i++) {
    const conf = setupState.players[i];
    const row = document.createElement('div');
    row.className = 'player-row';

    const numChar = '①②③④'[i];
    row.innerHTML = `<span class="prow-num">${numChar}</span>`;

    // 人間/CPU 切り替え（Step2でCPU有効化。今はhumanのみ動作）
    const typeSeg = document.createElement('div');
    typeSeg.className = 'seg mini';
    typeSeg.innerHTML = `
      <button class="seg-btn ${!conf.isCPU ? 'active' : ''}" data-type="human">人間</button>
      <button class="seg-btn ${conf.isCPU ? 'active' : ''}" data-type="cpu">CPU</button>`;
    typeSeg.addEventListener('click', e => {
      const b = e.target.closest('.seg-btn');
      if (!b) return;
      conf.isCPU = b.dataset.type === 'cpu';
      renderPlayerOptions();
    });
    row.appendChild(typeSeg);

    // CPU難易度（CPU選択時のみ表示）
    if (conf.isCPU) {
      const diffSeg = document.createElement('div');
      diffSeg.className = 'seg mini';
      ['easy', 'normal', 'hard'].forEach(d => {
        const b = document.createElement('button');
        b.className = 'seg-btn' + (conf.difficulty === d ? ' active' : '');
        b.textContent = { easy: 'Easy', normal: 'Normal', hard: 'Hard' }[d];
        b.addEventListener('click', () => { conf.difficulty = d; renderPlayerOptions(); });
        diffSeg.appendChild(b);
      });
      row.appendChild(diffSeg);
    }

    wrap.appendChild(row);
  }
}

/* ---- ゲーム開始 --------------------------------------------------- */
function startGame() {
  const settings = {
    size: setupState.size,
    obstacles: setupState.obstacles,
    allowRevisit: setupState.revisit === 'allow',
    players: setupState.players.slice(0, setupState.count)
      .map(p => ({ isCPU: p.isCPU, difficulty: p.difficulty })),
  };

  // UIへ通知するフック（Step3でアニメーションを差し込む余地を残す）
  const hooks = {
    // 手番開始：人間/CPUの振り分けは UI.beginTurn が担当
    onTurnStart: () => UI.beginTurn(),
    // 爆弾投擲：投擲→着弾→爆発アニメ（命中時は victim にKO演出）
    onBomb: (cell, thrower, victim) => UI.fxThrow(thrower, cell, victim),
    // 移動：1歩ごとのクリック音
    onMove: () => Sound.play('step'),
    // 開始マス破壊：低い衝撃音
    onDestroyStart: () => Sound.play('thud'),
    onEliminate: (p, reason) => {
      // 行動不能はその場で消滅演出（爆弾命中は fxThrow 側で演出）
      if (reason === 'stuck') UI.fxStuck(p.r, p.c);
      const why = reason === 'bomb' ? '爆弾で命中' : '行動不能';
      UI.setStatus(`💥 プレイヤー${'①②③④'[p.order-1]} 脱落（${why}）`);
    },
    onWin: (winner) => {
      UI.clearCpuTimer();
      Sound.stopBGM();   // 勝利ジングルを目立たせるためBGM停止
      UI.fxConfetti();
      showOverlay('🏆 勝利！',
        winner ? `プレイヤー${'①②③④'[winner.order-1]} の勝ち！` : '引き分け', true);
    },
  };

  // サウンド有効化（このタップがモバイルの自動再生制限を解除する操作になる）
  Sound.unlock();
  Sound.setSE(setupState.se);
  Sound.setBGM(setupState.bgm);

  game = new Game(settings, hooks);
  showScreen('game-screen');
  UI.init(game);
  game.startTurn(); // onTurnStart → UI.beginTurn が初手をセットアップ
}

/* ---- オーバーレイ（メニュー / 勝利） ------------------------------ */
function showOverlay(title, msg, isWin) {
  document.getElementById('overlay-title').textContent = title;
  document.getElementById('overlay-msg').textContent = msg;
  // 勝利時は「ゲームに戻る」を隠す
  document.getElementById('overlay-resume').style.display = isWin ? 'none' : '';
  document.getElementById('overlay').classList.add('show');
}
function hideOverlay() {
  document.getElementById('overlay').classList.remove('show');
  if (UI.game) UI.lockInput(300); // 「戻る」タップの盤面貫通を防ぐ
}

/* ---- 起動時のイベント登録 ----------------------------------------- */
window.addEventListener('DOMContentLoaded', () => {
  bindSegment('opt-size', v => setupState.size = v);
  bindSegment('opt-count', v => { setupState.count = parseInt(v, 10); renderPlayerOptions(); });
  bindSegment('opt-obstacles', v => setupState.obstacles = (v === 'on'));
  bindSegment('opt-revisit', v => setupState.revisit = v);
  bindSegment('opt-se', v => setupState.se = (v === 'on'));
  bindSegment('opt-bgm', v => setupState.bgm = (v === 'on'));

  renderPlayerOptions();

  document.getElementById('start-btn').addEventListener('click', startGame);

  // サウンド切替（🔊/🔇）
  document.getElementById('sound-btn').addEventListener('click', e => {
    const muted = Sound.toggleMute();
    e.currentTarget.textContent = muted ? '🔇' : '🔊';
    e.currentTarget.classList.toggle('muted', muted);
  });

  // メニュー
  document.getElementById('menu-btn').addEventListener('click',
    () => showOverlay('メニュー', '', false));
  document.getElementById('overlay-resume').addEventListener('click', hideOverlay);
  document.getElementById('overlay-restart').addEventListener('click', () => {
    UI.clearCpuTimer(); // 予約中のCPU動作を停止
    Sound.stopBGM();    // BGM停止
    hideOverlay();
    showScreen('setup-screen');
  });
});
