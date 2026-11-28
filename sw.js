// Service Worker: يجعل التطبيق يعمل بدون إنترنت
// الشبكة أولاً (مع تجاوز كاش المتصفح حتى تصل التحديثات فوراً)، والكاش عند انقطاع الإنترنت
// - إذا النت ضعيف أو «متصل بلا إنترنت» (الراوتر شغّال والنت مقطوع): ما منستنى للأبد،
//   بعد ثانيتين ونص منفتح من الكاش، وبنكمّل التحديث بالخلفية
// - بعد أول بطء: منفتح من الكاش دغري لدقيقة (هيك ما منستنى عند كل ملف)
const CACHE = 'daftar-v176';
const FILES = ['./', 'index.html', 'store.js', 'styles.css', 'app.js', 'cloud.js', 'printer.js', 'import.js', 'order.js', 'voice.js', 'calc.js', 'config.js', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'lib/xlsx.full.min.js', 'lib/qrcode.js'];
const WAIT = 2500, SLOW_FOR = 60000;
let slowUntil = 0;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  // منمسح نسخ دفتر القديمة بس (كاش «الطباعة السريعة» إله لحاله)
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('daftar-') && k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

function fromCache(req) {
  return caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined));
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  const net = fetch(req, { cache: 'no-cache' }).then(r => {
    // منخزّن بس الرد الصحيح من موقعنا (مش صفحة خطأ ولا صفحة دخول شبكة واي فاي)
    if (r.ok && r.type === 'basic' && !r.redirected) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    slowUntil = 0;
    return r;
  });
  e.waitUntil(net.catch(() => {})); // التحديث بيكمل بالخلفية حتى لو فتحنا من الكاش
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
