// طباعة سريعة: بيستقبل المشاركة من الواتس (كلام أو صورة) وبيشتغل بلا إنترنت
const CACHE = 'quickprint-v1';
const FILES = ['./', 'index.html', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('quickprint-v') && k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share')) {
    e.respondWith((async () => {
      try {
        const f = await e.request.formData(), c = await caches.open('quickprint-share');
        const text = [f.get('title'), f.get('text'), f.get('url')].filter(x => typeof x === 'string' && x).join('\n');
        await c.put('shared-text', new Response(text));
        const img = f.getAll('image').find(x => x && x.size);
        if (img) await c.put('shared-image', new Response(img, { headers: { 'Content-Type': img.type || 'image/png' } }));
        else await c.delete('shared-image');
      } catch (err) { /* */ }
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
