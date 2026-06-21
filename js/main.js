/* =========================================================================
 * main.js
 * 起動・画面遷移・設定画面の入力収集・ゲーム生成。
 * Game(モデル) と UI(描画) を接続する。
 * ========================================================================= */

const STORAGE_KEY = 'bombgame-settings-v2';

/* ---- ポイント獲得（ゲーム終了時） --------------------------------- */
function awardMatchPoints(result) {
  const humans = game.players.filter(p => !p.isCPU);
  if (humans.length === 0) return 0;

  const TABLES = {
    easy:   { win: 3,  lose: 1 },
    normal: { win: 5,  lose: 2 },
    hard:   { win: 10, lose: 3 },
    expert: { win: 15, lose: 4 },
  };

  const cpuDiffs = game.players.filter(p => p.isCPU).map(p => p.difficulty);
  let diff = 'normal';
  if (cpuDiffs.includes('expert'))      diff = 'expert';
  else if (cpuDiffs.includes('hard'))   diff = 'hard';
  else if (cpuDiffs.includes('normal')) diff = 'normal';
  else if (cpuDiffs.includes('easy'))   diff = 'easy';
  const table = TABLES[diff];

  let humanWon = false;
  if (result.type === 'player') {
    humanWon = result.player && !result.player.isCPU;
  } else if (result.type === 'team') {
    humanWon = humans.some(p => p.team === result.team.id);
  }

  // 人数ボーナス：3人対戦は+1、4人対戦は+2（勝敗どちらでも）
  const countBonus = Math.max(0, game.players.length - 2);
  const earned = (humanWon ? table.win : table.lose) + countBonus;
  SkinStore.addPoints(earned);

  // 実績：この試合で人間が爆弾撃破した数（killLogは爆弾命中のみ記録）
  const humanIds = new Set(humans.map(p => p.id));
  const humanBombKills = killLog.filter(k => humanIds.has(k.killerId)).length;
  lastEarnedAchievements = AchievementStore.onMatchEnd({
    won: humanWon, diff, mode: game.settings.mode, humanBombKills,
  });

  return earned;
}

// 設定画面の選択状態（既定値）
const setupState = {
  size: 'medium',
  count: 2,
  obstacles: false,
  revisit: 'allow',
  se: true,
  bgm: true,
  cpuDebug: false,
  mode: 'ffa',
  teamMode: 'random',
  teamCount: 2,
  friendlyFire: false,
  players: [
    { isCPU: false, difficulty: 'normal', team: 0 },
    { isCPU: false, difficulty: 'normal', team: 1 },
    { isCPU: false, difficulty: 'normal', team: 0 },
    { isCPU: false, difficulty: 'normal', team: 1 },
  ],
};

let game = null;
let lastResult = null;     // 直前のゲーム勝利結果（サマリー表示用）
let eliminationOrder = []; // 脱落した順のプレイヤーID
let killLog = [];          // [{killerId, victimId}]
let lastEarnedAchievements = []; // 直前の試合で新規解除した実績（オーバーレイ表示用）

/* ---- localStorage 保存・復元 --------------------------------------- */
function saveSettings() {
  try {
    const data = {
      size: setupState.size,
      count: setupState.count,
      obstacles: setupState.obstacles,
      revisit: setupState.revisit,
      se: setupState.se,
      bgm: setupState.bgm,
      mode: setupState.mode,
      teamMode: setupState.teamMode,
      teamCount: setupState.teamCount,
      friendlyFire: setupState.friendlyFire,
      players: setupState.players.map(p => ({
        isCPU: p.isCPU,
        difficulty: p.difficulty,
        team: p.team,
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {}
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    const valid = ['size','count','obstacles','revisit','se','bgm','mode','teamMode','teamCount','friendlyFire'];
    for (const k of valid) {
      if (k in saved) setupState[k] = saved[k];
    }
    if (Array.isArray(saved.players)) {
      for (let i = 0; i < 4; i++) {
        if (saved.players[i]) Object.assign(setupState.players[i], saved.players[i]);
      }
    }
  } catch (e) {}
}

// セグメントボタンの active を setupState の値に合わせる
function syncSegment(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.querySelectorAll('.seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.val === String(value));
  });
}

function syncUI() {
  syncSegment('opt-size', setupState.size);
  syncSegment('opt-count', setupState.count);
  syncSegment('opt-mode', setupState.mode);
  syncSegment('opt-teamcount', setupState.teamCount);
  syncSegment('opt-teammode', setupState.teamMode);
  syncSegment('opt-ff', setupState.friendlyFire ? 'on' : 'off');
  syncSegment('opt-obstacles', setupState.obstacles ? 'on' : 'off');
  syncSegment('opt-revisit', setupState.revisit);
  syncSegment('opt-se', setupState.se ? 'on' : 'off');
  syncSegment('opt-bgm', setupState.bgm ? 'on' : 'off');
}

/* ---- 画面切り替え ------------------------------------------------- */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

/* ---- セグメントボタン（排他選択）の共通処理 ----------------------- */
function bindSegment(containerId, onSelect) {
  const container = document.getElementById(containerId);
  if (!container) return;
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
    row.style.setProperty('--pcolor', CONFIG.PLAYER_COLORS[i]);

    const numChar = '①②③④'[i];
    row.innerHTML = `<span class="prow-num">${numChar}</span>`;

    // 人間/CPU 切り替え
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
      ['easy', 'normal', 'hard', 'expert'].forEach(d => {
        const b = document.createElement('button');
        b.className = 'seg-btn' + (conf.difficulty === d ? ' active' : '');
        b.textContent = { easy: 'Easy', normal: 'Normal', hard: 'Hard', expert: 'Expert' }[d];
        b.addEventListener('click', () => { conf.difficulty = d; renderPlayerOptions(); });
        diffSeg.appendChild(b);
      });
      row.appendChild(diffSeg);
    }

    // スキン選択（所持スキンが2種以上あるときのみ表示）
    const owned = SkinStore.getOwned();
    const ownedDefs = SKIN_DEFS.filter(s => owned.includes(s.id));
    if (ownedDefs.length >= 2) {
      const currentSkinId = SkinStore.getPlayerSkin(i);
      const skinRow = document.createElement('div');
      skinRow.className = 'skin-pick-row';
      for (const skin of ownedDefs) {
        const b = document.createElement('button');
        b.className = 'seg-btn skin-mini-btn' + (currentSkinId === skin.id ? ' active' : '');
        b.title = skin.name;
        b.innerHTML = skin.drawCharacter(CONFIG.PLAYER_COLORS[i], i + 1);
        b.addEventListener('click', () => {
          SkinStore.setPlayerSkin(i, skin.id);
          renderPlayerOptions();
        });
        skinRow.appendChild(b);
      }
      row.appendChild(skinRow);
    }

    // チーム選択（チーム戦＋手動編成のときのみ）
    if (setupState.mode === 'team' && setupState.teamMode === 'manual') {
      if (conf.team == null || conf.team >= setupState.teamCount) conf.team = i % setupState.teamCount;
      const teamSeg = document.createElement('div');
      teamSeg.className = 'seg mini team-select';
      for (let t = 0; t < setupState.teamCount; t++) {
        const b = document.createElement('button');
        b.className = 'seg-btn' + (conf.team === t ? ' active' : '');
        b.textContent = CONFIG.TEAMS[t].name;
        b.style.setProperty('--tcolor', CONFIG.TEAMS[t].color);
        if (conf.team === t) b.style.background = CONFIG.TEAMS[t].color;
        b.addEventListener('click', () => { conf.team = t; renderPlayerOptions(); });
        teamSeg.appendChild(b);
      }
      row.appendChild(teamSeg);
    }

    wrap.appendChild(row);
  }
}

/* ---- モードに応じてチーム関連の設定欄を出し分け ------------------- */
function updateModeUI() {
  const isTeam = setupState.mode === 'team';
  document.querySelectorAll('.team-only').forEach(el => {
    el.style.display = isTeam ? '' : 'none';
  });
  renderPlayerOptions();
}

/* ---- 勝利結果サマリーHTML生成 ------------------------------------- */
function buildSummary() {
  if (!game) return '';
  const g = game;
  const humanCount = g.players.filter(p => !p.isCPU).length;

  // kills 集計
  const kills = {};
  for (const p of g.players) kills[p.id] = 0;
  for (const k of killLog) kills[k.killerId] = (kills[k.killerId] || 0) + 1;

  // 順位ソート：alive（未脱落）が上位、脱落は後から脱落した順に上位
  const sorted = [...g.players].sort((a, b) => {
    const ai = eliminationOrder.indexOf(a.id);
    const bi = eliminationOrder.indexOf(b.id);
    return (ai === -1 ? -1 : ai) - (bi === -1 ? -1 : bi);
  });

  let html = '<div class="summary-table-wrap"><table class="summary-table">';
  html += '<tr><th></th><th>プレイヤー</th><th>撃破</th></tr>';

  sorted.forEach((p, i) => {
    const medal = ['🥇', '🥈', '🥉'][i] || (i + 1) + '位';
    const label = UI.playerLabel(p, humanCount);
    const num = '①②③④'[p.order - 1];
    const teamDot = (g.settings.mode === 'team' && p.team != null)
      ? `<span class="summary-dot" style="background:${g.teams[p.team].color}"></span>` : '';
    html += `<tr><td class="rank-cell">${medal}</td>` +
      `<td><span class="summary-name" style="color:${p.color}">${num}${teamDot}</span> ${label}</td>` +
      `<td class="kills-cell">${kills[p.id]}</td></tr>`;
  });

  html += '</table></div>';
  return html;
}

/* ---- ゲーム開始 --------------------------------------------------- */
function startGame() {
  // 設定を localStorage に保存
  saveSettings();

  // 前回の記録をリセット
  eliminationOrder = [];
  killLog = [];
  lastResult = null;
  lastEarnedAchievements = [];

  const settings = {
    size: setupState.size,
    obstacles: setupState.obstacles,
    allowRevisit: setupState.revisit === 'allow',
    mode: setupState.mode,
    teamMode: setupState.teamMode,
    teamCount: setupState.teamCount,
    friendlyFire: setupState.friendlyFire,
    players: setupState.players.slice(0, setupState.count)
      .map(p => ({ isCPU: p.isCPU, difficulty: p.difficulty, team: p.team })),
  };

  const hooks = {
    onTurnStart: () => UI.beginTurn(),
    onBomb: (cell, thrower, victim) => {
      if (victim) killLog.push({ killerId: thrower.id, victimId: victim.id });
      UI.fxThrow(thrower, cell, victim);
    },
    onMove: () => Sound.play('step'),
    onDestroyStart: () => Sound.play('thud'),
    onEliminate: (p, reason) => {
      eliminationOrder.push(p.id);
      if (reason === 'stuck') {
        const g = UI.game;
        const over = g.settings.mode === 'team' ? g.aliveTeams().length <= 1 : g.aliveCount <= 1;
        if (over) UI.finalKillInProgress = true;
        const def = SkinStore.getPlayerSkinDef(p.order - 1);
        UI.fxKill(p.r, p.c, over, def.explosionTheme, def.explosionSound);
      }
      const why = reason === 'bomb' ? '爆弾命中' : '行動不能';
      UI.setStatus(`💥 プレイヤー${'①②③④'[p.order - 1]} 脱落（${why}）`);
    },
    onWin: (result) => {
      lastResult = result;
      const earned = awardMatchPoints(result);
      UI.clearCpuTimer();
      let msg, winnerOrder = null;
      if (result.type === 'team') {
        msg = `${result.team.name}チームの勝利！`;
        const w = game.players.find(p => p.team === result.team.id && p.alive);
        winnerOrder = w ? w.order : null;
      } else if (result.type === 'player') {
        msg = `プレイヤー${'①②③④'[result.player.order - 1]} の勝利！`;
        winnerOrder = result.player.order;
      } else {
        msg = '引き分け';
      }
      UI.scheduleWin(() => {
        Sound.stopBGM();
        UI.fxConfetti(winnerOrder);
        showOverlay('🏆 勝利！', msg, true, earned);
      });
    },
  };

  Sound.unlock();
  Sound.setSE(setupState.se);
  Sound.setBGM(setupState.bgm);

  CPU.debug = setupState.cpuDebug;
  CPU.lastEval = null;
  CPU._plan = null;

  game = new Game(settings, hooks);
  showScreen('game-screen');
  UI.init(game);
  game.startTurn();
}

/* ---- オーバーレイ（メニュー / 勝利） ------------------------------ */
function showOverlay(title, msg, isWin, earnedPts) {
  document.getElementById('overlay-title').textContent = title;

  // ボタン表示切替
  document.getElementById('overlay-resume').style.display = isWin ? 'none' : '';
  document.getElementById('overlay-rematch').style.display = isWin ? '' : 'none';
  document.getElementById('menu-controls').style.display = isWin ? 'none' : '';

  // チーム勝利時はメッセージをチームカラーで着色
  const msgEl = document.getElementById('overlay-msg');
  if (isWin && lastResult && lastResult.type === 'team' && lastResult.team) {
    msgEl.innerHTML = `<span style="color:${lastResult.team.color};font-size:1.2em;font-weight:bold">${msg}</span>`;
  } else {
    msgEl.textContent = msg;
  }

  // ポイント獲得表示
  const ptsEl = document.getElementById('overlay-pts');
  if (ptsEl) {
    if (isWin && earnedPts > 0) {
      const total = SkinStore.getPoints();
      ptsEl.innerHTML = `+${earnedPts}pt 獲得！<span class="pts-total">（累計 ${total.toLocaleString()}pt）</span>`;
    } else {
      ptsEl.innerHTML = '';
    }
  }

  // 実績解除表示（試合結果オーバーレイのみ。メニューでは出さない）
  const achEl = document.getElementById('overlay-ach');
  if (achEl) {
    const show = isWin && lastEarnedAchievements.length > 0;
    achEl.innerHTML = show ? Achievements.newlyHtml(lastEarnedAchievements) : '';
    if (show) setTimeout(() => Sound.play('achievement'), 350);
  }

  // 結果サマリー
  const sumEl = document.getElementById('overlay-summary');
  sumEl.innerHTML = isWin ? buildSummary() : '';
  sumEl.style.display = isWin ? '' : 'none';

  if (!isWin) updateMenuToggles();

  document.getElementById('overlay').classList.add('show');
}

function hideOverlay() {
  document.getElementById('overlay').classList.remove('show');
  if (UI.game) UI.lockInput(300);
}

/* ---- メニュー内サウンドトグル ------------------------------------- */
function updateMenuToggles() {
  const seBtn = document.getElementById('menu-se-btn');
  const bgmBtn = document.getElementById('menu-bgm-btn');
  if (seBtn) {
    seBtn.textContent = `🔊 SE: ${setupState.se ? 'ON' : 'OFF'}`;
    seBtn.classList.toggle('active', setupState.se);
  }
  if (bgmBtn) {
    bgmBtn.textContent = `♪ BGM: ${setupState.bgm ? 'ON' : 'OFF'}`;
    bgmBtn.classList.toggle('active', setupState.bgm);
  }
}

/* ---- 遊び方ガイド ------------------------------------------------- */
function showGuide() {
  document.getElementById('guide-overlay').classList.add('show');
}
function hideGuide() {
  document.getElementById('guide-overlay').classList.remove('show');
}

/* ---- 起動時のイベント登録 ----------------------------------------- */
window.addEventListener('DOMContentLoaded', () => {
  // 開発モード（?dev=1）：全スキン試着・ポイント非消費。本番データは変更しない。
  if (new URLSearchParams(location.search).get('dev') === '1') {
    SkinStore.enableDev();
    document.body.classList.add('dev-mode');
  }

  // 無料スキンを自動解放（price=0 は最初から所持）
  SKIN_DEFS.filter(s => s.price === 0).forEach(s => SkinStore.purchase(s.id));

  // localStorage から前回設定を復元してUIに反映
  loadSettings();
  syncUI();

  bindSegment('opt-size', v => { setupState.size = v; });
  bindSegment('opt-count', v => { setupState.count = parseInt(v, 10); renderPlayerOptions(); });
  bindSegment('opt-obstacles', v => { setupState.obstacles = (v === 'on'); });
  bindSegment('opt-revisit', v => { setupState.revisit = v; });
  bindSegment('opt-se', v => { setupState.se = (v === 'on'); });
  bindSegment('opt-bgm', v => { setupState.bgm = (v === 'on'); });
  bindSegment('opt-mode', v => { setupState.mode = v; updateModeUI(); });
  bindSegment('opt-teammode', v => { setupState.teamMode = v; renderPlayerOptions(); });
  bindSegment('opt-teamcount', v => { setupState.teamCount = parseInt(v, 10); renderPlayerOptions(); });
  bindSegment('opt-ff', v => { setupState.friendlyFire = (v === 'on'); });

  // URLに ?cpudebug=1 が付いていればデバッグ表示を初期ONにする
  if (new URLSearchParams(location.search).get('cpudebug') === '1') {
    setupState.cpuDebug = true;
  }

  renderPlayerOptions();
  updateModeUI();

  document.getElementById('start-btn').addEventListener('click', startGame);

  // スキンショップ
  document.getElementById('shop-btn').addEventListener('click', () => {
    Shop.render();
    showScreen('shop-screen');
  });
  document.getElementById('shop-back-btn').addEventListener('click', () => {
    showScreen('setup-screen');
  });

  // 実績
  document.getElementById('ach-btn').addEventListener('click', () => {
    Achievements.render();
    showScreen('achievements-screen');
  });
  document.getElementById('ach-back-btn').addEventListener('click', () => {
    showScreen('setup-screen');
  });

  // 画面サイズ変更時に盤面リフィット
  const refit = () => { if (UI.game) UI.fitBoard(); };
  window.addEventListener('resize', refit);
  window.addEventListener('orientationchange', refit);

  // サウンドミュートボタン（HUD）
  document.getElementById('sound-btn').addEventListener('click', e => {
    const muted = Sound.toggleMute();
    e.currentTarget.textContent = muted ? '🔇' : '🔊';
    e.currentTarget.classList.toggle('muted', muted);
  });

  // メニューボタン
  document.getElementById('menu-btn').addEventListener('click',
    () => showOverlay('メニュー', '', false));

  // メニュー内：ゲームに戻る
  document.getElementById('overlay-resume').addEventListener('click', hideOverlay);

  // メニュー内：設定画面に戻る
  document.getElementById('overlay-restart').addEventListener('click', () => {
    UI.clearCpuTimer();
    Sound.stopBGM();
    hideOverlay();
    showScreen('setup-screen');
  });

  // 勝利後：もう一度（同設定）
  document.getElementById('overlay-rematch').addEventListener('click', () => {
    hideOverlay();
    startGame();
  });

  // メニュー内：SE トグル
  document.getElementById('menu-se-btn').addEventListener('click', () => {
    setupState.se = !setupState.se;
    Sound.setSE(setupState.se);
    updateMenuToggles();
  });

  // メニュー内：BGM トグル
  document.getElementById('menu-bgm-btn').addEventListener('click', () => {
    setupState.bgm = !setupState.bgm;
    Sound.setBGM(setupState.bgm);
    updateMenuToggles();
  });

  // メニュー内：遊び方
  document.getElementById('menu-guide-btn').addEventListener('click', () => {
    hideOverlay();
    showGuide();
  });

  // 設定画面：遊び方ボタン
  document.getElementById('guide-open-btn').addEventListener('click', showGuide);
  document.getElementById('guide-close-btn').addEventListener('click', hideGuide);

  // Service Worker 登録
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
});
