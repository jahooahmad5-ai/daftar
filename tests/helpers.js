'use strict';
// أدوات مشتركة للفحوصات: سيرفر صغير للبرنامج، متصفح، وسحابة وهمية (بدل Supabase)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

function serve() {
  return new Promise(res => {
    const srv = http.createServer((q, r) => {
      let f = decodeURIComponent(q.url.split('?')[0]); if (f.endsWith('/')) f += 'index.html';
      const p = path.join(ROOT, f);
      if (!p.startsWith(ROOT) || !fs.existsSync(p)) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(r);
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, url: `http://127.0.0.1:${srv.address().port}/index.html` }));
  });
}

const OWNER = { session: { access_token: 'o', refresh_token: 'r', expires_at: Date.now() + 1e10, email: 'boss@test', uid: 'u-owner' }, company: 'c1', companyName: 'شركة الاختبار', owner: true, dirty: {}, fullPush1: 1 };
const REP = { session: { access_token: 'p', refresh_token: 'r', expires_at: Date.now() + 1e10, email: 'pos-x@pos.daftar.app', uid: 'u-rep' }, company: 'c1', companyName: 'شركة الاختبار', owner: false, dirty: {}, fullPull1: 1, posReq: { company: 'c1', name: 'محمد' } };

// سحابة وهمية: بتسجّل يلي انرفع، وبتجاوب على الدوال يلي بيطلبها البرنامج
function fakeCloud(opts = {}) {
  const cloud = { pushed: [], counter: 0, companies: opts.companies || [{ id: 'c1', name: 'شركة الاختبار', owner: 'u-owner' }], requests: opts.requests || [] };
  cloud.handler = route => {
    const q = route.request(), u = q.url(), m = q.method();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: typeof b === 'string' ? b : JSON.stringify(b) });
    if (u.includes('/rpc/take_no')) { const b = JSON.parse(q.postData() || '{}'); cloud.counter = Math.max(cloud.counter, Number(b.p_min) || 0) + 1; return json(String(cloud.counter)); }
    if (u.includes('/rpc/approve_pos') || u.includes('/rpc/revoke_pos')) return json('"ok"');
    if (u.includes('/auth/v1/signup')) return json({ access_token: 'new', refresh_token: 'r', expires_in: 3600, user: { id: 'u-new', email: 'pos-new@pos.daftar.app' } });
    if (u.includes('/auth/v1/token')) return json({ access_token: 'tok', refresh_token: 'r', expires_in: 3600, user: { id: opts.loginUid || 'u-owner', email: 'boss@test' } });
    if (u.includes('/rest/v1/pos_requests')) return m === 'GET' ? json(cloud.requests) : json('', 201);
    if (u.includes('/rest/v1/companies')) {
      if (m !== 'GET') return json('', 201);
      const id = (u.match(/id=eq\.([^&]+)/) || [])[1], ow = (u.match(/owner=eq\.([^&]+)/) || [])[1];
      return json(cloud.companies.filter(c => (!id || c.id === decodeURIComponent(id)) && (!ow || c.owner === ow)));
    }
    if (u.includes('/rest/v1/records') && m === 'POST') { JSON.parse(q.postData() || '[]').forEach(x => cloud.pushed.push(x)); return json('', 201); }
    return json([]);
  };
  return cloud;
}

let browser = null;
async function getBrowser() {
  if (!browser) browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  return browser;
}
// صفحة جديدة (موبايل نضيف) — state: { cloud: OWNER|REP|null, ls: {مفتاح: قيمة}, cloudOpts }
async function page(base, state = {}) {
  const b = await getBrowser();
  const ctx = await b.newContext({ viewport: { width: 390, height: 820 }, ...(state.device || {}) });
  await ctx.addInitScript(([c, ls]) => {
    if (sessionStorage.getItem('__init')) return; sessionStorage.setItem('__init', '1');
    if (c) localStorage.setItem('daftar-cloud-v1', JSON.stringify(c));
    for (const k in ls) localStorage.setItem(k, ls[k]);
  }, [state.cloud === undefined ? OWNER : state.cloud, state.ls || {}]);
  const p = await ctx.newPage();
  // CPU_SLOW=4 ← محاكاة جهاز أبطأ (متل موبايل ضعيف أو سيرفر GitHub)
  if (process.env.CPU_SLOW) { const c = await ctx.newCDPSession(p); await c.send('Emulation.setCPUThrottlingRate', { rate: +process.env.CPU_SLOW }); }
  p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  p.on('dialog', d => (state.dialog === 'dismiss' ? d.dismiss() : d.accept()));
  const cloud = fakeCloud(state.cloudOpts);
  await p.route(/supabase\.co/, cloud.handler);
  p.cloud = cloud;
  await p.goto(base + (state.hash || '#/'));
  await p.waitForFunction(() => window.Cloud && typeof route === 'function', null, { timeout: 15000 });
  await p.waitForTimeout(400);
  p.text = async sel => (await p.locator(sel || '#view').innerText()).replace(/\s+/g, ' ');
  p.go = async h => { await p.evaluate(x => { location.hash = x; }, h); await p.waitForTimeout(350); };
  p.closeDlg = () => p.evaluate(() => { const d = document.getElementById('dlg'); if (d.open) d.close(); });
  // فاتورة مبيع جديدة بلا زبون: نافذة «اختار العميل» بتطلع لحالها بعد شوي — منستناها ومنسكّرها
  p.closePicker = async () => { await p.waitForFunction(() => document.getElementById('dlg').open, null, { timeout: 15000 }); await p.closeDlg(); };
  return p;
}
async function close() { if (browser) await browser.close(); browser = null; }

module.exports = { serve, page, close, OWNER, REP, ROOT };
