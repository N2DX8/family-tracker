// ─────────────────────────────────────────────
// Family Spending Tracker — Service Worker v2
// Fully offline — no CDN dependencies
// ─────────────────────────────────────────────

const CACHE = 'family-tracker-v2';

// Everything the app needs — all local, no CDN
const PRECACHE = [
  './spending-tracker.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// ── INSTALL: cache all local assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// ── ACTIVATE: delete old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── FETCH: cache-first for everything (app is self-contained)
self.addEventListener('fetch', event => {
  // Only handle same-origin requests
  if (!event.request.url.startsWith(self.location.origin) &&
      !event.request.url.includes('spending-tracker') &&
      !event.request.url.includes('manifest') &&
      !event.request.url.includes('icon-')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      // Not in cache — fetch and cache it
      return fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline and not cached — serve the app shell for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('./spending-tracker.html');
        }
      });
    })
  );
});
