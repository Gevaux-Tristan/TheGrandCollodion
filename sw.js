// Offline support. Strategy:
// - install: precache the small app shell
// - navigations: network-first, cache fallback (works offline, fresh when online)
// - CSS/JS: stale-while-revalidate (updates land one reload later)
// - textures, images, fonts (incl. Google Fonts): cache-first, cached on first use
// The app preloads every texture at startup, so one online visit fills the cache.
const CACHE_VERSION = 'collodion-v4';
const SHELL_CACHE = CACHE_VERSION + '-shell';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';

const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
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
    // Stale-while-revalidate: serve cached immediately, refresh in background
    event.respondWith(
      caches.open(SHELL_CACHE).then(cache =>
        cache.match(request).then(cached => {
          const refresh = fetch(request)
            .then(response => {
              if (response && response.ok) cache.put(request, response.clone());
              return response;
            })
            .catch(() => cached);
          return cached || refresh;
        })
      )
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
