// طباعة سريعة: بيستقبل المشاركة من الواتس (كلام أو صورة) وبيشتغل بلا إنترنت
// - إذا النت ضعيف أو «متصل بلا إنترنت»: بعد ثانيتين ونص منفتح من الكاش وبنكمّل التحديث بالخلفية
// - بعد أول بطء: منفتح من الكاش دغري لدقيقة
const CACHE = 'quickprint-v4';
const WAIT = 2500, SLOW_FOR = 60000;
let slowUntil = 0;
function fromCache(req) {
  return caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined));
}
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
  const req = e.request;
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const net = fetch(req, { cache: 'no-cache' }).then(r => {
    // منخزّن بس الرد الصحيح من موقعنا (مش صفحة خطأ ولا صفحة دخول شبكة واي فاي)
    if (r.ok && r.type === 'basic' && !r.redirected) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    slowUntil = 0;
    return r;
  });
  e.waitUntil(net.catch(() => {}));
  e.respondWith((async () => {
    const offline = self.navigator && self.navigator.onLine === false;
    if (offline || Date.now() < slowUntil) {
      const c = await fromCache(req);
      if (c) return c;
      return net;
    }
    let timer;
    const late = new Promise(res => { timer = setTimeout(() => res('late'), WAIT); });
    try {
      const r = await Promise.race([net, late]);
      if (r !== 'late') return r;
      slowUntil = Date.now() + SLOW_FOR;
      const c = await fromCache(req);
      return c || net;
    } catch (err) {
      const c = await fromCache(req);
      if (c) return c;
      throw err;
    } finally { clearTimeout(timer); }
  })());
});
