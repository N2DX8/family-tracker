// ─────────────────────────────────────────────
// HomeBase — Service Worker v5
// Offline caching + Prayer Notifications
// ─────────────────────────────────────────────

const CACHE = 'homebase-v5';

const PRECACHE = [
  './spending-tracker.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// ── INSTALL ────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// ── ACTIVATE ───────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── FETCH: cache-first ─────────────────────────
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
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate')
          return caches.match('./spending-tracker.html');
      });
    })
  );
});

// ══════════════════════════════════════════════
// PRAYER NOTIFICATION ENGINE
// ══════════════════════════════════════════════

let _prayers = [];       // [{key, name, emoji, ar, timeMins}]
let _checkTimer = null;

// ── Receive prayer times from main page ────────
self.addEventListener('message', event => {
  if (!event.data) return;

  if (event.data.type === 'PRAYER_TIMES') {
    _prayers = event.data.prayers || [];
    _armTimer();
  }
});

function _armTimer() {
  if (_checkTimer) clearInterval(_checkTimer);
  _checkTimer = setInterval(_checkPrayers, 30 * 1000); // every 30 seconds
  _checkPrayers(); // run immediately
}

// ── Core check: fires every 30s ────────────────
async function _checkPrayers() {
  if (!_prayers.length) return;

  const now = new Date();
  const nm  = now.getHours() * 60 + now.getMinutes();
  const td  = now.toISOString().slice(0, 10);

  for (const p of _prayers) {
    const diff = p.timeMins - nm;

    // ── 5-minute warning ───────────────────────
    if (diff === 5 || diff === 4) {
      const tag = `warn5_${td}_${p.key}`;
      const existing = await self.registration.getNotifications({ tag });
      if (!existing.length) {
        self.registration.showNotification(`⏰ ${p.name} dalam 5 minit`, {
          body: `${p.ar} — Bersiap untuk solat ${p.name}`,
          icon: './icon-192.png',
          badge: './icon-192.png',
          tag,
          silent: false,
          data: { prayerKey: p.key, prayerName: p.name, prayerAr: p.ar, prayerEmoji: p.emoji, type: 'warning' }
        });
      }
    }

    // ── Azan time (0–1 min window) ─────────────
    if (diff >= 0 && diff <= 1) {
      const tag = `azan_${td}_${p.key}`;
      const existing = await self.registration.getNotifications({ tag });
      if (!existing.length) {
        self.registration.showNotification(`🕌 Masuk Waktu ${p.name} ${p.emoji}`, {
          body: `${p.ar}\nاللَّهُ أَكْبَر — Ketuk untuk play Azan`,
          icon: './icon-192.png',
          badge: './icon-192.png',
          tag,
          silent: false,
          vibrate: [200, 100, 200, 100, 200, 100, 400],
          requireInteraction: true,
          data: { prayerKey: p.key, prayerName: p.name, prayerAr: p.ar, prayerEmoji: p.emoji, type: 'azan' }
        });

        // Also push to any open app windows (plays azan in-app immediately)
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clients) {
          client.postMessage({ type: 'AZAN_TIME', prayer: p });
        }
      }
    }
  }
}

// ── Notification click: open app + play azan ──
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => {
      // If app already open — focus + trigger azan
      for (const client of clients) {
        if (client.url.includes('spending-tracker')) {
          await client.focus();
          if (data.type === 'azan') {
            client.postMessage({
              type: 'AZAN_OPEN',
              prayer: {
                key:   data.prayerKey,
                name:  data.prayerName,
                ar:    data.prayerAr,
                emoji: data.prayerEmoji
              }
            });
          }
          return;
        }
      }
      // App was closed — open it; azan plays after page loads
      if (self.clients.openWindow) {
        const newClient = await self.clients.openWindow('./spending-tracker.html');
        if (newClient && data.type === 'azan') {
          // Page needs ~3 s to boot before it can receive messages
          setTimeout(() => {
            newClient.postMessage({
              type: 'AZAN_OPEN',
              prayer: {
                key:   data.prayerKey,
                name:  data.prayerName,
                ar:    data.prayerAr,
                emoji: data.prayerEmoji
              }
            });
          }, 3000);
        }
      }
    })
  );
});

// ── Periodic Background Sync (Chrome Android) ──
// Wakes SW even when app is fully closed.
// Requires: navigator.permissions 'periodic-background-sync' granted.
self.addEventListener('periodicsync', event => {
  if (event.tag === 'homebase-prayer') {
    event.waitUntil(_checkPrayers());
  }
});
