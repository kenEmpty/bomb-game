/* =========================================================================
 * game.js
 * ゲームの状態とルールロジック（描画には依存しない純粋なモデル層）。
 * UI からはメソッドを呼び出し、結果はコールバックで受け取る設計にして
 * 将来のルール追加・UI差し替えをしやすくしている。
 * ========================================================================= */

class Game {
  /**
   * @param {Object} settings 設定画面で選ばれた内容
   *   { size, players:[{isCPU,difficulty}], obstacles, allowRevisit }
   * @param {Object} hooks UIへ通知するコールバック群（省略可）
   */
  constructor(settings, hooks = {}) {
    this.settings = settings;
    this.hooks = hooks;

    const dim = CONFIG.FIELD_SIZES[settings.size];
    this.cols = dim.cols;
    this.rows = dim.rows;

    // グリッド初期化（全マス通常）
    this.grid = [];
    for (let r = 0; r < this.rows; r++) {
      this.grid.push(new Array(this.cols).fill(CELL.NORMAL));
    }

    // チーム定義（チーム戦のみ）。チーム数は settings.teamCount で可変。
    this.teams = [];
    if (settings.mode === 'team') {
      const tc = settings.teamCount || 2;
      for (let i = 0; i < tc; i++) {
        this.teams.push({ id: i, name: CONFIG.TEAMS[i].name, color: CONFIG.TEAMS[i].color });
      }
    }

    this._setupPlayers();
    this._setupObstacles();

    // ターン状態
    this.round = 1;            // ラウンド数（全員1巡で+1）
    this.turnPtr = 0;          // turnOrder内の現在位置
    this.phase = PHASE.THROW;
    this.movesLeft = 0;        // 移動フェーズの残り歩数
    this.startCell = null;     // ターン開始時に立っていたマス
    this.visited = new Set();  // 同一ターンで通過したマス（再訪禁止用）
  }

  /* ---- 初期化系 ---------------------------------------------------- */

  // プレイヤー生成・行動順のランダム決定・四隅への配置
  _setupPlayers() {
    const n = this.settings.players.length;

    // 四隅（左上→右上→左下→右下の順で使用）
    const corners = [
      { r: 0, c: 0 },
      { r: 0, c: this.cols - 1 },
      { r: this.rows - 1, c: 0 },
      { r: this.rows - 1, c: this.cols - 1 },
    ];

    // プレイヤー番号(識別)は設定の並び順で固定（P1=1人目, P2=2人目, …）。
    // 四隅・色も番号に対応させ、毎ゲーム同じ「席」になるようにする。
    this.players = [];
    for (let i = 0; i < n; i++) {
      const conf = this.settings.players[i];
      this.players.push({
        id: i,                       // 内部ID（=識別番号 0始まり）
        order: i + 1,                // 顔に表示する番号（プレイヤー識別 1始まり）
        r: corners[i].r,
        c: corners[i].c,
        alive: true,
        isCPU: conf.isCPU,
        difficulty: conf.difficulty,
        color: CONFIG.PLAYER_COLORS[i],
        team: null,                  // 所属チーム（個人戦ではnull）
      });
    }

    this._assignTeams();

    // 行動順だけをランダムに決定（先行プレイヤーが毎回同じにならないように）。
    // turnOrder には「これから手番が回る順」のプレイヤーIDが入る。
    this.turnOrder = shuffle(this.players.map(p => p.id));
  }

  // チーム分け（チーム戦のみ）。ランダム or 手動。
  _assignTeams() {
    if (this.settings.mode !== 'team') return;
    const n = this.players.length;
    const tc = this.settings.teamCount || 2;

    if (this.settings.teamMode === 'random') {
      // シャッフルした順に均等割り当て（毎ゲーム組み合わせが変わる）
      const order = shuffle([...Array(n).keys()]);
      order.forEach((pIdx, k) => { this.players[pIdx].team = k % tc; });
    } else {
      // 手動：設定で指定されたチーム（範囲外はクランプ）
      for (let i = 0; i < n; i++) {
        const t = this.settings.players[i].team ?? 0;
        this.players[i].team = Math.max(0, Math.min(tc - 1, t));
      }
    }
  }

  // 2人が味方同士か（チーム戦のみ。個人戦では常にfalse）
  areAllies(a, b) {
    return this.settings.mode === 'team' && a.team === b.team;
  }

  // ランダム障害物の配置（ON時のみ）
  _setupObstacles() {
    if (!this.settings.obstacles) return;

    // 保護マス：各プレイヤーの初期位置とその隣接8マス
    const protectedSet = new Set();
    for (const p of this.players) {
      protectedSet.add(key(p.r, p.c));
      for (const d of CONFIG.DIRS_8) {
        protectedSet.add(key(p.r + d.dr, p.c + d.dc));
      }
    }

    // 配置可能な候補マス
    const candidates = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!protectedSet.has(key(r, c))) candidates.push({ r, c });
      }
    }

    // 2〜4マスをランダムに破壊
    const count = randInt(CONFIG.OBSTACLE_MIN, CONFIG.OBSTACLE_MAX);
    shuffle(candidates);
    for (let i = 0; i < count && i < candidates.length; i++) {
      this.grid[candidates[i].r][candidates[i].c] = CELL.DESTROYED;
    }
  }

  /* ---- 参照系ヘルパー ---------------------------------------------- */

  get currentPlayer() {
    return this.players[this.turnOrder[this.turnPtr]];
  }

  get aliveCount() {
    return this.players.filter(p => p.alive).length;
  }

  inField(r, c) {
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols;
  }

  // 指定マスにいる生存プレイヤー（いなければnull）
  playerAt(r, c) {
    return this.players.find(p => p.alive && p.r === r && p.c === c) || null;
  }

  /* ---- ターン進行 -------------------------------------------------- */

  // 新しいターンを開始（手番プレイヤーの準備）
  startTurn() {
    if (this.phase === PHASE.OVER) return;

    const p = this.currentPlayer;
    this.startCell = { r: p.r, c: p.c };
    this.phase = PHASE.THROW;
    this.movesLeft = CONFIG.MOVE_STEPS;
    this.visited = new Set([key(p.r, p.c)]);

    // 爆弾を投げられるマスが1つも無い（周囲が破壊済み/場外のみ）＝行動不能で脱落
    if (this.getBombTargets().length === 0) {
      this._eliminate(p, 'stuck');
      this.endTurn();
      return;
    }

    if (this.hooks.onTurnStart) this.hooks.onTurnStart(p);
  }

  // 爆弾を投げられる候補マス一覧（8方向 × 射程1〜MAX）
  getBombTargets() {
    const p = this.currentPlayer;
    // 味方攻撃OFFのチーム戦では、味方のいるマスには投げられない
    const protectAllies = this.settings.mode === 'team' && !this.settings.friendlyFire;
    const targets = [];
    for (const d of CONFIG.DIRS_8) {
      for (let dist = 1; dist <= CONFIG.BOMB_MAX_RANGE; dist++) {
        const r = p.r + d.dr * dist;
        const c = p.c + d.dc * dist;
        if (!this.inField(r, c)) continue;
        if (this.grid[r][c] === CELL.DESTROYED) continue; // 破壊済みマスには投げられない
        if (protectAllies) {
          const occ = this.playerAt(r, c);
          if (occ && occ.id !== p.id && this.areAllies(occ, p)) continue; // 味方マスは除外
        }
        targets.push({ r, c, dist });
      }
    }
    return targets;
  }

  // 指定マスへ爆弾を投げる（フェーズ=THROW のときのみ）
  throwBomb(r, c) {
    if (this.phase !== PHASE.THROW) return false;
    const valid = this.getBombTargets().some(t => t.r === r && t.c === c);
    if (!valid) return false;

    // 命中判定（着弾マスにプレイヤーがいれば脱落）
    const victim = this.playerAt(r, c);
    if (victim && victim.id !== this.currentPlayer.id) {
      this._eliminate(victim, 'bomb');
    }

    // 地形破壊
    this.grid[r][c] = CELL.DESTROYED;
    if (this.hooks.onBomb) this.hooks.onBomb({ r, c }, this.currentPlayer, victim);

    // 命中で勝敗が決した場合
    if (this._checkWin()) return true;

    // 移動フェーズへ
    this.phase = PHASE.MOVE;
    this._afterEnterMovePhase();
    return true;
  }

  // 現在位置から移動可能な隣接マス一覧
  getMoveTargets() {
    const p = this.currentPlayer;
    const targets = [];
    for (const d of CONFIG.DIRS_8) {
      const r = p.r + d.dr;
      const c = p.c + d.dc;
      if (!this.inField(r, c)) continue;             // フィールド外
      if (this.grid[r][c] === CELL.DESTROYED) continue; // 破壊済み
      if (this.playerAt(r, c)) continue;             // 他プレイヤー
      // 最後の1歩では開始マスに留まれない（移動後に破壊されるため）。
      // 途中の通過・再訪はOK。
      if (this.movesLeft === 1 && this.startCell &&
          r === this.startCell.r && c === this.startCell.c) continue;
      if (!this.settings.allowRevisit && this.visited.has(key(r, c))) continue; // 再訪禁止
      targets.push({ r, c });
    }
    return targets;
  }

  // 移動フェーズに入った直後／1歩進むたびに行動可能かチェック
  _afterEnterMovePhase() {
    if (this.getMoveTargets().length === 0) {
      // 動けない＝行動不能で脱落
      this._eliminate(this.currentPlayer, 'stuck');
      this.endTurn();
    }
  }

  // 指定マスへ1歩移動（フェーズ=MOVE のときのみ）
  step(r, c) {
    if (this.phase !== PHASE.MOVE) return false;
    const valid = this.getMoveTargets().some(t => t.r === r && t.c === c);
    if (!valid) return false;

    const p = this.currentPlayer;
    p.r = r;
    p.c = c;
    this.visited.add(key(r, c));
    this.movesLeft--;

    if (this.hooks.onMove) this.hooks.onMove(p);

    if (this.movesLeft <= 0) {
      this._finishMove();       // 3歩終了
    } else {
      this._afterEnterMovePhase(); // 次の1歩が可能か確認
    }
    return true;
  }

  // 3歩移動を終えた後：開始マスを破壊してターン終了
  _finishMove() {
    const s = this.startCell;
    this.grid[s.r][s.c] = CELL.DESTROYED;
    if (this.hooks.onDestroyStart) this.hooks.onDestroyStart(s);
    this.endTurn();
  }

  // ターン終了 → 次の手番へ（勝敗判定込み）
  endTurn() {
    if (this._checkWin()) return;
    this._advancePtr();
    this.startTurn();
  }

  // 次の生存プレイヤーへ手番を進める
  _advancePtr() {
    const n = this.turnOrder.length;
    for (let i = 0; i < n; i++) {
      this.turnPtr++;
      if (this.turnPtr >= n) {
        this.turnPtr = 0;
        this.round++; // 一巡したらラウンド+1
      }
      if (this.currentPlayer.alive) return;
    }
  }

  /* ---- 脱落・勝利 -------------------------------------------------- */

  _eliminate(player, reason) {
    if (!player.alive) return;
    player.alive = false;
    if (this.hooks.onEliminate) this.hooks.onEliminate(player, reason);
  }

  // 生存しているチームID一覧（チーム戦のみ）
  aliveTeams() {
    return [...new Set(this.players.filter(p => p.alive).map(p => p.team))];
  }

  // 勝者が決まったらtrueを返す。勝敗確定時は onWin に結果オブジェクトを渡す。
  //   個人戦: { type:'player'|'draw', player }
  //   チーム戦: { type:'team'|'draw', team }
  _checkWin() {
    if (this.settings.mode === 'team') {
      const teams = this.aliveTeams();
      if (teams.length <= 1) {
        this.phase = PHASE.OVER;
        const team = teams.length === 1 ? this.teams[teams[0]] : null;
        if (this.hooks.onWin) this.hooks.onWin(team ? { type: 'team', team } : { type: 'draw' });
        return true;
      }
      return false;
    }

    // 個人戦
    if (this.aliveCount <= 1) {
      this.phase = PHASE.OVER;
      const player = this.players.find(p => p.alive) || null;
      if (this.hooks.onWin) this.hooks.onWin(player ? { type: 'player', player } : { type: 'draw' });
      return true;
    }
    return false;
  }
}

/* ===== 汎用ユーティリティ ===== */

// "r,c" の文字列キー（Setで座標を扱うため）
function key(r, c) { return r + ',' + c; }

// min〜max の整数乱数（両端含む）
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// 配列をその場でシャッフルして返す（Fisher–Yates）
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
