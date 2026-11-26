'use strict';
// الفتح بلا نت: البرنامج والطباعة السريعة بيفتحوا من الكاش حتى لو النت مقطوع كلياً،
// أو «معلّق» (الواي فاي شغّال والنت مقطوع: الطلب ما بيفشل، بيضل يستنى)
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { ROOT } = require('./helpers');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

// سيرفر لحاله بيقدر «يعلّق» (ما بيرد أبداً) متل راوتر بلا إنترنت
function hangServer() {
  return new Promise(res => {
    const s = { hang: false, socks: new Set() };
    s.srv = http.createServer((q, r) => {
      if (s.hang) return;
      let f = decodeURIComponent(q.url.split('?')[0]); if (f.endsWith('/')) f += 'index.html';
      const p = path.join(ROOT, f);
      if (!p.startsWith(ROOT) || !fs.existsSync(p)) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(r);
    });
    s.srv.on('connection', k => { s.socks.add(k); k.on('close', () => s.socks.delete(k)); });
    s.stop = () => { s.socks.forEach(k => k.destroy()); s.srv.close(); };
    s.srv.listen(0, '127.0.0.1', () => { s.base = `http://127.0.0.1:${s.srv.address().port}/`; res(s); });
  });
}

async function check(sub, opened, before) {
  const s = await hangServer();
  const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  try {
    const ctx = await b.newContext();
    await ctx.route(/supabase\.co/, r => r.abort());
    const p = await ctx.newPage();
    const url = s.base + sub;
    // أول فتحة بالنت: بينحفظ البرنامج بالكاش
    await p.goto(url);
    await p.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
    await p.reload();
    await p.waitForFunction(opened, null, { timeout: 15000 });
    await p.waitForTimeout(800);
    if (before) await before(p, s.base);

    // النت معلّق: لازم يفتح من الكاش بثواني، مش يضل يستنى
    s.hang = true;
    let t = Date.now();
    await p.goto(url, { timeout: 20000 });
    await p.waitForFunction(opened, null, { timeout: 20000 });
    const hung = Date.now() - t;
    assert.ok(hung < 12000, `النت المعلّق أخد ${hung}ms`);

    // النت مقطوع كلياً: بيفتح فوراً
    s.hang = false; s.socks.forEach(k => k.destroy());
    await ctx.setOffline(true);
    t = Date.now();
    await p.goto(url, { timeout: 15000 });
    await p.waitForFunction(opened, null, { timeout: 15000 });
    assert.ok(Date.now() - t < 5000, `بلا نت أخد ${Date.now() - t}ms`);
    return await p.evaluate(() => caches.keys());
  } finally { await b.close(); s.stop(); }
}

module.exports = [
  {
    name: 'البرنامج (ونقطة البيع) بيفتح من الكاش: النت معلّق (واي فاي بلا إنترنت) أو مقطوع كلياً',
    fn: async () => {
      const keys = await check('', () => window.Cloud && document.querySelector('#view').children.length > 0);
      assert.ok(keys.some(k => k.startsWith('daftar-v')), keys.join());
    },
  },
  {
    name: 'الطباعة السريعة بتفتح من الكاش: النت معلّق أو مقطوع كلياً — وتحديث البرنامج ما بيمسح كاشها',
    fn: async () => {
      // بعد ما انحفظت الطباعة السريعة منفتح البرنامج الأساسي (بيتثبّت ويمسح الكاش القديم تبعه)
      const keys = await check('print/', () => document.readyState === 'complete' && document.body.innerText.trim().length > 10, async (p, base) => {
        await p.goto(base);
        await p.waitForFunction(() => window.Cloud && navigator.serviceWorker.controller, null, { timeout: 15000 });
        await p.waitForTimeout(800);
      });
      assert.ok(keys.some(k => k.startsWith('quickprint-v')), keys.join());
    },
  },
];
