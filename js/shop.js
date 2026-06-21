/* =========================================================================
 * shop.js
 * スキンショップ画面の描画・購入・スキン選択。
 * ========================================================================= */

const Shop = {
  render() {
    const pts   = SkinStore.getPoints();
    const owned = SkinStore.getOwned();

    document.getElementById('shop-points').textContent = pts.toLocaleString() + ' pt';

    // 開発モード中はショップ上部に「全スキン試着中」を表示
    const hint = document.querySelector('#shop-screen .shop-hint');
    if (hint) {
      hint.classList.toggle('dev-hint', SkinStore.isDev());
      hint.innerHTML = SkinStore.isDev()
        ? '🛠 開発モード：全スキン試着中（購入不要・本番データは変更されません）'
        : 'ゲームで勝利・参加するとポイントが貯まります<br>購入したスキンはホーム画面の各プレイヤー設定で選べます';
    }

    const grid = document.getElementById('shop-grid');
    grid.innerHTML = '';

    for (const def of SKIN_DEFS) {
      const isOwned   = owned.includes(def.id);
      const canAfford = pts >= def.price;

      const previewColor = CONFIG.PLAYER_COLORS[0];
      const card = document.createElement('div');
      card.className = 'skin-card' + (isOwned ? ' skin-active' : '');

      /* アクションボタン（購入のみ。スキン選択はホーム画面のプレイヤー設定で行う） */
      let actionHtml;
      if (isOwned) {
        actionHtml = `<button class="seg-btn active" disabled>所持済み</button>`;
      } else if (canAfford) {
        actionHtml = `<button class="shop-buy-btn primary-btn shop-sm-btn" data-id="${def.id}">${def.price.toLocaleString()}pt<br><small>で購入</small></button>`;
      } else {
        actionHtml = `<button class="ghost-btn shop-sm-btn" disabled>${def.price.toLocaleString()}pt<br><small>pt不足</small></button>`;
      }

      /* 価格・所持表示 */
      let metaHtml;
      if (def.price === 0) {
        metaHtml = `<div class="skin-badge free-badge">無料</div>`;
      } else if (isOwned) {
        metaHtml = `<div class="skin-badge owned-badge">所持済み</div>`;
      } else {
        metaHtml = `<div class="skin-price-tag${canAfford ? '' : ' unaffordable'}">${def.price.toLocaleString()} pt</div>`;
      }

      card.innerHTML = `
        <div class="skin-preview">${def.drawCharacter(previewColor, 1)}</div>
        <div class="skin-info">
          <div class="skin-name">${def.name}</div>
          <div class="skin-desc">${def.desc}</div>
          ${metaHtml}
        </div>
        <div class="skin-action">${actionHtml}</div>
      `;

      card.querySelector('.shop-buy-btn')?.addEventListener('click', () => this.onBuy(def.id));

      grid.appendChild(card);
    }
  },

  onBuy(skinId) {
    if (SkinStore.purchase(skinId)) {
      const newly = AchievementStore.onPurchase();
      if (newly.length) Sound.play('achievement');
      this.render();
    }
  },
};
