/* =========================================================================
 * achievements.js
 * 実績（アチーブメント）の定義・解除判定・永続化・画面描画。
 * 解除時は報酬ポイントを SkinStore.addPoints で付与する。
 * 開発モード（?dev=1）では本番データを汚さないため一切記録・付与しない。
 * ========================================================================= */

const ACH_STORE_KEY = 'bombgame-achievements-v1';

/* 実績定義。cond は未解除でも画面に表示する達成条件。 */
const ACHIEVEMENTS = [
  { id: 'first_win',  icon: '🥇', name: '初勝利',           cond: 'ゲームに初めて勝利する',           reward: 20 },
  { id: 'first_skin', icon: '🎨', name: '初めてのスキン購入', cond: 'スキンを1つ購入する',             reward: 10 },
  { id: 'hard_win',   icon: '🔥', name: 'Hard初勝利',        cond: 'Hard CPU相手に初めて勝利する',     reward: 30 },
  { id: 'expert_win', icon: '👑', name: 'Expert初勝利',      cond: 'Expert CPU相手に初めて勝利する',   reward: 50 },
  { id: 'win_10',     icon: '🎖️', name: '10勝達成',          cond: '通算10勝する',                    reward: 30 },
  { id: 'win_50',     icon: '🏆', name: '50勝達成',          cond: '通算50勝する',                    reward: 75 },
  { id: 'expert_10',  icon: '🏅', name: 'Expert10勝',        cond: 'Expert CPU相手に通算10勝する',     reward: 100 },
  { id: 'bomb_kill',  icon: '💣', name: '爆弾で相手を倒す',   cond: '爆弾を相手に当てて撃破する',       reward: 10 },
  { id: 'team_win',   icon: '🤝', name: 'チーム戦初勝利',     cond: 'チーム戦で初めて勝利する',         reward: 20 },
  { id: 'streak_3',   icon: '⚡', name: '連勝3回',           cond: '3連勝する',                       reward: 25 },
];

/* ---- 永続ストレージ ----------------------------------------------- */
const AchievementStore = (() => {
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(ACH_STORE_KEY) || '{}');
      return {
        unlocked: Array.isArray(d.unlocked) ? d.unlocked : [],
        wins:       d.wins       | 0,
        streak:     d.streak     | 0,
        expertWins: d.expertWins | 0,
      };
    } catch {
      return { unlocked: [], wins: 0, streak: 0, expertWins: 0 };
    }
  }
  function save(d) {
    try { localStorage.setItem(ACH_STORE_KEY, JSON.stringify(d)); } catch {}
  }

  // ids を解除して報酬付与。新規解除した定義を newly に追加する。
  function tryUnlock(d, ids, newly) {
    for (const id of ids) {
      if (d.unlocked.includes(id)) continue;
      const def = ACHIEVEMENTS.find(a => a.id === id);
      if (!def) continue;
      d.unlocked.push(id);
      SkinStore.addPoints(def.reward);
      newly.push(def);
    }
  }

  return {
    getUnlocked() { return load().unlocked; },
    isUnlocked(id) { return load().unlocked.includes(id); },
    getProgress() {
      const d = load();
      return { wins: d.wins, streak: d.streak, count: d.unlocked.length, total: ACHIEVEMENTS.length };
    },

    /* スキン購入時に呼ぶ。新規解除リストを返す。 */
    onPurchase() {
      if (SkinStore.isDev()) return [];
      const d = load(); const newly = [];
      tryUnlock(d, ['first_skin'], newly);
      save(d);
      return newly;
    },

    /* 試合終了時に呼ぶ。won/diff/mode/humanBombKills から判定。新規解除リストを返す。 */
    onMatchEnd({ won, diff, mode, humanBombKills }) {
      if (SkinStore.isDev()) return [];
      const d = load(); const newly = [];

      if (humanBombKills > 0) tryUnlock(d, ['bomb_kill'], newly);

      if (won) {
        d.wins++;
        d.streak++;
        tryUnlock(d, ['first_win'], newly);
        if (diff === 'hard')   tryUnlock(d, ['hard_win'], newly);
        if (diff === 'expert') {
          tryUnlock(d, ['expert_win'], newly);
          d.expertWins++;
          if (d.expertWins >= 10) tryUnlock(d, ['expert_10'], newly);
        }
        if (mode === 'team')   tryUnlock(d, ['team_win'], newly);
        if (d.wins >= 10)      tryUnlock(d, ['win_10'], newly);
        if (d.wins >= 50)      tryUnlock(d, ['win_50'], newly);
        if (d.streak >= 3)     tryUnlock(d, ['streak_3'], newly);
      } else {
        d.streak = 0;
      }

      save(d);
      return newly;
    },
  };
})();

/* ---- 実績画面の描画 ------------------------------------------------ */
const Achievements = {
  render() {
    const unlocked = new Set(AchievementStore.getUnlocked());
    const prog = AchievementStore.getProgress();

    const sub = document.getElementById('ach-progress');
    if (sub) sub.textContent = `${prog.count} / ${prog.total} 解除`;

    const grid = document.getElementById('ach-grid');
    grid.innerHTML = '';

    for (const def of ACHIEVEMENTS) {
      const isUnlocked = unlocked.has(def.id);
      const card = document.createElement('div');
      card.className = 'ach-card' + (isUnlocked ? ' ach-unlocked' : ' ach-locked');
      card.innerHTML = `
        <div class="ach-icon">${isUnlocked ? def.icon : '🔒'}</div>
        <div class="ach-info">
          <div class="ach-name">${def.name}</div>
          <div class="ach-cond">${def.cond}</div>
        </div>
        <div class="ach-reward">+${def.reward}<small>pt</small></div>
      `;
      grid.appendChild(card);
    }
  },

  /* 新規解除をオーバーレイ用HTMLにする（main.jsから利用） */
  newlyHtml(list) {
    if (!list || !list.length) return '';
    const rows = list.map(a =>
      `<div class="ach-toast-row"><span>${a.icon} 実績解除：${a.name}</span><span class="ach-toast-pt">+${a.reward}pt</span></div>`
    ).join('');
    return `<div class="ach-toast">${rows}</div>`;
  },
};
