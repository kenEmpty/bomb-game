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
    this.finalKillInProgress = false; // 最終撃破シーケンス状態をリセット
    this._winPresent = null;
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
    if (typeof CPU !== 'undefined') CPU.lastEval = null; // 前ターンのデバッグ表示を消す
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
        cell.classList.remove('hl-bomb', 'hl-move', 'predict', 'predict-crack', 'predict-collapse');
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
      // チーム戦：足元にチームカラーの帯を表示
      const teamFlag = (g.settings.mode === 'team' && p.team != null)
        ? `<span class="team-flag" style="background:${g.teams[p.team].color}"></span>` : '';
      token.innerHTML = badge + stickFigureSVG(p.color, p.order) + teamFlag;
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

    // 崩壊予定マス：移動フェーズ中、開始マスを歩数に合わせて段階表示する。
    // （内部ルールは変更せず、正式な破壊は3歩完了時の _finishMove のまま）
    //   移動開始(3歩残) → 予定 / 1歩完了(2歩残) → ヒビ / 2歩完了(1歩残) → 崩壊
    if (g.phase === PHASE.MOVE && g.startCell &&
        g.grid[g.startCell.r][g.startCell.c] !== CELL.DESTROYED) {
      const sc = this.cellEl(g.startCell.r, g.startCell.c);
      if (sc) {
        if (g.movesLeft >= 3) sc.classList.add('predict');
        else if (g.movesLeft === 2) sc.classList.add('predict-crack');
        else if (g.movesLeft === 1) sc.classList.add('predict-collapse');
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
    this.renderCpuDebug();
  },

  /* CPU評価値のデバッグ表示（Hardの移動先候補にスコアを重ねる） */
  renderCpuDebug() {
    if (typeof CPU === 'undefined' || !CPU.debug || !CPU.lastEval) return;
    for (const c of CPU.lastEval.cells) {
      const el = this.cellEl(c.r, c.c);
      if (!el) continue;
      const tag = document.createElement('div');
      tag.className = 'cpu-dbg' + (c.chosen ? ' chosen' : '') + (c.nextAtk ? ' danger' : '');
      tag.textContent = c.score;
      el.appendChild(tag);
    }
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

    const makeChip = (p) => {
      const chip = document.createElement('div');
      chip.className = 'pchip';
      if (!p.alive) chip.classList.add('dead');
      else if (p.id === cur.id) chip.classList.add('current');
      chip.style.setProperty('--pcolor', p.color);
      chip.innerHTML =
        `<span class="pchip-face">${'①②③④'[p.order - 1]}</span>` +
        `<span class="pchip-label">${this.playerLabel(p, humanCount)}</span>`;
      return chip;
    };

    if (g.settings.mode === 'team') {
      // チームごとにまとめて表示（チームカラー付き）
      el.classList.add('team-mode');
      for (const team of g.teams) {
        const members = g.players.filter(p => p.team === team.id);
        if (!members.length) continue;
        const group = document.createElement('div');
        group.className = 'team-group';
        group.style.setProperty('--tcolor', team.color);
        // 全滅したチームはグループごとにグレーアウト
        if (!members.some(p => p.alive)) group.classList.add('team-dead');
        const label = document.createElement('span');
        label.className = 'team-name';
        label.textContent = team.name + 'チーム';
        group.appendChild(label);
        for (const p of members) group.appendChild(makeChip(p));
        el.appendChild(group);
      }
    } else {
      el.classList.remove('team-mode');
      for (const p of g.players) el.appendChild(makeChip(p));
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

  // 爆弾投擲：投げた人→着弾マスへ飛ばし、着弾で爆発。命中時はシェイク＋KO演出も。
  fxThrow(thrower, target, victim) {
    const g = this.game;
    // この命中で決着するか（victim脱落済みなので生存状況で判定）。onWinより前に確定させる。
    const over = g.settings.mode === 'team' ? g.aliveTeams().length <= 1 : g.aliveCount <= 1;
    const isFinal = !!victim && over;
    if (isFinal) this.finalKillInProgress = true; // onWin に即時表示させない

    const from = this.cellCenter(thrower.r, thrower.c);
    const to = this.cellCenter(target.r, target.c);
    const dur = 380 / CONFIG.ANIM_SPEED;
    const bomb = this.spawnFx('fx-bomb', '💣', from.x, from.y, dur + 50);
    Sound.play('throw');
    requestAnimationFrame(() => {
      bomb.style.transitionDuration = dur + 'ms';
      bomb.style.left = to.x + 'px';
      bomb.style.top = to.y + 'px';
    });

    setTimeout(() => {
      if (victim) {
        this.fxKill(target.r, target.c, isFinal); // 撃破演出（爆発＋シェイク＋KO）
      } else {
        this.fxExplode(target.r, target.c, 0);    // 通常の地形破壊（シェイク無し）
        Sound.play('explode');
      }
    }, dur);
  },

  /* プレイヤー撃破の共通演出：爆発 → シェイク → KO。最終なら大爆発＋強シェイク後に勝利画面。
   * 爆弾命中・行動不能（投げ場/移動先なし）どちらの脱落でも使う。 */
  fxKill(r, c, isFinal) {
    this.fxExplode(r, c, isFinal ? 2 : 1);
    Sound.play(isFinal ? 'boomBig' : 'boom');
    this.shake(isFinal ? 'strong' : 'normal');
    this.fxKO(r, c, isFinal);
    if (isFinal) setTimeout(() => this._runWin(), 400 + 500); // 強シェイク→0.5s静止→勝利
  },

  // 爆発エフェクト（閃光・爆風リング・コア・火花・破片）。intensity:0通常 1撃破 2最終
  fxExplode(r, c, intensity = 0) {
    const p = this.cellCenter(r, c);
    const cell = this.cellEl(r, c);
    const size = cell ? cell.getBoundingClientRect().width : 30;
    const scale = 1 + intensity * 0.35;
    this._burst('fx-flash', p.x, p.y, size * 2.0 * scale, 300); // 閃光
    this._burst('fx-ring', p.x, p.y, size * 1.1 * scale, 500);  // 爆風リング
    this._burst('fx-core', p.x, p.y, size * 1.1 * scale, 360);  // 火球コア
    const sparks = 7 + intensity * 3;
    for (let i = 0; i < sparks; i++) this._particle('fx-spark', p.x, p.y, size, scale, false);
    const debris = 5 + intensity * 2;
    for (let i = 0; i < debris; i++) this._particle('fx-debris', p.x, p.y, size, scale, true);
  },

  // CSSアニメで弾ける円形エフェクト（閃光・リング・コア）
  _burst(cls, x, y, d, life) {
    const el = document.createElement('div');
    el.className = 'fx ' + cls;
    el.style.left = x + 'px'; el.style.top = y + 'px';
    el.style.width = d + 'px'; el.style.height = d + 'px';
    el.style.animationDuration = (life / CONFIG.ANIM_SPEED) + 'ms';
    this.boardEl.appendChild(el);
    setTimeout(() => el.remove(), life / CONFIG.ANIM_SPEED + 60);
  },

  // 中心から飛び散るパーティクル（火花/破片）。transformのみで軽量。
  _particle(cls, x, y, size, scale, gravity) {
    const el = document.createElement('div');
    el.className = 'fx ' + cls;
    el.style.left = x + 'px'; el.style.top = y + 'px';
    this.boardEl.appendChild(el);
    const ang = Math.random() * Math.PI * 2;
    const dist = size * (0.6 + Math.random() * 1.1) * scale;
    const dx = Math.cos(ang) * dist;
    let dy = Math.sin(ang) * dist;
    if (gravity) dy += size * (0.4 + Math.random() * 0.8); // 破片は落下
    const rot = (Math.random() * 720 - 360) | 0;
    const dur = (gravity ? 520 : 420) / CONFIG.ANIM_SPEED;
    requestAnimationFrame(() => {
      el.style.transition = `transform ${dur}ms cubic-bezier(.15,.6,.3,1), opacity ${dur}ms ease-out`;
      el.style.transform = `translate(-50%,-50%) translate(${dx}px,${dy}px) rotate(${rot}deg)`;
      el.style.opacity = '0';
    });
    setTimeout(() => el.remove(), dur + 60);
  },

  // 画面シェイク（撃破時のみ使用）。strength: 'normal'(~0.2s) / 'strong'(~0.4s)
  shake(strength) {
    const el = document.getElementById('board-wrap');
    if (!el) return;
    const cls = strength === 'strong' ? 'shake-strong' : 'shake';
    el.classList.remove('shake', 'shake-strong');
    void el.offsetWidth; // リフローでアニメ再始動
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), (strength === 'strong' ? 420 : 230));
  },

  // 脱落テキスト（爆弾命中・行動不能 共通）
  fxKO(r, c, big) {
    const p = this.cellCenter(r, c);
    this.spawnFx('fx-ko' + (big ? ' big' : ''), big ? 'K.O.!!' : 'OUT!', p.x, p.y, 1000 / CONFIG.ANIM_SPEED);
    Sound.play('ko');
  },

  /* ---- 勝利画面の表示タイミング制御 -------------------------------- *
   * 最終撃破時は「大爆発→強シェイク→脱落→0.5s静止」の後に表示する。
   * onWin から渡された表示関数を、シーケンス完了まで保留する。 */
  scheduleWin(presentFn) {
    this._winPresent = presentFn;
    if (this.finalKillInProgress) return; // fxThrow 側のシーケンスが後で _runWin を呼ぶ
    setTimeout(() => this._runWin(), 500); // 通常決着（行動不能など）は少し待って表示
  },
  _runWin() {
    this.finalKillInProgress = false;
    if (this._winPresent) { const f = this._winPresent; this._winPresent = null; f(); }
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
