/* =========================================================================
 * shop.js
 * スキンショップ画面の描画・購入・スキン選択。
 * ========================================================================= */

const Shop = {
  render() {
    const pts    = SkinStore.getPoints();
    const owned  = SkinStore.getOwned();
    const active = SkinStore.getActive();

    document.getElementById('shop-points').textContent = pts.toLocaleString() + ' pt';

    const grid = document.getElementById('shop-grid');
    grid.innerHTML = '';

    for (const def of SKIN_DEFS) {
      const isOwned   = owned.includes(def.id);
      const isActive  = active === def.id;
      const canAfford = pts >= def.price;

      const previewColor = CONFIG.PLAYER_COLORS[0];
      const card = document.createElement('div');
      card.className = 'skin-card' + (isActive ? ' skin-active' : '');

      /* アクションボタン */
      let actionHtml;
      if (isActive) {
        actionHtml = `<button class="seg-btn active" disabled>使用中</button>`;
      } else if (isOwned) {
        actionHtml = `<button class="shop-use-btn seg-btn" data-id="${def.id}">使用する</button>`;
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

      card.querySelector('.shop-use-btn')?.addEventListener('click', () => this.onUse(def.id));
      card.querySelector('.shop-buy-btn')?.addEventListener('click', () => this.onBuy(def.id));

      grid.appendChild(card);
    }
  },

  onUse(skinId) {
    SkinStore.setActive(skinId);
    this.render();
  },

  onBuy(skinId) {
    if (SkinStore.purchase(skinId)) {
      SkinStore.setActive(skinId);
      this.render();
    }
  },
};
