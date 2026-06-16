/* =========================================================================
 * sw.js — Service Worker（完全オフライン対応）
 * 全ファイルをキャッシュし、ネット接続が無くても起動・プレイできるようにする。
 *   - install : 必要ファイルを先読みキャッシュ
 *   - fetch   : ナビゲーション=ネット優先（更新反映）／静的資産=キャッシュ優先
 *   - activate: 古いキャッシュを削除
 * アセット更新時は CACHE 名と各URLの ?v= を上げること（index.html と揃える）。
 * ========================================================================= */

const CACHE = 'bombgame-v14';

// 先読みキャッシュ対象（index.html が参照するURLと一致させる）
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './style.css?v=14',
  './js/config.js?v=14',
  './js/skins.js?v=14',
  './js/shop.js?v=14',
  './js/game.js?v=14',
  './js/cpu.js?v=14',
  './js/audio.js?v=14',
  './js/ui.js?v=14',
  './js/main.js?v=14',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.ico',
  './icons/favicon-32.png',
  './icons/favicon-16.png',
];

// インストール：資産を先読み
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 有効化：古いキャッシュを掃除し、即時制御を奪う
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 取得処理
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    // ページ本体：ネット優先（更新を反映）。失敗時はキャッシュ＝オフライン起動。
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // 静的資産：キャッシュ優先（無ければ取得してキャッシュ）
  e.respondWith(
    caches.match(req).then((hit) =>
      hit ||
      fetch(req).then((res) => {
        if (res.ok && req.url.startsWith(self.location.origin)) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => undefined)
    )
  );
});
