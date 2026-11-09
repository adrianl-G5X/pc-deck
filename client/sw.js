// Service worker : garde une copie de l'interface sur la tablette.
// - PC joignable : on prend toujours la version la plus récente (et on met la copie à jour).
// - PC injoignable : on affiche la copie, et l'appli attend la reconnexion.
// Les données en direct (WebSocket /ws, /api) ne passent jamais par ici.

const CACHE = 'pcdeck-v25';
const SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/remote.js',
  '/chart.js',
  '/icons.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }).then((r) => r || caches.match('/')))
  );
});
