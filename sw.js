/* ============================================================
   sw.js — Budologist Stock — Service Worker
   Cache-first for app shell, network-first for Firebase data.
   ============================================================ */

const CACHE_NAME  = 'bud-stock-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './firebase.js',
  './icons/1.png',
  './icons/2.png',
  './icons/3.png',
  './icon.png'
];

/* ─── Install: pre-cache app shell ───────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

/* ─── Activate: clean old caches ─────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* ─── Fetch: cache-first for shell, pass-through for API ─── */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* Let Firebase & Google API calls go straight to network */
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com')
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
