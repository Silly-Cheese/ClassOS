const CACHE_NAME = 'classos-1.0-v10';
const APP_SHELL = [
  './',
  './index.html',
  './assets/styles.css',
  './assets/lms.css',
  './assets/intelligence.css',
  './assets/production.css',
  './assets/gradebook.css',
  './assets/icon.svg',
  './manifest.webmanifest',
  './src/firebase.js',
  './src/main.js',
  './src/auth-compat.js',
  './src/terms.js',
  './src/course-tools.js',
  './src/gradebook.js',
  './src/ui-fixes.js',
  './src/lms.js',
  './src/intelligence.js',
  './src/production.js',
  './src/hardening.js',
  './src/student-assessments.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
