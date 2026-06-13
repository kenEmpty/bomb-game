/* =========================================================================
 * cpu.js
 * CPUの思考ルーチン。難易度ごとに「爆弾の投げ先」「1歩の移動先」を返す。
 *   Easy   … 完全ランダム
 *   Normal … 閉じ込められない行動を優先（自分の逃げ道を確保）
 *   Hard   … ①倒せる相手を倒す ②相手の逃げ道を減らす ③自分の安全地帯を確保
 * 純粋な判断のみを行い、実際の実行（待ち時間・描画）は ui.js が担当する。
 * ========================================================================= */

const CPU = {
  /* 爆弾の投げ先を決める。{r,c} を返す（必ず getBombTargets() の中から選ぶ） */
  decideBomb(game) {
    const self = game.currentPlayer;
    const targets = game.getBombTargets();

    switch (self.difficulty) {
      case 'easy':
        return cpuPick(targets);

      case 'hard':
        return CPU._hardBomb(game, self, targets);

      case 'normal':
      default: {
        // 倒せる相手がいれば狙う
        const kills = targets.filter(t => isEnemyAt(game, t.r, t.c, self.id));
        if (kills.length) return cpuPick(kills);
        // いなければ自分の逃げ道を削らない安全な投擲
        return CPU._safeBomb(game, self, targets);
      }
    }
  },

  /* 1歩分の移動先を決める。{r,c} か、移動不可なら null */
  decideStep(game) {
    const self = game.currentPlayer;
    const targets = game.getMoveTargets();
    if (!targets.length) return null;

    switch (self.difficulty) {
      case 'easy':
        return cpuPick(targets);

      case 'hard':
        // 逃げ道(機動力)が多く、かつ敵から遠い安全地帯を選ぶ
        return bestBy(targets, t =>
          mobility(game, t.r, t.c, self.id) * 2 +
          Math.min(nearestEnemyDist(game, t.r, t.c, self.id), 4));

      case 'normal':
      default:
        // 移動後に最も逃げ道が多いマスを選ぶ（閉じ込められ回避）
        return bestBy(targets, t => mobility(game, t.r, t.c, self.id));
    }
  },

  /* ---- Hard用の爆弾思考 ---- */
  _hardBomb(game, self, targets) {
    // ① 倒せる相手（射程内に敵）→ 最も逃げ道の少ない弱った相手を優先
    const kills = targets.filter(t => isEnemyAt(game, t.r, t.c, self.id));
    if (kills.length) {
      return bestBy(kills, t => -mobility(game, t.r, t.c, self.id));
    }

    // ② 相手の逃げ道を減らす：逃げ道が少ない敵の隣接マスを破壊する
    const enemies = game.players
      .filter(p => p.alive && p.id !== self.id)
      .sort((a, b) => mobility(game, a.r, a.c, a.id) - mobility(game, b.r, b.c, b.id));
    for (const e of enemies) {
      const opts = targets.filter(t =>
        chebyshev(t.r, t.c, e.r, e.c) === 1 &&
        game.grid[t.r][t.c] === CELL.NORMAL &&
        !game.playerAt(t.r, t.c));
      if (opts.length) return cpuPick(opts);
    }

    // ③ 自分の安全確保（逃げ道を削らない投擲）
    return CPU._safeBomb(game, self, targets);
  },

  /* 自分の隣接マス（＝逃げ道）を壊さない、効果のある投擲先を選ぶ */
  _safeBomb(game, self, targets) {
    // 効果のある通常マスを優先
    let pool = targets.filter(t => game.grid[t.r][t.c] === CELL.NORMAL);
    if (!pool.length) pool = targets;
    // 自分から離れた（隣接でない）マスを優先
    const far = pool.filter(t => chebyshev(t.r, t.c, self.r, self.c) > 1);
    return cpuPick(far.length ? far : pool);
  },
};

/* ===== 評価用ヘルパー ===== */

// (r,c) が移動・通過可能か（selfは自分の現在地を空きとして扱う）
function cellFree(game, r, c, selfId) {
  if (!game.inField(r, c)) return false;
  if (game.grid[r][c] === CELL.DESTROYED) return false;
  const occ = game.playerAt(r, c);
  if (occ && occ.id !== selfId) return false;
  return true;
}

// (r,c) の周囲8方向で進入可能なマス数（機動力＝逃げ道の多さ）
function mobility(game, r, c, selfId) {
  let n = 0;
  for (const d of CONFIG.DIRS_8) {
    if (cellFree(game, r + d.dr, c + d.dc, selfId)) n++;
  }
  return n;
}

// (r,c) から最も近い敵までのチェビシェフ距離
function nearestEnemyDist(game, r, c, selfId) {
  let best = Infinity;
  for (const p of game.players) {
    if (!p.alive || p.id === selfId) continue;
    best = Math.min(best, chebyshev(r, c, p.r, p.c));
  }
  return best === Infinity ? 99 : best;
}

// 指定マスに自分以外の生存プレイヤーがいるか
function isEnemyAt(game, r, c, selfId) {
  const o = game.playerAt(r, c);
  return !!o && o.id !== selfId;
}

// チェビシェフ距離（8方向の歩数）
function chebyshev(r1, c1, r2, c2) {
  return Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2));
}

// 配列からランダムに1つ
function cpuPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// スコア関数が最大の要素を返す（同点はランダム）
function bestBy(arr, scoreFn) {
  let best = -Infinity;
  let pool = [];
  for (const item of arr) {
    const s = scoreFn(item);
    if (s > best) { best = s; pool = [item]; }
    else if (s === best) { pool.push(item); }
  }
  return cpuPick(pool);
}
