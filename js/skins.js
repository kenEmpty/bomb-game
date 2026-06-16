/* =========================================================================
 * skins.js
 * スキン定義・ポイントストレージ・アクティブスキン参照。
 * SKIN_DEFS に追加するだけで新スキンを拡張できる構造。
 * =========================================================================
 *
 * 各スキンのプロパティ:
 *   id             : string (一意なID)
 *   name           : string (表示名)
 *   desc           : string (説明文)
 *   price          : number (0=無料)
 *   drawCharacter  : (color:string, num:number) => SVG文字列
 *   projectile     : { html:string, spin:boolean }
 *   explosionTheme : null(デフォルト) | { flash, core, ringColor, sparkBg, sparkGlow, debrisBg }
 *   victoryEmojis  : string[] (勝利演出の絵文字リスト)
 */

const SKIN_STORE_KEY = 'bombgame-skins-v1';

const SKIN_DEFS = [
  /* ---- デフォルト ---- */
  {
    id: 'default',
    name: 'デフォルト',
    desc: '標準爆弾・通常爆発・紙吹雪',
    price: 0,
    drawCharacter(color, num) {
      return `<svg viewBox="0 0 100 100" class="stick" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="26" r="18" fill="${color}" stroke="#1b1b2f" stroke-width="3"/>
        <text x="50" y="33" text-anchor="middle" font-size="22" font-weight="bold" fill="#fff">${num}</text>
        <g stroke="${color}" stroke-width="7" stroke-linecap="round" fill="none">
          <line x1="50" y1="44" x2="50" y2="72"/>
          <line x1="50" y1="52" x2="32" y2="64"/>
          <line x1="50" y1="52" x2="68" y2="64"/>
          <line x1="50" y1="72" x2="36" y2="92"/>
          <line x1="50" y1="72" x2="64" y2="92"/>
        </g>
      </svg>`;
    },
    projectile: { html: '💣', spin: true },
    explosionTheme: null,
    victoryEmojis: ['🎉', '🎊', '✨', '⭐', '💥'],
  },

  /* ---- 忍者 ---- */
  {
    id: 'ninja',
    name: '忍者',
    desc: '手裏剣・煙幕爆発・残像演出',
    price: 100,
    drawCharacter(color, num) {
      return `<svg viewBox="0 0 100 100" class="stick" xmlns="http://www.w3.org/2000/svg">
        <path d="M32 16 Q32 6 50 6 Q68 6 68 16 L70 30 Q60 26 50 26 Q40 26 30 30 Z" fill="#2a2a50"/>
        <ellipse cx="50" cy="28" rx="17" ry="10" fill="${color}"/>
        <text x="50" y="33" text-anchor="middle" font-size="13" font-weight="bold" fill="#fff">${num}</text>
        <path d="M30 30 Q30 40 50 42 Q70 40 70 30 L70 36 Q60 46 50 46 Q40 46 30 36 Z" fill="#2a2a50"/>
        <g stroke="${color}" stroke-width="6" stroke-linecap="round" fill="none">
          <line x1="50" y1="46" x2="50" y2="70"/>
          <line x1="50" y1="53" x2="27" y2="64"/>
          <line x1="50" y1="53" x2="73" y2="60"/>
          <line x1="50" y1="70" x2="33" y2="91"/>
          <line x1="50" y1="70" x2="64" y2="90"/>
        </g>
      </svg>`;
    },
    projectile: {
      html: `<svg viewBox="0 0 32 32" width="26" height="26" xmlns="http://www.w3.org/2000/svg">
        <polygon points="16,1 19,13 31,16 19,19 16,31 13,19 1,16 13,13" fill="#bbb" stroke="#555" stroke-width="1"/>
        <circle cx="16" cy="16" r="4" fill="#ddd"/>
      </svg>`,
      spin: true,
    },
    explosionTheme: {
      flash:     'radial-gradient(circle, rgba(220,235,220,0.9) 0%, rgba(130,175,130,0.5) 40%, rgba(50,90,50,0) 70%)',
      core:      'radial-gradient(circle, #eee 0%, #afa 35%, #6a8 70%, rgba(0,80,40,0) 100%)',
      ringColor: 'rgba(90,155,90,0.85)',
      sparkBg:   'radial-gradient(circle, #fff, #cec 60%, #6a8)',
      sparkGlow: '#8b8',
      debrisBg:  '#3a4a3a',
    },
    victoryEmojis: ['💨', '🌀', '✦', '⭐', '✨'],
  },

  /* ---- 海賊 ---- */
  {
    id: 'pirate',
    name: '海賊',
    desc: '砲弾・火花爆発・海賊旗演出',
    price: 150,
    drawCharacter(color, num) {
      return `<svg viewBox="0 0 100 100" class="stick" xmlns="http://www.w3.org/2000/svg">
        <polygon points="50,2 20,22 80,22" fill="#1a1a1a" stroke="#333" stroke-width="1"/>
        <rect x="18" y="20" width="64" height="9" rx="3" fill="#2a2a2a"/>
        <circle cx="50" cy="11" r="4" fill="#bbb"/>
        <line x1="44" y1="17" x2="56" y2="17" stroke="#bbb" stroke-width="1.5"/>
        <circle cx="50" cy="36" r="16" fill="${color}" stroke="#1b1b2f" stroke-width="3"/>
        <text x="50" y="42" text-anchor="middle" font-size="18" font-weight="bold" fill="#fff">${num}</text>
        <ellipse cx="43" cy="33" rx="7" ry="5" fill="#111"/>
        <line x1="35" y1="31" x2="52" y2="31" stroke="#111" stroke-width="2.5"/>
        <g stroke="${color}" stroke-width="7" stroke-linecap="round" fill="none">
          <line x1="50" y1="52" x2="50" y2="78"/>
          <line x1="50" y1="60" x2="27" y2="72"/>
          <line x1="50" y1="60" x2="73" y2="68"/>
          <line x1="50" y1="78" x2="36" y2="96"/>
          <line x1="50" y1="78" x2="64" y2="96"/>
        </g>
      </svg>`;
    },
    projectile: {
      html: `<svg viewBox="0 0 32 32" width="26" height="26" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="18" r="12" fill="#222" stroke="#3a3a3a" stroke-width="1.5"/>
        <ellipse cx="12" cy="13" rx="4" ry="3" fill="#3a3a3a" opacity="0.7"/>
        <circle cx="20" cy="21" r="2" fill="#333"/>
      </svg>`,
      spin: false,
    },
    explosionTheme: {
      flash:     'radial-gradient(circle, rgba(255,250,220,0.95) 0%, rgba(255,160,60,0.6) 40%, rgba(200,60,0,0) 70%)',
      core:      'radial-gradient(circle, #fff 0%, #fc8 35%, #f60 70%, rgba(200,30,0,0) 100%)',
      ringColor: 'rgba(255,130,40,0.85)',
      sparkBg:   'radial-gradient(circle, #fff, #fc6 60%, #f60)',
      sparkGlow: '#f80',
      debrisBg:  '#4a2e10',
    },
    victoryEmojis: ['☠️', '⚓', '🏴', '✨', '💥'],
  },

  /* ---- ロボット ---- */
  {
    id: 'robot',
    name: 'ロボット',
    desc: 'エネルギー球・電撃爆発・スキャン演出',
    price: 250,
    drawCharacter(color, num) {
      return `<svg viewBox="0 0 100 100" class="stick" xmlns="http://www.w3.org/2000/svg">
        <line x1="50" y1="5" x2="50" y2="13" stroke="#aaa" stroke-width="3" stroke-linecap="round"/>
        <circle cx="50" cy="4" r="3.5" fill="#5f5"/>
        <rect x="28" y="10" width="44" height="36" rx="6" fill="${color}" stroke="#1b1b2f" stroke-width="3"/>
        <rect x="32" y="19" width="36" height="15" rx="4" fill="#0af" opacity="0.75"/>
        <text x="50" y="30" text-anchor="middle" font-size="14" font-weight="bold" fill="#fff">${num}</text>
        <circle cx="33" cy="14" r="3" fill="#888"/>
        <circle cx="67" cy="14" r="3" fill="#888"/>
        <rect x="36" y="37" width="28" height="5" rx="2" fill="#0af" opacity="0.5"/>
        <g stroke="${color}" stroke-width="7" stroke-linecap="round" fill="none">
          <line x1="50" y1="46" x2="50" y2="72"/>
          <line x1="50" y1="54" x2="27" y2="65"/>
          <line x1="50" y1="54" x2="73" y2="65"/>
          <line x1="50" y1="72" x2="36" y2="92"/>
          <line x1="50" y1="72" x2="64" y2="92"/>
        </g>
      </svg>`;
    },
    projectile: {
      html: `<svg viewBox="0 0 32 32" width="26" height="26" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="16" r="13" fill="rgba(0,150,255,0.12)" stroke="#0af" stroke-width="2"/>
        <circle cx="16" cy="16" r="8" fill="rgba(0,200,255,0.35)"/>
        <circle cx="16" cy="16" r="4" fill="rgba(180,240,255,0.9)"/>
        <circle cx="16" cy="16" r="2" fill="#fff"/>
      </svg>`,
      spin: false,
    },
    explosionTheme: {
      flash:     'radial-gradient(circle, rgba(200,240,255,0.95) 0%, rgba(50,180,255,0.5) 40%, rgba(0,80,255,0) 70%)',
      core:      'radial-gradient(circle, #fff 0%, #aef 35%, #09f 70%, rgba(0,50,220,0) 100%)',
      ringColor: 'rgba(0,180,255,0.9)',
      sparkBg:   'radial-gradient(circle, #fff, #aef 60%, #09f)',
      sparkGlow: '#0af',
      debrisBg:  '#1a2a4a',
    },
    victoryEmojis: ['⚡', '🤖', '💡', '🔷', '✨'],
  },

  /* ---- 王様 ---- */
  {
    id: 'king',
    name: '王様',
    desc: '王冠爆弾・黄金爆発・王者演出',
    price: 400,
    drawCharacter(color, num) {
      return `<svg viewBox="0 0 100 100" class="stick" xmlns="http://www.w3.org/2000/svg">
        <polygon points="24,23 24,9 38,17 50,7 62,17 76,9 76,23" fill="#f0c030" stroke="#b89000" stroke-width="1.5"/>
        <rect x="23" y="21" width="54" height="9" rx="3" fill="#f0c030" stroke="#b89000" stroke-width="1"/>
        <circle cx="50" cy="12" r="4.5" fill="#e33"/>
        <circle cx="34" cy="14" r="3" fill="#44e"/>
        <circle cx="66" cy="14" r="3" fill="#4e4"/>
        <circle cx="50" cy="39" r="17" fill="${color}" stroke="#1b1b2f" stroke-width="3"/>
        <text x="50" y="46" text-anchor="middle" font-size="20" font-weight="bold" fill="#fff">${num}</text>
        <g stroke="${color}" stroke-width="8" stroke-linecap="round" fill="none">
          <line x1="50" y1="56" x2="50" y2="79"/>
          <line x1="50" y1="63" x2="25" y2="74"/>
          <line x1="50" y1="63" x2="75" y2="74"/>
          <line x1="50" y1="79" x2="36" y2="96"/>
          <line x1="50" y1="79" x2="64" y2="96"/>
        </g>
        <line x1="25" y1="74" x2="16" y2="95" stroke="#f0c030" stroke-width="4" stroke-linecap="round"/>
        <circle cx="16" cy="96" r="4" fill="#f0c030"/>
      </svg>`;
    },
    projectile: {
      html: `<svg viewBox="0 0 32 32" width="26" height="26" xmlns="http://www.w3.org/2000/svg">
        <circle cx="16" cy="21" r="10" fill="#1a1a1a" stroke="#2a2a2a" stroke-width="1"/>
        <polygon points="16,5 12,11 6,10 10,15 6,20 16,17 26,20 22,15 26,10 20,11" fill="#f0c030" stroke="#b89000" stroke-width="0.8"/>
        <circle cx="16" cy="6" r="2.5" fill="#e33"/>
      </svg>`,
      spin: true,
    },
    explosionTheme: {
      flash:     'radial-gradient(circle, rgba(255,255,210,0.98) 0%, rgba(255,220,60,0.6) 40%, rgba(200,140,0,0) 70%)',
      core:      'radial-gradient(circle, #fff 0%, #ffd24a 35%, #f0a000 70%, rgba(180,80,0,0) 100%)',
      ringColor: 'rgba(255,200,30,0.9)',
      sparkBg:   'radial-gradient(circle, #fff, #ffd24a 60%, #f0a000)',
      sparkGlow: '#ffc040',
      debrisBg:  '#4a3810',
    },
    victoryEmojis: ['👑', '🌟', '✨', '💛', '🏆'],
  },
];

/* ===================================================================
 * SkinStore: ポイント・所持スキン・選択スキンの永続化
 * =================================================================== */
const SkinStore = (() => {
  function load() {
    try {
      const raw = localStorage.getItem(SKIN_STORE_KEY);
      const d = raw ? JSON.parse(raw) : {};
      return {
        points: typeof d.points === 'number' ? d.points : 0,
        owned:  Array.isArray(d.owned) ? d.owned : ['default'],
        active: typeof d.active === 'string' ? d.active : 'default',
        playerSkins: Array.isArray(d.playerSkins)
          ? d.playerSkins
          : ['default', 'default', 'default', 'default'],
      };
    } catch {
      return {
        points: 0, owned: ['default'], active: 'default',
        playerSkins: ['default', 'default', 'default', 'default'],
      };
    }
  }

  function save(d) {
    try { localStorage.setItem(SKIN_STORE_KEY, JSON.stringify(d)); } catch {}
  }

  return {
    getPoints()    { return load().points; },
    getOwned()     { return load().owned; },
    getActive()    { return load().active; },

    getSkinDef(id) {
      return SKIN_DEFS.find(s => s.id === id) || SKIN_DEFS[0];
    },
    getActiveDef() {
      return this.getSkinDef(this.getActive());
    },

    /* プレイヤー個別スキン（index: 0-3） */
    getPlayerSkin(index) {
      const d = load();
      const id = d.playerSkins && d.playerSkins[index];
      return (id && (d.owned || ['default']).includes(id)) ? id : 'default';
    },
    setPlayerSkin(index, skinId) {
      const d = load();
      if (!(d.owned || ['default']).includes(skinId)) return false;
      if (!d.playerSkins) d.playerSkins = ['default', 'default', 'default', 'default'];
      d.playerSkins[index] = skinId;
      save(d);
      return true;
    },
    getPlayerSkinDef(index) {
      return this.getSkinDef(this.getPlayerSkin(index));
    },

    addPoints(n) {
      const d = load();
      d.points = Math.max(0, d.points + n);
      save(d);
      return d.points;
    },

    /* 購入：所持済み・pt不足なら false */
    purchase(skinId) {
      const def = SKIN_DEFS.find(s => s.id === skinId);
      if (!def) return false;
      const d = load();
      if (d.owned.includes(skinId)) return false;
      if (d.points < def.price) return false;
      d.points -= def.price;
      d.owned.push(skinId);
      save(d);
      return true;
    },

    /* 使用スキン変更：未所持なら false */
    setActive(skinId) {
      const d = load();
      if (!d.owned.includes(skinId)) return false;
      d.active = skinId;
      save(d);
      return true;
    },
  };
})();
