/* 5 Cards — service worker.
   Network first, so a new deploy is always picked up straight away. If the network is slow or
   offline (for example while a free server wakes up), the saved copy opens instantly instead. */
const CACHE = 'five-cards-v3';
const SHELL = ['/', 'index.html', 'style.css', 'config.js', 'engine.js', 'bot.js', 'room.js', 'audio.js',
  'voice.js', 'stats.js', 'net.js', 'ui.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const SLOW_MS = 3500;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname === '/healthz' || url.pathname.startsWith('/.well-known/') || url.pathname === '/ws') return;
  e.respondWith(networkFirst(req));
});

function networkFirst(req) {
  const key = req.mode === 'navigate' ? '/index.html' : req;
  return new Promise(resolve => {
    let done = false;
    const finish = r => { if (!done && r) { done = true; resolve(r); } };
    const fromCache = () => caches.match(key, { ignoreSearch: true });
    const timer = setTimeout(() => fromCache().then(finish), SLOW_MS);
    fetch(req).then(res => {
      clearTimeout(timer);
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
      finish(res);
    }).catch(() => {
      clearTimeout(timer);
      fromCache().then(r => { if (!r) { done = true; resolve(Response.error()); } else finish(r); });
    });
  });
}
