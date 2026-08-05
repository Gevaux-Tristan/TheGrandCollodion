// Offline support. Strategy:
// - install: precache the small app shell
// - navigations AND same-origin CSS/JS: network-first, cache fallback.
//   Code must never lag behind the HTML that references it (stale JS next
//   to fresh HTML broke the Cadre feature), so no stale-while-revalidate.
// - textures, images, fonts (incl. Google Fonts): cache-first, cached on first use
// The app preloads every texture at startup, so one online visit fills the cache.
// Single source of truth: must match the ?v= query in index.html. Deriving
// both the cache name and the precache URLs from it keeps them in lockstep.
const ASSET_VERSION = 9;
const CACHE_VERSION = 'collodion-v' + ASSET_VERSION;
const SHELL_CACHE = CACHE_VERSION + '-shell';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';

const SHELL_ASSETS = [
  './',
  './index.html',
  `./style.css?v=${ASSET_VERSION}`,
  `./script.js?v=${ASSET_VERSION}`,
  './logo.svg',
  './manifest.json',
  './favicon.png',
  './favicon-32x32.png',
  './apple-touch-icon.png',
  './android-chrome-192x192.png',
  './android-chrome-512x512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => !key.startsWith(CACHE_VERSION)).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  // Navigations: network-first so deploys show up, cached shell offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCode = isSameOrigin && /\.(css|js)$/.test(url.pathname);

  if (isCode) {
    // Network-first: code stays in lockstep with the HTML; cache is the
    // offline fallback only
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Textures, images, fonts: cache-first (immutable in practice)
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response && (response.ok || response.type === 'opaque')) {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
