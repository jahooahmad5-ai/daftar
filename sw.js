// Service Worker: يجعل التطبيق يعمل بدون إنترنت
// الشبكة أولاً (مع تجاوز كاش المتصفح حتى تصل التحديثات فوراً)، والكاش عند انقطاع الإنترنت
const CACHE = 'daftar-v88';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'cloud.js', 'printer.js', 'import.js', 'order.js', 'voice.js', 'config.js', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'lib/xlsx.full.min.js', 'lib/qrcode.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
