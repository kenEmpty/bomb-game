/* =========================================================================
 * cpu.js
 * CPUの思考ルーチン。難易度ごとに「爆弾の投げ先」「1歩の移動先」を返す。
 *   Easy   … 完全ランダム
 *   Normal … 閉じ込められない行動を優先（自分の逃げ道を確保）
 *   Hard   … 移動は3歩先まで全列挙し、終点の「生存率」を重視して選ぶ。
 *            評価の優先度（高い順）：
 *              1. 次に手番が来る相手から爆弾で狙われる位置を避ける
 *              2. 複数の相手から狙われる位置を避ける
 *              3. 自分の移動可能マス数（逃げ道）が多い位置を優先
 *              4. 相手の移動可能マス数を減らす位置を優先
 * 純粋な判断のみを行い、実際の実行（待ち時間・描画）は ui.js が担当する。
 * ========================================================================= */

const CPU = {
  debug: false,    // CPU評価値のデバッグ表示（main.jsの設定で切替）
  lastEval: null,  // 直近のHard移動評価（UIがデバッグ描画に使う）
  _plan: null,     // Hardの移動計画（1ターン分の経路）

  // 評価の重み。優先度が崩れないよう桁を大きく離してある。
  WEIGHTS: {
    NEXT_ATTACK: 1000, // 優先度1：次の敵に撃たれる位置への大ペナルティ
    MULTI_ATTACK: 150, // 優先度2：狙ってくる敵の数ぶんペナルティ
    ALLY_TRAP: 200,    // チーム戦：味方を閉じ込める位置への大ペナルティ
    OWN_MOBILITY: 10,  // 優先度3：自分の逃げ道1マスごとに加点
    OPP_MOBILITY: 2,   // 優先度4：敵の逃げ道1マスごとに減点
    ALLY_BLOCK: 20,    // チーム戦：味方の逃げ道を1つ塞ぐごとに減点
  },

  // Expertの評価重み。勝敗の約96%が「陣地詰み（行動不能）」で決まるため、
  // 撃破系の死に重みを排し、生存エリアの自他差分を主軸にする。
  EXPERT_WEIGHTS: {
    NEXT_ATTACK:  1200, // 即座に撃たれる位置への大ペナルティ（稀だが致命）
    MULTI_ATTACK:  120, // 複数の敵に同時に狙われる追加ペナルティ
    ALLY_TRAP:     250, // 味方を閉じ込める大ペナルティ
    ALLY_BLOCK:     25, // 味方の逃げ道を塞ぐペナルティ
    SURV_SELF:      12, // 自分のBFS生存エリア1マスごとの加点（主軸）
    SURV_OPP:        7, // 敵のBFS生存エリア1マスごとの減点（ミニマックス差分）
    CENTER:        2.5, // 中央寄り度の加点（端・隅の詰みを避ける連続タイブレーク）
  },

  /* 爆弾の投げ先を決める。{r,c} を返す（必ず getBombTargets() の中から選ぶ） */
  decideBomb(game) {
    const self = game.currentPlayer;
    // CPUは味方を攻撃しない（味方攻撃ONでも味方マスは候補から除外）
    let targets = cpuBombTargets(game, self);
    if (!targets.length) targets = game.getBombTargets(); // 万一の保険

    switch (self.difficulty) {
      case 'easy':
        return cpuPick(targets);

      case 'expert':
        return CPU._expertBomb(game, self, targets);

      case 'hard':
        return CPU._hardBomb(game, self, targets);

      case 'normal':
      default: {
        // 倒せる敵がいれば狙う
        const kills = targets.filter(t => isEnemyCell(game, t.r, t.c, self));
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

      case 'expert':
        return CPU._expertStep(game, self, targets);

      case 'hard':
        return CPU._hardStep(game, self, targets);

      case 'normal':
      default:
        // 移動後に最も逃げ道が多いマスを選ぶ（閉じ込められ回避）
        return bestBy(targets, t => mobility(game, t.r, t.c, self.id));
    }
  },

  /* ---- Hardの移動：3歩先まで先読みして生存重視で1歩を返す ---- */
  _hardStep(game, self, targets) {
    // すでに今ターンの計画があり、残り歩数と一致していればそれを踏襲する
    if (CPU._plan && CPU._plan.id === self.id && CPU._plan.queue.length === game.movesLeft) {
      const next = CPU._plan.queue.shift();
      if (targets.some(t => t.r === next.r && t.c === next.c)) return next;
      // 想定外なら作り直す（保険）
    }

    // 残り movesLeft 歩で到達できる「終点」を全列挙
    const paths = enumeratePaths(game, self);
    if (!paths.length) return cpuPick(targets); // 念のため

    // 終点が同じ経路は1つにまとめる
    const uniq = new Map();
    for (const p of paths) {
      const k = key(p.end.r, p.end.c);
      if (!uniq.has(k)) uniq.set(k, p);
    }

    // 各終点を生存重視で評価
    const scored = [...uniq.values()].map(p => {
      const e = CPU._evalEnd(game, p.end, self);
      return { path: p.path, end: p.end, ...e };
    });

    // 最良スコア（同点はランダム）
    let best = -Infinity, pool = [];
    for (const s of scored) {
      if (s.score > best) { best = s.score; pool = [s]; }
      else if (s.score === best) pool.push(s);
    }
    const chosen = cpuPick(pool);
    CPU._plan = { id: self.id, queue: chosen.path.slice() };

    if (CPU.debug) CPU._recordDebug(self, scored, chosen);

    return CPU._plan.queue.shift();
  },

  /* 終点(end)の評価。生存重視のスコアと内訳を返す（高いほど良い）。
   * チーム戦では脅威・標的は「敵チーム」のみとし、味方を塞がない/閉じ込めない。 */
  _evalEnd(game, end, self) {
    const enemies = enemiesOf(game, self);
    const allies = alliesOf(game, self);
    const nextEnemy = nextEnemyAttacker(game, self);

    // この終点を「現在位置から」爆撃できる敵（爆弾は投擲→移動の順なので現在地が脅威）
    const attackers = enemies.filter(p => canBombReach(p.r, p.c, end.r, end.c));
    const nextCanAttack = !!nextEnemy && canBombReach(nextEnemy.r, nextEnemy.c, end.r, end.c);

    // 自分の逃げ道（終点からの移動可能マス数）
    const mob = mobility(game, end.r, end.c, self.id);

    // 敵の逃げ道合計（自分が終点にいると隣接マスを1つ塞ぐ＝減らせる）
    let enemyMobSum = 0;
    for (const p of enemies) {
      let m = mobility(game, p.r, p.c, p.id);
      if (chebyshev(end.r, end.c, p.r, p.c) === 1) m -= 1;
      enemyMobSum += Math.max(0, m);
    }

    // 味方の逃げ道を塞がない／閉じ込めない
    let allyBlock = 0, allyTrap = 0;
    for (const a of allies) {
      if (chebyshev(end.r, end.c, a.r, a.c) === 1 && cellFree(game, end.r, end.c, a.id)) {
        allyBlock += 1; // 味方の逃げ道を1つ塞ぐ
        if (mobility(game, a.r, a.c, a.id) - 1 <= 0) allyTrap += 1; // 味方を閉じ込める
      }
    }

    const W = CPU.WEIGHTS;
    let score = 0;
    if (nextCanAttack) score -= W.NEXT_ATTACK;     // 優先度1：次の敵に撃たれない
    score -= W.MULTI_ATTACK * attackers.length;    // 優先度2：複数の敵に狙われない
    score -= W.ALLY_TRAP * allyTrap;               // 味方を閉じ込めない
    score += W.OWN_MOBILITY * mob;                 // 優先度3：自分の逃げ道を多く
    score -= W.OPP_MOBILITY * enemyMobSum;         // 優先度4：敵の逃げ道を減らす
    score -= W.ALLY_BLOCK * allyBlock;             // 味方の逃げ道を塞がない

    return { score, nextCanAttack, atkCount: attackers.length, mob, oppMobSum: enemyMobSum, allyBlock, allyTrap };
  },

  /* デバッグ用：終点ごとの評価値を保存し、コンソールにも出力 */
  _recordDebug(self, scored, chosen) {
    const cells = scored.map(s => ({
      r: s.end.r, c: s.end.c, score: Math.round(s.score),
      nextAtk: s.nextCanAttack, atk: s.atkCount, mob: s.mob, oppMob: s.oppMobSum,
      allyBlock: s.allyBlock || 0, allyTrap: s.allyTrap || 0,
      chosen: s.end.r === chosen.end.r && s.end.c === chosen.end.c,
    }));
    CPU.lastEval = { id: self.id, order: self.order, cells };
    console.groupCollapsed(`[CPU debug] P${self.order} 移動先評価（${cells.length}候補, スコア最大=${Math.round(chosen.score)}）`);
    console.table(cells.map(c => ({
      行: c.r, 列: c.c, スコア: c.score, 次に撃たれる: c.nextAtk,
      狙う敵数: c.atk, 自由度: c.mob, 敵自由度計: c.oppMob,
      味方塞ぎ: c.allyBlock, 味方閉込: c.allyTrap, 採用: c.chosen,
    })));
    console.groupEnd();
  },

  /* ---- Hard用の爆弾思考（チーム戦では敵チームのみ標的） ---- */
  _hardBomb(game, self, targets) {
    // ① 倒せる敵 → 逃げ道の少ない敵を優先。さらに味方を脅かしている敵を優先（援護）
    const kills = targets.filter(t => isEnemyCell(game, t.r, t.c, self));
    if (kills.length) {
      return bestBy(kills, t => {
        const victim = game.playerAt(t.r, t.c);
        let s = -mobility(game, t.r, t.c, victim.id);
        if (threatensAlly(game, victim, self)) s += 5; // 味方を狙う敵を先に倒す
        return s;
      });
    }

    // ② 敵の逃げ道を減らす：逃げ道が少ない敵の隣接マスを破壊する
    const enemies = enemiesOf(game, self)
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

  /* ---- Expert移動：生存エリアの自他差分＋中央寄りで評価 ---- */
  _expertStep(game, self, targets) {
    if (CPU._plan && CPU._plan.id === self.id && CPU._plan.queue.length === game.movesLeft) {
      const next = CPU._plan.queue.shift();
      if (targets.some(t => t.r === next.r && t.c === next.c)) return next;
    }

    const paths = enumeratePaths(game, self);
    if (!paths.length) return cpuPick(targets);

    const uniq = new Map();
    for (const p of paths) {
      const k = key(p.end.r, p.end.c);
      if (!uniq.has(k)) uniq.set(k, p);
    }

    // 局面ごとに1回だけ計算する共通情報（盤サイズで読み深さを切替）
    const ctx = {
      depth: expertDepth(game),
      enemies: enemiesOf(game, self),
      allies: alliesOf(game, self),
      nextEnemy: nextEnemyAttacker(game, self),
      centerR: (game.rows - 1) / 2,
      centerC: (game.cols - 1) / 2,
      // 自分の開始マスは移動完了時に崩落する＝生存エリア計算では破壊済み扱い
      startDestroyed: new Set([key(game.startCell.r, game.startCell.c)]),
    };

    const scored = [...uniq.values()].map(p => {
      const e = CPU._evalEndExpert(game, p.end, self, ctx);
      return { path: p.path, end: p.end, ...e };
    });

    let best = -Infinity, pool = [];
    for (const s of scored) {
      if (s.score > best) { best = s.score; pool = [s]; }
      else if (s.score === best) pool.push(s);
    }
    const chosen = cpuPick(pool);
    CPU._plan = { id: self.id, queue: chosen.path.slice() };

    if (CPU.debug) CPU._recordDebugExpert(self, scored, chosen, ctx.depth);

    return CPU._plan.queue.shift();
  },

  /* Expert終点評価：自分の生存エリア最大化 ＋ 敵の生存エリア最小化（ミニマックス差分）。
   * 同点を減らすため中央寄り度を連続タイブレークとして加える。 */
  _evalEndExpert(game, end, self, ctx) {
    const EW = CPU.EXPERT_WEIGHTS;
    const { depth, enemies, allies, nextEnemy, startDestroyed } = ctx;

    // 即時脅威（稀だが致命）：現在地から撃てる敵
    let attackers = 0;
    for (const p of enemies) if (canBombReach(p.r, p.c, end.r, end.c)) attackers++;
    const nextCanAttack = !!nextEnemy && canBombReach(nextEnemy.r, nextEnemy.c, end.r, end.c);

    // 自分の生存エリア（開始マス崩落後の盤面で）
    const survArea = survivalAreaEx(game, end.r, end.c, depth, startDestroyed, null);

    // 敵の生存エリア（自分が end に居て1マス塞ぎ＋開始マス崩落の盤面で）
    const blocked = new Set([key(end.r, end.c)]);
    let oppSurvSum = 0;
    for (const p of enemies) {
      oppSurvSum += survivalAreaEx(game, p.r, p.c, depth, startDestroyed, blocked);
    }

    // 中央寄り度（端・隅は崩落で詰みやすい）。連続値なので同点ブレを抑える。
    const central = -chebyshev(end.r, end.c, ctx.centerR, ctx.centerC);

    // 味方への影響（チーム戦のみ）
    let allyBlock = 0, allyTrap = 0;
    for (const a of allies) {
      if (chebyshev(end.r, end.c, a.r, a.c) === 1 && cellFree(game, end.r, end.c, a.id)) {
        allyBlock++;
        if (survivalAreaEx(game, a.r, a.c, 2, startDestroyed, blocked) <= 1) allyTrap++;
      }
    }

    let score = 0;
    if (nextCanAttack) score -= EW.NEXT_ATTACK;
    score -= EW.MULTI_ATTACK * attackers;
    score -= EW.ALLY_TRAP    * allyTrap;
    score -= EW.ALLY_BLOCK   * allyBlock;
    score += EW.SURV_SELF    * survArea;
    score -= EW.SURV_OPP     * oppSurvSum;
    score += EW.CENTER       * central;

    let reason;
    if (nextCanAttack)   reason = '脅威回避(即)';
    else if (attackers)  reason = '被狙い回避';
    else if (oppSurvSum) reason = '生存エリア差最大化';
    else                 reason = '生存エリア確保';

    return { score, nextCanAttack, atkCount: attackers, survArea, oppSurvSum, central, allyBlock, allyTrap, reason };
  },

  /* Expertデバッグ記録 */
  _recordDebugExpert(self, scored, chosen, depth) {
    const cells = scored.map(s => ({
      r: s.end.r, c: s.end.c, score: Math.round(s.score),
      nextAtk: s.nextCanAttack, atk: s.atkCount,
      survArea: s.survArea, oppSurv: s.oppSurvSum, reason: s.reason,
      chosen: s.end.r === chosen.end.r && s.end.c === chosen.end.c,
    }));
    CPU.lastEval = { id: self.id, order: self.order, cells, isExpert: true };
    console.groupCollapsed(`[CPU Expert] P${self.order} 移動評価（${cells.length}候補, 最高=${Math.round(chosen.score)}, 読み${depth}手）`);
    console.table(cells.map(c => ({
      行: c.r, 列: c.c, スコア: c.score, 自エリア: c.survArea,
      敵エリア計: c.oppSurv, 理由: c.reason, 採用: c.chosen,
    })));
    console.groupEnd();
  },

  /* ---- Expert爆弾：毎ターン1マス必ず壊せる利点を「敵を詰ませる」ために使う。
   *  ① 倒せる敵がいれば仕留める（無料勝利）
   *  ② 敵の生存エリアを最も削る投擲（自分の逃げ道は削らない）。
   *     削れない開幕は敵側のマスを優先して崩し、徐々に追い込む下地を作る。 */
  _expertBomb(game, self, targets) {
    // ① 倒せる敵 → 生存エリア最小の敵（最も追い詰められた敵）を優先
    const kills = targets.filter(t => isEnemyCell(game, t.r, t.c, self));
    if (kills.length) {
      return bestBy(kills, t => {
        const victim = game.playerAt(t.r, t.c);
        let s = -survivalArea(game, t.r, t.c, victim.id, 3);
        if (threatensAlly(game, victim, self)) s += 5;
        return s;
      });
    }

    const depth = expertDepth(game);
    const enemies = enemiesOf(game, self);

    // ② 敵エリアを最も削る投擲を選ぶ。
    //    score = 敵エリア減少 ×10 ＋ 敵への近さ − 自分の逃げ道への悪影響
    let bestTarget = null, bestScore = -Infinity;
    for (const t of targets) {
      if (game.grid[t.r][t.c] !== CELL.NORMAL || game.playerAt(t.r, t.c)) continue;
      const dz = new Set([key(t.r, t.c)]);

      let oppLoss = 0;
      for (const e of enemies) {
        const before = survivalAreaEx(game, e.r, e.c, depth, null, null);
        const after  = survivalAreaEx(game, e.r, e.c, depth, dz, null);
        oppLoss += Math.max(0, before - after);
      }
      // 開幕は減らせないので、敵に近いマスを崩して追い込みの下地を作る
      let nearEnemy = 0;
      for (const e of enemies) nearEnemy += Math.max(0, 4 - chebyshev(t.r, t.c, e.r, e.c));
      // 自分の隣接（逃げ道）を壊すのは避ける
      const selfPenalty = chebyshev(t.r, t.c, self.r, self.c) === 1 ? 15 : 0;

      const s = oppLoss * 10 + nearEnemy - selfPenalty;
      if (s > bestScore) { bestScore = s; bestTarget = t; }
    }
    if (bestTarget && bestScore > 0) return bestTarget;

    // ③ 安全投擲（自分の逃げ道を削らない）
    return CPU._safeBomb(game, self, targets);
  },

  /* 自分の隣接マス（＝逃げ道）を壊さない、効果のある投擲先を選ぶ */
  _safeBomb(game, self, targets) {
    let pool = targets.filter(t => game.grid[t.r][t.c] === CELL.NORMAL);
    if (!pool.length) pool = targets;
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

// 指定マスに「敵」がいるか（チーム戦では味方を除外）
function isEnemyCell(game, r, c, self) {
  const o = game.playerAt(r, c);
  return !!o && o.id !== self.id && !game.areAllies(o, self);
}

// 敵プレイヤー一覧（チーム戦では敵チームのみ。個人戦では自分以外全員）
function enemiesOf(game, self) {
  return game.players.filter(p => p.alive && p.id !== self.id && !game.areAllies(p, self));
}

// 味方プレイヤー一覧（個人戦では空。自分は含まない）
function alliesOf(game, self) {
  return game.players.filter(p => p.alive && p.id !== self.id && game.areAllies(p, self));
}

// この敵が self の味方を爆撃で脅かしているか（援護判断用）
function threatensAlly(game, enemy, self) {
  return alliesOf(game, self).some(a => canBombReach(enemy.r, enemy.c, a.r, a.c));
}

// CPUの爆弾候補（味方マスは常に除外＝CPUは味方を攻撃しない）
function cpuBombTargets(game, self) {
  return game.getBombTargets().filter(t => {
    const occ = game.playerAt(t.r, t.c);
    return !(occ && occ.id !== self.id && game.areAllies(occ, self));
  });
}

// (fr,fc) から (tr,tc) を爆弾で狙えるか（8方向・射程1〜MAX。途中マスは飛び越える）
function canBombReach(fr, fc, tr, tc) {
  const dr = tr - fr, dc = tc - fc;
  const adr = Math.abs(dr), adc = Math.abs(dc);
  if (!(dr === 0 || dc === 0 || adr === adc)) return false; // 8方向以外は不可
  const dist = Math.max(adr, adc);
  return dist >= 1 && dist <= CONFIG.BOMB_MAX_RANGE;
}

// 現在の手番プレイヤーの次に手番が来る「敵」プレイヤー（いなければnull）。
// 爆弾で最初に狙ってくる脅威。味方はスキップする。
function nextEnemyAttacker(game, self) {
  const n = game.turnOrder.length;
  for (let i = 1; i <= n; i++) {
    const p = game.players[game.turnOrder[(game.turnPtr + i) % n]];
    if (p.alive && p.id !== self.id && !game.areAllies(p, self)) return p;
  }
  return null;
}

// 現在位置から「残り movesLeft 歩」で到達できる全経路を列挙（ゲームの移動規則に準拠）
function enumeratePaths(game, self) {
  const allowRevisit = game.settings.allowRevisit;
  const results = [];
  const baseVisited = new Set(game.visited);

  function legalNeighbors(r, c, visited, movesLeftHere) {
    const out = [];
    for (const d of CONFIG.DIRS_8) {
      const nr = r + d.dr, nc = c + d.dc;
      if (!game.inField(nr, nc)) continue;
      if (game.grid[nr][nc] === CELL.DESTROYED) continue;
      const occ = game.playerAt(nr, nc);
      // 最終歩のみ他プレイヤーのマスへの停止を禁止（途中通過はOK）
      if (occ && occ.id !== self.id && movesLeftHere === 1) continue;
      // 最後の1歩では開始マスに留まれない（移動後に破壊されるため）
      if (movesLeftHere === 1 && nr === game.startCell.r && nc === game.startCell.c) continue;
      if (!allowRevisit && visited.has(key(nr, nc))) continue; // 再訪禁止
      out.push({ r: nr, c: nc });
    }
    return out;
  }

  function dfs(r, c, visited, remaining, path) {
    if (remaining === 0) { results.push({ end: { r, c }, path }); return; }
    for (const nb of legalNeighbors(r, c, visited, remaining)) {
      let nv = visited;
      if (!allowRevisit) { nv = new Set(visited); nv.add(key(nb.r, nb.c)); }
      dfs(nb.r, nb.c, nv, remaining - 1, path.concat([nb]));
    }
  }

  dfs(self.r, self.c, baseVisited, game.movesLeft, []);
  return results;
}

// BFS で (r,c) から maxSteps 歩以内に到達できるマス数（壊れていないマスを計上）
function survivalArea(game, r, c, selfId, maxSteps) {
  return survivalAreaEx(game, r, c, maxSteps, null, null);
}

/* BFS生存エリアの汎用版。
 *   extraDestroyed: 一時的に破壊済み扱いするマスのSet（"r,c"キー。例:自分の崩落マス）
 *   blocked       : 進入不可とみなすマスのSet（例:自分が居座って塞ぐマス）
 * depth 歩以内に到達できる（自マス除く）マス数を返す。 */
function survivalAreaEx(game, r, c, depth, extraDestroyed, blocked) {
  const visited = new Set();
  visited.add(key(r, c));
  let frontier = [{ r, c }];
  for (let step = 0; step < depth && frontier.length > 0; step++) {
    const next = [];
    for (const pos of frontier) {
      for (const d of CONFIG.DIRS_8) {
        const nr = pos.r + d.dr, nc = pos.c + d.dc, k = key(nr, nc);
        if (visited.has(k)) continue;
        if (!game.inField(nr, nc) || game.grid[nr][nc] === CELL.DESTROYED) continue;
        if (extraDestroyed && extraDestroyed.has(k)) continue;
        if (blocked && blocked.has(k)) continue;
        visited.add(k);
        next.push({ r: nr, c: nc });
      }
    }
    frontier = next;
  }
  return visited.size - 1; // 自分のいるマスを除く
}

// 盤サイズに応じたExpertのBFS読み深さ（狭盤は浅く、広盤は深く）
function expertDepth(game) {
  const cells = game.rows * game.cols;
  if (cells <= 64) return 3;   // small 8×7=56
  if (cells <= 100) return 4;  // medium 10×9=90
  return 5;                    // large 12×10=120
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
