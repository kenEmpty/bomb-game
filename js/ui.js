/* =========================================================================
 * ui.js
 * 画面描画とタップ操作の橋渡し。Game(モデル)の状態を読んでDOMを更新し、
 * タップを Game のメソッド呼び出しに変換する。
 * ========================================================================= */

const UI = {
  game: null,
  boardEl: null,
  highlightType: null, // 'bomb' | 'move' | null（現在ハイライト中の種類）

  cpuTimer: null,       // CPUの遅延実行ハンドル（リスタート時の停止用）
  prevDestroyed: null,  // 直前フレームで破壊済みだったマス（破壊アニメ検出用）
  prevPos: null,        // 直前フレームのプレイヤー位置（移動アニメ検出用）

  // ゲーム開始時に呼ぶ
  init(game) {
    this.game = game;
    this.boardEl = document.getElementById('board');
    this.clearCpuTimer();
    this.renderBoard();
    // 初期状態をスナップショット（最初の描画で障害物が割れて見えないように）
    this.prevDestroyed = new Set();
    this.prevPos = {};
    for (let r = 0; r < game.rows; r++)
      for (let c = 0; c < game.cols; c++)
        if (game.grid[r][c] === CELL.DESTROYED) this.prevDestroyed.add(key(r, c));
    for (const p of game.players) this.prevPos[p.id] = key(p.r, p.c);
    this.lockInput(400); // 開始ボタンの貫通タップで初手を誤爆しないように
    this.refresh();
  },

  // 予約中のCPU動作を止める（設定画面に戻ったときなどに使用）
  clearCpuTimer() {
    if (this.cpuTimer) { clearTimeout(this.cpuTimer); this.cpuTimer = null; }
  },

  /* ---- ターン開始の唯一の入口（人間/CPUを振り分け） ---------------- */
  beginTurn() {
    const g = this.game;
    if (g.phase === PHASE.OVER) return;
    this.refresh();
    this.updateStatusForPhase();
    if (g.currentPlayer.isCPU) this.runCpuTurn();
  },

  /* ---- 盤面の生成 -------------------------------------------------- */
  renderBoard() {
    const g = this.game;
    const el = this.boardEl;
    el.innerHTML = '';
    el.style.setProperty('--cols', g.cols);
    el.style.setProperty('--rows', g.rows);

    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.r = r;
        cell.dataset.c = c;
        // タップ／クリック両対応
        cell.addEventListener('click', () => this.onCellTap(r, c));
        el.appendChild(cell);
      }
    }
    this.fitBoard();
  },

  /* 盤面サイズを利用可能スペースに合わせて最大化する。
   * 横はできるだけ広く、さらに縦の空きスペースを使ってマスを縦に伸ばし
   * （上限 CELL_MAX_STRETCH）、スマホでもタップしやすい大きさにする。 */
  fitBoard() {
    const g = this.game;
    if (!g) return;
    const board = this.boardEl;
    const wrap = document.getElementById('board-wrap');
    if (!wrap || wrap.clientWidth === 0 || wrap.clientHeight === 0) return;

    const ws = getComputedStyle(wrap);
    const W = wrap.clientWidth - parseFloat(ws.paddingLeft) - parseFloat(ws.paddingRight);
    const H = wrap.clientHeight - parseFloat(ws.paddingTop) - parseFloat(ws.paddingBottom);
    const gap = parseFloat(getComputedStyle(board).columnGap) || 0;
    const cols = g.cols, rows = g.rows;
    const S = CONFIG.CELL_MAX_STRETCH;

    // 横・縦それぞれに収まる最大セル寸法
    let cellW = (W - gap * (cols - 1)) / cols;
    let cellH = (H - gap * (rows - 1)) / rows;
    // 縦横比が極端にならないよう制限（空きスペースは使うが歪ませない）
    if (cellH > cellW * S) cellH = cellW * S;
    if (cellW > cellH * S) cellW = cellH * S;

    board.style.width = (cellW * cols + gap * (cols - 1)) + 'px';
    board.style.height = (cellH * rows + gap * (rows - 1)) + 'px';
  },

  // 座標→セル要素
  cellEl(r, c) {
    return this.boardEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
  },

  /* ---- 全体更新（状態を見て描き直す） ------------------------------ */
  refresh() {
    const g = this.game;

    // HUD
    document.getElementById('hud-turn').textContent = g.round;
    document.getElementById('hud-alive').textContent = g.aliveCount;
    const cur = g.currentPlayer;
    const curEl = document.getElementById('hud-current');
    curEl.textContent = '①②③④'[cur.order - 1] || cur.order;
    curEl.style.color = cur.color;

    // 各セルの状態とプレイヤートークンを反映
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        const cell = this.cellEl(r, c);
        cell.classList.toggle('destroyed', g.grid[r][c] === CELL.DESTROYED);
        cell.classList.remove('hl-bomb', 'hl-move');
        cell.innerHTML = '';
      }
    }

    // 人間が1人だけなら「あなた」、複数なら「P1/P2…」で区別する
    const humanCount = g.players.filter(p => !p.isCPU).length;

    // プレイヤートークン描画
    for (const p of g.players) {
      if (!p.alive) continue;
      const cell = this.cellEl(p.r, p.c);
      const token = document.createElement('div');
      token.className = 'token';
      if (p.id === cur.id) token.classList.add('active'); // 手番を強調
      // 自分(人間)かCPUかを示すバッジ（どれが自分か一目で分かるように）
      const label = this.playerLabel(p, humanCount);
      const badge = `<span class="token-badge ${p.isCPU ? 'cpu' : 'you'}">${label}</span>`;
      token.innerHTML = badge + stickFigureSVG(p.color, p.order);
      // 直前と位置が変わったトークンは「ぴょこっ」と着地アニメ
      if (this.prevPos && this.prevPos[p.id] && this.prevPos[p.id] !== key(p.r, p.c)) {
        token.classList.add('moved');
      }
      cell.appendChild(token);
    }

    // 新しく破壊されたマスに崩壊アニメを付与（前フレームとの差分で検出）
    if (this.prevDestroyed) {
      for (let r = 0; r < g.rows; r++) {
        for (let c = 0; c < g.cols; c++) {
          if (g.grid[r][c] !== CELL.DESTROYED) continue;
          if (this.prevDestroyed.has(key(r, c))) continue;
          const cell = this.cellEl(r, c);
          cell.classList.add('breaking');
          setTimeout(() => cell.classList.remove('breaking'), 500 / CONFIG.ANIM_SPEED);
        }
      }
    }

    // 現在状態をスナップショットして次フレームの差分検出に使う
    this.prevDestroyed = new Set();
    for (let r = 0; r < g.rows; r++)
      for (let c = 0; c < g.cols; c++)
        if (g.grid[r][c] === CELL.DESTROYED) this.prevDestroyed.add(key(r, c));
    this.prevPos = {};
    for (const p of g.players) this.prevPos[p.id] = key(p.r, p.c);

    this.renderRoster();
    this.renderSteps();
    this.renderHighlights();
  },

  // プレイヤーの表示ラベル（CPU / あなた / Px）
  playerLabel(p, humanCount) {
    if (p.isCPU) return 'CPU';
    return humanCount === 1 ? 'あなた' : 'P' + p.order;
  },

  /* ---- プレイヤー一覧バー ------------------------------------------ */
  renderRoster() {
    const g = this.game;
    const el = document.getElementById('roster');
    if (!el) return;
    const humanCount = g.players.filter(p => !p.isCPU).length;
    const cur = g.currentPlayer;
    el.innerHTML = '';
    for (const p of g.players) {
      const chip = document.createElement('div');
      chip.className = 'pchip';
      if (!p.alive) chip.classList.add('dead');
      else if (p.id === cur.id) chip.classList.add('current'); // 手番を強調
      chip.style.setProperty('--pcolor', p.color);
      chip.innerHTML =
        `<span class="pchip-face">${'①②③④'[p.order - 1]}</span>` +
        `<span class="pchip-label">${this.playerLabel(p, humanCount)}</span>`;
      el.appendChild(chip);
    }
  },

  /* ---- 残り歩数のドット表示＆手番カラーの反映 ---------------------- */
  renderSteps() {
    const g = this.game;
    const el = document.getElementById('step-dots');
    const bar = document.getElementById('action-bar');
    if (!el) return;

    // アクションバーを手番プレイヤーの色で縁取り
    if (bar && g.phase !== PHASE.OVER) bar.style.setProperty('--turn-color', g.currentPlayer.color);

    const total = CONFIG.MOVE_STEPS;
    // 移動中は残り歩数、それ以外（投擲フェーズ）は満タン表示
    const remaining = g.phase === PHASE.MOVE ? g.movesLeft : total;
    let html = '<span class="dots-label">移動</span>';
    for (let i = 0; i < total; i++) {
      const used = i >= remaining; // 左から消費していく
      html += `<span class="dot ${used ? 'used' : ''}"></span>`;
    }
    el.innerHTML = html;
  },

  /* ---- 演出（FX）：盤面に重ねるアニメーション ---------------------- *
   * ゲームロジックはフックを通じて以下を呼ぶだけ。座標→ピクセルへ変換し、
   * 一時的なDOM要素を盤面に重ねて再生・自動削除する（ロジックは止めない）。 */

  // セル中心のピクセル座標（boardを基準）
  cellCenter(r, c) {
    const el = this.cellEl(r, c);
    return { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2 };
  },

  // 盤面に一時FX要素を追加（ms後に自動削除）
  spawnFx(className, text, x, y, life) {
    const el = document.createElement('div');
    el.className = 'fx ' + className;
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    this.boardEl.appendChild(el);
    setTimeout(() => el.remove(), life);
    return el;
  },

  // 爆弾投擲：投げた人→着弾マスへ飛ばし、着弾で爆発。命中時はKO演出も
  fxThrow(thrower, target, victim) {
    const from = this.cellCenter(thrower.r, thrower.c);
    const to = this.cellCenter(target.r, target.c);
    const dur = 380 / CONFIG.ANIM_SPEED;
    const bomb = this.spawnFx('fx-bomb', '💣', from.x, from.y, dur + 50);
    Sound.play('throw');
    // 次フレームで目標へ移動（CSS transition で飛行）
    requestAnimationFrame(() => {
      bomb.style.transitionDuration = dur + 'ms';
      bomb.style.left = to.x + 'px';
      bomb.style.top = to.y + 'px';
    });
    setTimeout(() => {
      this.fxExplode(target.r, target.c);
      if (victim) this.fxKO(target.r, target.c);
    }, dur);
  },

  // 爆発エフェクト
  fxExplode(r, c) {
    const p = this.cellCenter(r, c);
    this.spawnFx('fx-explode', '💥', p.x, p.y, 600 / CONFIG.ANIM_SPEED);
    Sound.play('explode');
  },

  // 脱落（爆弾命中）演出
  fxKO(r, c) {
    const p = this.cellCenter(r, c);
    this.spawnFx('fx-ko', 'OUT!', p.x, p.y, 900 / CONFIG.ANIM_SPEED);
    Sound.play('ko');
  },

  // 行動不能で脱落した演出
  fxStuck(r, c) {
    const p = this.cellCenter(r, c);
    this.spawnFx('fx-ko', '💨 OUT', p.x, p.y, 900 / CONFIG.ANIM_SPEED);
    Sound.play('ko');
  },

  // 勝利演出：画面上部から紙吹雪を降らせる
  fxConfetti() {
    Sound.play('win');
    const layer = document.getElementById('overlay');
    const emojis = ['🎉', '🎊', '✨', '⭐', '💥'];
    for (let i = 0; i < 24; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.textContent = emojis[i % emojis.length];
      c.style.left = Math.random() * 100 + '%';
      c.style.animationDelay = (Math.random() * 0.6) + 's';
      c.style.fontSize = (16 + Math.random() * 18) + 'px';
      layer.appendChild(c);
      setTimeout(() => c.remove(), 2600);
    }
  },

  // フェーズに応じたハイライト（爆弾射程 / 移動候補）
  renderHighlights() {
    const g = this.game;
    // 既存ハイライト消去
    this.boardEl.querySelectorAll('.hl-bomb, .hl-move')
      .forEach(el => el.classList.remove('hl-bomb', 'hl-move'));

    if (g.phase === PHASE.THROW) {
      this.highlightType = 'bomb';
      for (const t of g.getBombTargets()) {
        this.cellEl(t.r, t.c).classList.add('hl-bomb');
      }
    } else if (g.phase === PHASE.MOVE) {
      this.highlightType = 'move';
      for (const t of g.getMoveTargets()) {
        this.cellEl(t.r, t.c).classList.add('hl-move');
      }
    } else {
      this.highlightType = null;
    }
  },

  /* ---- ステータス文言 ---------------------------------------------- */
  setStatus(text) {
    document.getElementById('status-msg').innerHTML = text;
  },

  updateStatusForPhase() {
    const g = this.game;
    const cur = g.currentPlayer;
    const num = '①②③④'[cur.order - 1];
    const humanCount = g.players.filter(p => !p.isCPU).length;
    // 手番が自分(人間)かCPUかを先頭に明示する（バッジ表記と統一）
    const who = cur.isCPU
      ? `🤖 CPU${num}`
      : `<b style="color:${cur.color}">🎮 ${humanCount === 1 ? `あなた（${num}）` : `Player${num}`}</b>`;
    if (g.phase === PHASE.THROW) {
      this.setStatus(`${who} の番 — ①爆弾を投げる：着弾マスをタップ`);
    } else if (g.phase === PHASE.MOVE) {
      this.setStatus(`${who} の番 — ②移動：あと <b>${g.movesLeft}</b> 歩`);
    }
  },

  /* ---- 入力ロック（画面遷移直後のゴーストタップ対策） -------------- *
   * スマホでは「ゲーム開始」ボタンのタップが、直後に同じ位置へ現れた盤面
   * セルへ貫通して誤爆することがある。遷移直後の数百msだけ盤面タップを無視。*/
  inputLockUntil: 0,
  lockInput(ms) { this.inputLockUntil = performance.now() + ms; },

  /* ---- タップ処理 -------------------------------------------------- */
  onCellTap(r, c) {
    const g = this.game;
    if (performance.now() < this.inputLockUntil) return; // 遷移直後の貫通タップを無視
    if (g.phase === PHASE.OVER) return;
    if (g.currentPlayer.isCPU) return; // CPUの番は操作不可（CPU自動進行中）

    if (g.phase === PHASE.THROW) {
      if (g.throwBomb(r, c)) {
        this.refresh();
        if (g.phase !== PHASE.OVER) this.updateStatusForPhase();
      }
    } else if (g.phase === PHASE.MOVE) {
      if (g.step(r, c)) {
        this.refresh();
        if (g.phase !== PHASE.OVER) this.updateStatusForPhase();
      }
    }
  },

  /* ---- CPUの自動進行 ---------------------------------------------- *
   * runCpuTurn → _cpuBomb → _cpuStep ×3 と、思考時間を挟んで連鎖実行する。
   * ターンが終われば game 側が次の startTurn を呼び、onTurnStart フック
   * 経由で再び beginTurn が走るので、各CPUターンは1本の連鎖で完結する。 */
  runCpuTurn() {
    const g = this.game;
    const p = g.currentPlayer;
    this.setStatus(`🤖 CPU ${'①②③④'[p.order - 1]} 思考中…`);
    this.cpuTimer = setTimeout(() => this._cpuBomb(), CONFIG.CPU_THINK_TIME);
  },

  _cpuBomb() {
    const g = this.game;
    if (g.phase !== PHASE.THROW || !g.currentPlayer.isCPU) return;
    const t = CPU.decideBomb(g);
    g.throwBomb(t.r, t.c);
    this.refresh();
    // 投擲後も自分の手番(移動フェーズ)なら移動へ。CPUが行動不能で脱落した
    // 場合は手番が移っており phase は MOVE でないため、ここでは何もしない。
    if (g.phase === PHASE.MOVE && g.currentPlayer.isCPU) {
      this.updateStatusForPhase();
      this.cpuTimer = setTimeout(() => this._cpuStep(), CONFIG.CPU_THINK_TIME);
    }
  },

  _cpuStep() {
    const g = this.game;
    if (g.phase !== PHASE.MOVE || !g.currentPlayer.isCPU) return;
    const t = CPU.decideStep(g);
    if (!t) return;
    g.step(t.r, t.c);
    this.refresh();
    // まだ同じCPUの移動が続く場合のみ次の1歩を予約する。
    // 3歩終了/脱落でターンが移ると phase は THROW になり連鎖は止まる。
    if (g.phase === PHASE.MOVE && g.currentPlayer.isCPU) {
      this.updateStatusForPhase();
      this.cpuTimer = setTimeout(() => this._cpuStep(), CONFIG.CPU_THINK_TIME);
    }
  },
};

/* ===== 棒人間SVG（顔に行動順の数字を表示） ===== */
function stickFigureSVG(color, num) {
  return `
  <svg viewBox="0 0 100 100" class="stick">
    <!-- 頭 -->
    <circle cx="50" cy="26" r="18" fill="${color}" stroke="#1b1b2f" stroke-width="3"/>
    <text x="50" y="33" text-anchor="middle" font-size="22" font-weight="bold" fill="#fff">${num}</text>
    <!-- 胴体・手足 -->
    <g stroke="${color}" stroke-width="7" stroke-linecap="round" fill="none">
      <line x1="50" y1="44" x2="50" y2="72"/>
      <line x1="50" y1="52" x2="32" y2="64"/>
      <line x1="50" y1="52" x2="68" y2="64"/>
      <line x1="50" y1="72" x2="36" y2="92"/>
      <line x1="50" y1="72" x2="64" y2="92"/>
    </g>
  </svg>`;
}
