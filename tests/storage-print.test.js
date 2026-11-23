'use strict';
// التخزين (IndexedDB والنسخ الأوتوماتيكية)، الطباعة، والآلة الحاسبة
const assert = require('assert');
const { page, OWNER, REP } = require('./helpers');

// محاكاة الطابعة: منرجّع الصورة من أوامر ESC/POS
function decodeEscpos(data, bw) {
  const rows = []; let i = 0;
  while (i < data.length) {
    if (data[i] === 0x1b && data[i + 1] === 0x40) { i += 2; continue; }
    if (data[i] === 0x1b && data[i + 1] === 0x4a) { for (let k = 0; k < data[i + 2]; k++) rows.push('0'.repeat(bw)); i += 3; continue; }
    if (data[i] === 0x1d && data[i + 1] === 0x76) {
      const m = data[i + 3], w = data[i + 4] + data[i + 5] * 256, h = data[i + 6] + data[i + 7] * 256; i += 8;
      for (let r = 0; r < h; r++) { const row = data.slice(i, i + w).map(b => b.toString(16)).join(','); rows.push(row); if (m === 2) rows.push(row); i += w; }
      continue;
    }
    if (data[i] === 0x1b && data[i + 1] === 0x64) { i += 3; continue; }
    throw new Error('أمر غريب بالبايت ' + i);
  }
  return rows;
}

module.exports = [
  {
    name: 'البيانات القديمة بتنتقل لحالها لـ IndexedDB وبتتحمّل بيانات كبيرة',
    fn: async base => {
      const old = JSON.stringify({ version: 1, settings: { company: 'محلات الاختبار' }, accounts: [], items: [{ id: 'o1', name: 'مادة قديمة' }], groups: [], invoices: [], vouchers: [], entries: [], seq: {} });
      const p = await page(base, { cloud: OWNER, ls: { 'daftar-db-v1': old } });
      assert.deepStrictEqual(await p.evaluate(() => ({ c: db.settings.company, n: db.items.length, ls: !!localStorage.getItem('daftar-db-v1'), idb: Store.info().idb })), { c: 'محلات الاختبار', n: 1, ls: false, idb: true });
      await p.evaluate(async () => { const pad = 'x'.repeat(1000); for (let i = 0; i < 8000; i++) db.items.push({ id: 'b' + i, name: 'm' + i, pad }); save(); await Store.flush(); });
      await p.reload(); await p.waitForFunction(() => typeof db !== 'undefined' && db.items.length > 1, null, { timeout: 20000 });
      assert.strictEqual(await p.evaluate(() => db.items.length), 8001, 'البيانات الكبيرة (أكبر من localStorage) لازم تضل');
    },
  },
  {
    name: 'النسخ الأوتوماتيكية: آخر 7 أيام، رجوع لنسخة بيوصل للسحابة، وتراجع عن الرجوع',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(async () => {
        await autoBackup();
        for (let i = 1; i <= 10; i++) { const d = new Date(Date.now() - i * 864e5);
          await Store.put('bak:' + isoLocal(d), JSON.stringify({ at: d.getTime(), db: { ...db, items: Array.from({ length: i }, (_, k) => ({ id: 'o' + k, name: 'قديمة' })) } })); }
        db.items.push({ id: 'new1', name: 'جديدة' }); save(); await Store.flush();
      });
      await p.go('#/settings'); await p.waitForTimeout(800);
      assert.strictEqual(await p.locator('#autoBk .bk-row').count(), 7);
      p.cloud.pushed.length = 0;
      await p.locator('#autoBk [data-bk=back]').nth(3).click(); await p.waitForTimeout(2500);
      assert.strictEqual(await p.evaluate(() => db.items.length), 3);
      assert.ok(p.cloud.pushed.some(x => x.id === 'new1' && x.deleted), 'المادة الجديدة لازم تنمسح من السحابة كمان');
      await p.go('#/settings'); await p.waitForTimeout(800);
      await p.locator('#autoBk .bk-row', { hasText: 'قبل آخر رجوع' }).locator('[data-bk=back]').click(); await p.waitForTimeout(500);
      assert.deepStrictEqual(await p.evaluate(() => db.items.map(i => i.id)), ['new1']);
    },
  },
  {
    name: 'الطباعة: أوامر الطابعة بترجّع نفس الإيصال (عادي وسريع) والسريع أصغر',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      const r = await p.evaluate(() => {
        db.settings.company = 'محلات النور';
        db.accounts.push({ id: 'cust1', code: '112001', name: 'أحمد', type: 'asset', parent: 'customers', group: false });
        for (let i = 0; i < 6; i++) db.items.push({ id: 'i' + i, name: 'مادة ' + i, sellPrice: 1000 });
        const inv = { id: 'x', type: 'sale', no: 5, date: today(), pay: 'credit', party: 'cust1', cur: 'base', rate: '', lines: db.items.map(it => ({ item: it.id, qty: 2, price: 1000 })), discount: 0, created: Date.now() };
        const c = Receipt.build(inv), W = c.width, H = c.height, px = c.getContext('2d').getImageData(0, 0, W, H).data, bw = W / 8;
        const want = [];
        for (let y = 0; y < H; y++) { const row = new Array(bw).fill(0); for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (px[i + 3] > 0 && px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11 < 150) row[x >> 3] |= 0x80 >> (x & 7); } want.push(row); }
        return { bw, H, want, slow: Array.from(Receipt.escpos(c, false)), fast: Array.from(Receipt.escpos(c, true)) };
      });
      const hex = row => row.map(b => b.toString(16)).join(',');
      const slow = decodeEscpos(r.slow, r.bw);
      assert.deepStrictEqual(slow.map(x => (/^0+$/.test(x) ? new Array(r.bw).fill(0).map(b => b.toString(16)).join(',') : x)), r.want.map(hex));
      const merged = []; for (let y = 0; y < r.H; y += 2) { const a = r.want[y], b = r.want[y + 1] || a.map(() => 0); const m = hex(a.map((v, k) => v | b[k])); merged.push(m, m); }
      const fast = decodeEscpos(r.fast, r.bw).map(x => (/^0+$/.test(x) ? new Array(r.bw).fill(0).map(b => b.toString(16)).join(',') : x));
      assert.deepStrictEqual(fast, merged);
      assert.ok(r.fast.length < r.slow.length * 0.6, `السريع لازم يكون أصغر بكتير (${r.fast.length} مقابل ${r.slow.length})`);
    },
  },
  {
    name: 'إيصال سند القبض بينرسم بالجديد والقديم',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      const h = await p.evaluate(() => {
        db.accounts.push({ id: 'cust1', code: '112001', name: 'أحمد', type: 'asset', parent: 'customers', group: false });
        return Receipt.buildVoucher({ id: 'v', type: 'receipt', no: 7, date: today(), acc: 'cust1', cashAcc: 'cash', amount: 15000, cur: 'base', rate: '', rep: 'محمد', created: Date.now() }).height;
      });
      assert.ok(h > 400);
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'الآلة الحاسبة: بتحسب وبتحط النتيجة بالخانة (حتى فوق النوافذ)',
    fn: async base => {
      const p = await page(base, { cloud: REP, ls: { daftar_rep_name: 'محمد' } });
      await p.evaluate(() => { db.accounts.push({ id: 'repbox_1', code: '1113', name: 'صندوق المندوب: محمد', type: 'asset', parent: 'cashGroup', group: false, repBox: 'محمد' }); save(); route(); });
      await p.click('#calcFab');
      for (const k of ['2', '0', '0', '+', '1', '0', '%']) await p.click(`#calcBox [data-k="${k}"]`);
      assert.strictEqual(await p.textContent('#calcOut'), '220');
      await p.click('#calcBox [data-k="close"]');
      await p.click('a[href="#/vouchers?new=receipt"]'); await p.waitForTimeout(300);
      assert.ok(await p.evaluate(() => !!document.querySelector('dialog[open] #calcFab')));
      await p.click('#dlg [name=amount]'); await p.click('#calcFab');
      for (const k of ['2', '5', '0', '×', '4', '=']) await p.click(`#calcBox [data-k="${k}"]`);
      await p.click('#calcPut');
      assert.strictEqual(await p.inputValue('#dlg [name=amount]'), '1000');
    },
  },
];
