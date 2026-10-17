// Offline support: app shell from cache (refreshed in the background); the pinned library versions from the CDN
// (pdf.js, Tesseract incl. German language model, ExcelJS) are cached on first use. PDFs are never sent anywhere.
const CACHE = 'jahresabschluss-v1';
const LIB_CACHE = 'jahresabschluss-libs-v1';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/schema.js',
  './js/parse.js',
  './js/analysis.js',
  './js/excel.js',
  './js/pdf.js',
  './manifest.webmanifest',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== LIB_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(caches.open(LIB_CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: request.mode === 'navigate' }).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
