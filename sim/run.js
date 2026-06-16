/* =========================================================================
 * sim/run.js — CPU対戦シミュレーション（Hard vs Expert 定量評価）
 *
 * 実ゲームの config.js / game.js / cpu.js をそのまま読み込み、UIなしで
 * CPU同士を多数対戦させて統計を取る。乱数はNode側のMath.randomを使用。
 *
 *   実行: node sim/run.js [games]
 * ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---- エンジン読み込み（config + game + cpu を1スコープに結合） ---- */
const ROOT = path.join(__dirname, '..');
const src = ['js/config.js', 'js/game.js', 'js/cpu.js']
  .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'))
  .join('\n');

// 結合スクリプト末尾で、同一レキシカルスコープにある定義を取り出す
const exportTail = `
;var __SIM = {
  CONFIG, CELL, PHASE, Game, CPU, key,
  canBombReach, enemiesOf, mobility, survivalArea, nextEnemyAttacker,
};`;

const ctx = { console, Math, Set, Map, JSON, Array, Object };
vm.createContext(ctx);
vm.runInContext(src + exportTail, ctx, { filename: 'engine.js' });
const { CONFIG, CELL, PHASE, Game, CPU, canBombReach, enemiesOf } = ctx.__SIM;

CPU.debug = false;

/* ---- 1試合を最後まで進める（UIのCPU連鎖をヘッドレスで再現） ----
 * measure: {perTurnEnd, perThrow, agreement} を任意で計測。
 * 戻り値: { winnerId, rounds, kills, turnsTaken, dangerEnds, turnEnds,
 *           agreeHE, agreeEE, agreeCount } */
function playMatch(players, opts = {}) {
  const settings = {
    size: opts.size || 'medium',
    obstacles: !!opts.obstacles,
    allowRevisit: opts.allowRevisit !== false,
    mode: 'ffa',
    players: players.map(d => ({ isCPU: true, difficulty: d, team: null })),
  };

  const kills = {};        // playerId -> 撃破数
  const turnsTaken = {};   // playerId -> 行動できたターン数
  const dangerEnds = {};   // playerId -> 移動完了時に危険マスへ止まった回数
  const turnEnds = {};     // playerId -> 自発的に移動を完了したターン数
  for (let i = 0; i < players.length; i++) { kills[i] = 0; turnsTaken[i] = 0; dangerEnds[i] = 0; turnEnds[i] = 0; }

  let winnerId = null;
  const hooks = {
    onBomb: (cell, thrower, victim) => { if (victim) kills[thrower.id]++; },
    onWin: (result) => { winnerId = result.type === 'player' && result.player ? result.player.id : null; },
  };

  // 脱落理由の集計（bomb=爆弾命中 / stuck=行動不能）
  let bombElims = 0, stuckElims = 0;
  hooks.onEliminate = (pl, reason) => { if (reason === 'bomb') bombElims++; else stuckElims++; };

  const game = new Game(settings, hooks);
  CPU._plan = null;
  CPU.lastEval = null;

  // 行動一致率の計測（同一局面でのHard/Expertの選択比較）
  let agreeHE = 0, agreeEE = 0, agreeCount = 0;
  const sameCell = (a, b) => a && b && a.r === b.r && a.c === b.c;
  function decisionCell(p, diff) {
    const savePlan = CPU._plan, saveEval = CPU.lastEval, saveDiff = p.difficulty;
    CPU._plan = null;
    p.difficulty = diff;
    const cell = game.phase === PHASE.THROW ? CPU.decideBomb(game) : CPU.decideStep(game);
    p.difficulty = saveDiff;
    CPU._plan = savePlan; CPU.lastEval = saveEval;
    return cell;
  }

  game.startTurn();
  let guard = 0;
  while (game.phase !== PHASE.OVER && guard++ < 200000) {
    const p = game.currentPlayer;

    if (game.phase === PHASE.THROW) {
      turnsTaken[p.id]++;

      // 行動一致率：Expertの手番でのみ計測（Expert局面上でのHard一致を見る）
      if (opts.measureAgreement && p.difficulty === 'expert') {
        const e1 = decisionCell(p, 'expert');
        const h1 = decisionCell(p, 'hard');
        const e2 = decisionCell(p, 'expert');
        if (sameCell(e1, h1)) agreeHE++;
        if (sameCell(e1, e2)) agreeEE++;
        agreeCount++;
      }

      const t = CPU.decideBomb(game);
      game.throwBomb(t.r, t.c);

    } else if (game.phase === PHASE.MOVE) {
      const pid = p.id;
      const t = CPU.decideStep(game);
      if (!t) break; // 安全弁（通常は到達しない）
      game.step(t.r, t.c);

      // この1歩で手番が終わったか（次プレイヤーへ移行 or 決着）
      const turnEnded = game.phase === PHASE.OVER || game.currentPlayer.id !== pid;
      if (turnEnded && p.alive) {
        turnEnds[pid]++;
        // 危険マス判定：移動完了位置を、次手番以降の敵が現在地から爆撃できるか
        const enemies = enemiesOf(game, p);
        const inDanger = enemies.some(e => canBombReach(e.r, e.c, p.r, p.c));
        if (inDanger) dangerEnds[pid]++;
      }
    }
  }

  return { winnerId, rounds: game.round, kills, turnsTaken, dangerEnds, turnEnds, agreeHE, agreeEE, agreeCount, bombElims, stuckElims };
}

/* ---- 集計ユーティリティ ---- */
function pct(n, d) { return d ? (100 * n / d) : 0; }
function fmt(x, p = 1) { return x.toFixed(p); }

/* ============================ 実験 ============================ */
const GAMES = parseInt(process.argv[2], 10) || 500;

/* 1) Hard vs Hard / Expert vs Expert（先手有利の基準・対称性チェック） */
function mirrorMatchup(diff, games) {
  let p0win = 0, p1win = 0, draws = 0;
  for (let i = 0; i < games; i++) {
    const r = playMatch([diff, diff]);
    if (r.winnerId === 0) p0win++; else if (r.winnerId === 1) p1win++; else draws++;
  }
  return { p0win, p1win, draws, games };
}

/* 2) Hard vs Expert（席をランダムに入れ替えて席順バイアスを除去） */
function hardVsExpert(games, size) {
  let hardWin = 0, expWin = 0, draws = 0, bombElims = 0, stuckElims = 0;
  const acc = {
    hard:   { turns: 0, kills: 0, danger: 0, turnEnds: 0, n: 0 },
    expert: { turns: 0, kills: 0, danger: 0, turnEnds: 0, n: 0 },
  };
  for (let i = 0; i < games; i++) {
    const expertFirst = Math.random() < 0.5;
    const lineup = expertFirst ? ['expert', 'hard'] : ['hard', 'expert'];
    const r = playMatch(lineup, { size });
    bombElims += r.bombElims; stuckElims += r.stuckElims;
    const idDiff = id => lineup[id]; // playerId -> difficulty
    if (r.winnerId != null) { if (idDiff(r.winnerId) === 'expert') expWin++; else hardWin++; }
    else draws++;
    for (const id of [0, 1]) {
      const a = acc[idDiff(id)];
      a.turns += r.turnsTaken[id];
      a.kills += r.kills[id];
      a.danger += r.dangerEnds[id];
      a.turnEnds += r.turnEnds[id];
      a.n++;
    }
  }
  return { hardWin, expWin, draws, games, acc, bombElims, stuckElims };
}

/* 3) 行動一致率（全員Expertの局面で、Hardが同じ手を選ぶ割合） */
function agreement(games) {
  let he = 0, ee = 0, cnt = 0;
  for (let i = 0; i < games; i++) {
    const r = playMatch(['expert', 'expert'], { measureAgreement: true });
    he += r.agreeHE; ee += r.agreeEE; cnt += r.agreeCount;
  }
  return { he, ee, cnt };
}

console.log(`\n=== BombGame CPU 評価（${GAMES}試合/条件, medium 10x9, 障害物OFF, 個人戦2人） ===\n`);

const t0 = Date.now();

const hh = mirrorMatchup('hard', GAMES);
console.log(`[Hard vs Hard]   先手勝率 ${fmt(pct(hh.p0win, hh.games))}%  後手勝率 ${fmt(pct(hh.p1win, hh.games))}%  引分 ${hh.draws}`);

const ee = mirrorMatchup('expert', GAMES);
console.log(`[Expert vs Expert] 先手勝率 ${fmt(pct(ee.p0win, ee.games))}%  後手勝率 ${fmt(pct(ee.p1win, ee.games))}%  引分 ${ee.draws}`);

const he = hardVsExpert(GAMES, 'medium');
console.log(`\n[Hard vs Expert] (medium)`);
console.log(`  Expert勝率 ${fmt(pct(he.expWin, he.games))}%   Hard勝率 ${fmt(pct(he.hardWin, he.games))}%   引分 ${he.draws}`);
for (const d of ['hard', 'expert']) {
  const a = he.acc[d];
  console.log(`  ${d.padEnd(6)}: 平均生存ターン ${fmt(a.turns / a.n, 2)}  平均撃破 ${fmt(a.kills / a.n, 3)}  危険マス移動率 ${fmt(pct(a.danger, a.turnEnds))}%  (移動完了 ${a.turnEnds}回)`);
}
const totalElim = he.bombElims + he.stuckElims;
console.log(`  決着要因: 爆弾命中 ${fmt(pct(he.bombElims, totalElim))}%  行動不能 ${fmt(pct(he.stuckElims, totalElim))}%  (脱落 ${totalElim}件)`);

// マップサイズ感度（攻撃が活きる余地があるか）
console.log(`\n[Hard vs Expert] マップサイズ別 Expert勝率`);
for (const size of ['small', 'medium', 'large']) {
  const r = hardVsExpert(GAMES, size);
  const te = r.bombElims + r.stuckElims;
  console.log(`  ${size.padEnd(6)}: Expert ${fmt(pct(r.expWin, r.games))}%  (爆弾決着 ${fmt(pct(r.bombElims, te))}%)`);
}

const ag = agreement(Math.max(50, Math.floor(GAMES / 4)));
console.log(`\n[行動一致率] Expert局面でのHardとの一致 ${fmt(pct(ag.he, ag.cnt))}%   （参考: Expert同士の再現一致 ${fmt(pct(ag.ee, ag.cnt))}%, サンプル ${ag.cnt}手）`);

console.log(`\n所要 ${fmt((Date.now() - t0) / 1000, 1)}s\n`);
