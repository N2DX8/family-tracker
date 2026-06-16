// ─────────────────────────────────────────────
// HomeBase — Service Worker v4
// Offline caching + Prayer Notifications
// ─────────────────────────────────────────────

const CACHE = 'homebase-v4';

const PRECACHE = [
  './spending-tracker.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = event.request.url;
  if (!url.startsWith(self.location.origin) &&
      !url.includes('spending-tracker') &&
      !url.includes('manifest') &&
      !url.includes('icon-')) return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
        }
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') return caches.match('./spending-tracker.html');
      });
    })
  );
});

// ══ PRAYER NOTIFICATION ENGINE ══════════════════
let _prayers = [];
let _checkTimer = null;

self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'PRAYER_TIMES') {
    _prayers = event.data.prayers || [];
    if (_checkTimer) clearInterval(_checkTimer);
    _checkTimer = setInterval(_checkPrayers, 30000);
    _checkPrayers();
  }
});

async function _checkPrayers() {
  if (!_prayers.length) return;
  const now = new Date();
  const nm = now.getHours() * 60 + now.getMinutes();
  const td = now.toISOString().slice(0, 10);
  for (const p of _prayers) {
    const diff = p.timeMins - nm;
    if (diff === 5 || diff === 4) {
      const tag = 'warn5_' + td + '_' + p.key;
      const ex = await self.registration.getNotifications({ tag });
      if (!ex.length) {
        self.registration.showNotification('⏰ ' + p.name + ' dalam 5 minit', {
          body: p.ar + ' — Bersiap untuk solat ' + p.name,
          icon: './icon-192.png', badge: './icon-192.png', tag, silent: false,
          data: { prayerKey: p.key, prayerName: p.name, prayerAr: p.ar, prayerEmoji: p.emoji, type: 'warning' }
        });
      }
    }
    if (diff >= 0 && diff <= 1) {
      const tag = 'azan_' + td + '_' + p.key;
      const ex = await self.registration.getNotifications({ tag });
      if (!ex.length) {
        self.registration.showNotification('🕌 Masuk Waktu ' + p.name + ' ' + p.emoji, {
          body: p.ar + '\nاللَّهُ أَكْبَر — Ketuk untuk play Azan',
          icon: './icon-192.png', badge: './icon-192.png', tag, silent: false,
          vibrate: [200,100,200,100,200,100,400], requireInteraction: true,
          data: { prayerKey: p.key, prayerName: p.name, prayerAr: p.ar, prayerEmoji: p.emoji, type: 'azan' }
        });
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        clients.forEach(c => c.postMessage({ type: 'AZAN_TIME', prayer: p }));
      }
    }
  }
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
      for (const client of clients) {
        if (client.url.includes('spending-tracker')) {
          await client.focus();
          if (data.type === 'azan') client.postMessage({ type: 'AZAN_OPEN', prayer: { key: data.prayerKey, name: data.prayerName, ar: data.prayerAr, emoji: data.prayerEmoji }});
          return;
        }
      }
      if (self.clients.openWindow) {
        const nc = await self.clients.openWindow('./spending-tracker.html');
        if (nc && data.type === 'azan') setTimeout(() => nc.postMessage({ type: 'AZAN_OPEN', prayer: { key: data.prayerKey, name: data.prayerName, ar: data.prayerAr, emoji: data.prayerEmoji }}), 3000);
      }
    })
  );
});

self.addEventListener('periodicsync', event => {
  if (event.tag === 'homebase-prayer') event.waitUntil(_checkPrayers());
});
