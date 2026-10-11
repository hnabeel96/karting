// Service worker: makes Karting installable and lets it start without a connection.
//
// Strategy: network first, cache as backup. When online you always get the latest
// deploy; when offline the last copy still loads, so "Race bots" and free drive work.
// Live race traffic (/ws) and /health are never touched.

const CACHE = 'karting-v1';

// the files needed to start the game at all
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './vendor/three.module.min.js',
  './vendor/addons/loaders/GLTFLoader.js',
  './vendor/addons/utils/BufferGeometryUtils.js',
  './src/main.js',
  './src/arena3d.js',
  './src/audio.js',
  './src/fx.js',
  './src/input.js',
  './src/kartModel.js',
  './src/models.js',
  './src/session-local.js',
  './src/session-net.js',
  './src/util.js',
  './models/manifest.js',
  '../shared/sim.js',
  '../shared/race.js',
  '../shared/track.js',
  '../shared/bot.js',
  '../shared/net.js',
  '../shared/arenas/circuit.js',
  '../shared/arenas/temple.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !fonts) return;
  if (sameOrigin && (url.pathname === '/ws' || url.pathname === '/health')) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'))),
  );
});
