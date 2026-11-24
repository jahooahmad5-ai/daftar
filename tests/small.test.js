'use strict';
// الأشياء الصغيرة: تبويب واحد شغّال، ترقيم القيود، والسرعة (مع التأكد إنه الحسابات بتضل صح)
const assert = require('assert');
const { page, OWNER } = require('./helpers');

module.exports = [
  {
    name: 'تبويبين: القديم بيوقف وما بيكتب فوق الجديد، و«استعمل هون» بترجّعه',
    fn: async base => {
      const A = await page(base, { cloud: OWNER });
      await A.evaluate(async () => { db.items.push({ id: 'x1', name: 'من التبويب الأول' }); save(); await Store.flush(); });
      // تبويب تاني بنفس المتصفح
      const B = await A.context().newPage();
      B.errors = []; B.on('pageerror', e => B.errors.push(e.message)); B.on('dialog', d => d.accept());
      await B.route(/supabase\.co/, A.cloud.handler);
      await B.goto(base + '#/');
      await B.waitForFunction(() => window.Cloud && typeof route === 'function', null, { timeout: 15000 });
      await B.waitForTimeout(600);
      assert.strictEqual(await A.locator('#tabCover').isVisible(), true, 'التبويب القديم لازم يوقف');
      assert.strictEqual(await B.evaluate(() => db.items.some(i => i.id === 'x1')), true, 'التبويب الجديد لازم يشوف شغل القديم');
      // التبويب الجديد بيحفظ، وبعدين القديم بيحاول يحفظ (لازم ما يكتب فوقه)
      await B.evaluate(async () => { db.items.push({ id: 'x2', name: 'من التبويب التاني' }); save(); await Store.flush(); });
      await A.evaluate(async () => { db.items.push({ id: 'ghost', name: 'لازم ما ينحفظ' }); save(); await Store.flush(); });
      // «استعمل هون» بالقديم ← بيرجع شغّال بآخر البيانات، والتاني بيوقف
      await A.click('#tcUse'); await A.waitForTimeout(2200);
      await A.waitForFunction(() => window.Cloud && typeof route === 'function', null, { timeout: 15000 });
      const ids = await A.evaluate(() => db.items.map(i => i.id).sort().join(','));
      assert.strictEqual(ids, 'x1,x2', 'لازم ياخد آخر شي من التبويب التاني (وبلا شي من وقت ما كان موقف)');
      assert.strictEqual(await A.locator('#tabCover').count(), 0);
      assert.strictEqual(await B.locator('#tabCover').isVisible(), true);
      assert.deepStrictEqual([...A.errors, ...B.errors], []);
    },
  },
  {
    name: 'قيد الرصيد الافتتاحي بياخد رقمه من السيرفر، والقيد المكرر بلا نت بيتصلّح',
    fn: async base => {
      const p = await page(base, { cloud: OWNER, hash: '#/parties' });
      p.cloud.counter = 500; // السيرفر واصل لرقم 500
      await p.click('[data-act=add]'); await p.waitForTimeout(300);
      await p.fill('#dlg [name=name]', 'زبون جديد'); await p.fill('#dlg [name=openBal]', '5000');
      await p.click('#dlg button.pri'); await p.waitForTimeout(300);
      const e = await p.evaluate(() => db.entries.slice(-1)[0]);
      assert.strictEqual(e.no, 501, 'الرقم لازم يكون من السيرفر (محجوز)'); assert.ok(!e.nl);
      const r = await p.evaluate(async () => {
        db.entries.push({ id: 'e1', no: 77, date: today(), desc: 'أ', lines: [] }, { id: 'e2', no: 77, nl: 1, date: today(), desc: 'ب', lines: [] }); save();
        await Cloud.sync(true); return db.entries.filter(x => ['e1', 'e2'].includes(x.id)).map(x => x.no);
      });
      assert.strictEqual(r[0], 77); assert.notStrictEqual(r[1], 77);
    },
  },
  {
    name: 'السرعة: الأرصدة وآخر سعر للزبون بيطلعوا متل الحساب اليدوي تماماً، ومع آلاف الفواتير بتضل سريعة',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      const r = await p.evaluate(() => {
        for (let i = 0; i < 120; i++) db.items.push({ id: 'i' + i, code: String(i + 1), name: 'مادة ' + i, sellPrice: 1000, buyPrice: 900, openQty: 500, openCost: 900 });
        for (let i = 0; i < 300; i++) db.accounts.push({ id: 'c' + i, code: '112' + String(i + 1).padStart(4, '0'), name: 'زبون ' + i, type: 'asset', parent: 'customers', group: false });
        for (let i = 0; i < 20000; i++) db.invoices.push({ id: 'v' + i, type: i % 13 ? 'sale' : 'saleReturn', no: i + 1, date: '2026-' + String(1 + (i % 11)).padStart(2, '0') + '-' + String(1 + (i % 27)).padStart(2, '0'), pay: i % 3 ? 'credit' : 'cash', cashAcc: 'cash', party: 'c' + (i % 300), cur: i % 17 ? 'base' : 'fx', rate: i % 17 ? '' : 13000, lines: [{ item: 'i' + (i % 120), qty: 1 + (i % 4), price: i % 17 ? 900 + (i % 50) : 0.1 }], discount: i % 5, created: i });
        for (let i = 0; i < 3000; i++) db.vouchers.push({ id: 'r' + i, type: 'receipt', no: i + 1, date: '2026-0' + (1 + (i % 9)) + '-15', acc: 'c' + (i % 300), cashAcc: 'cash', amount: 100 + i, cur: 'base', rate: '', created: i });
        const t0 = performance.now(); save(); engine(); const home = (location.hash = '#/', route(), performance.now() - t0);
        // حساب يدوي بطيء للمقارنة
        let worst = 0;
        for (let k = 0; k < 300; k += 37) {
          const id = 'c' + k; let dr = 0, cr = 0;
          for (const e of engine().entries) for (const l of e.lines) if (l.acc === id) { dr += l.dr; cr += l.cr; }
          worst = Math.max(worst, Math.abs((dr - cr) - partyBal(acc(id))));
        }
        const R = rollAll(), cust = natural(acc('customers'), R.customers);
        let sum = 0; for (let k = 0; k < 300; k++) sum += partyBal(acc('c' + k));
        // حساب جديد بينضاف وبينشاف دغري (فهرس الحسابات بيتجدّد)
        db.accounts.push({ id: 'fresh', code: '1129999', name: 'جديد', type: 'asset', parent: 'customers', group: false });
        const fresh = !!acc('fresh') && children('customers').some(a => a.id === 'fresh');
        return { home: Math.round(home), worst, groupDiff: Math.abs(cust - sum), fresh };
      });
      assert.ok(r.worst < 0.01, 'رصيد زبون مختلف عن الحساب اليدوي: ' + r.worst);
      assert.ok(r.groupDiff < 0.01, 'مجموع العملاء مختلف: ' + r.groupDiff);
      assert.strictEqual(r.fresh, true);
      assert.ok(r.home < 4000, 'الشاشة الرئيسية بطيئة كتير مع 20 ألف فاتورة: ' + r.home + 'ms');
      // آخر سعر للزبون (بالطريقة السريعة) = الطريقة القديمة
      await p.go('#/invoice/new?type=sale'); await p.closeDlg(); await p.click('[data-act=more]');
      await p.selectOption('[name=party]', 'c7'); await p.dispatchEvent('[name=party]', 'change');
      await p.click('#scanIn'); await p.keyboard.type('مادة 7'); await p.waitForTimeout(300);
      const shown = (await p.locator('.sg-meta').first().innerText()).match(/[\d,]+/)[0].replace(/,/g, '');
      const expect = await p.evaluate(() => {
        let best = null;
        for (const d of db.invoices) { if (d.type !== 'sale' || d.party !== 'c7') continue; const l = d.lines.find(x => x.item === 'i7'); if (!l || !num(l.price)) continue; const k = d.date + String(d.created).padStart(15, '0'); if (!best || k > best.k) best = { k, p: num(l.price) * docRate(d) }; }
        return best ? String(r2(best.p)) : String(1000);
      });
      assert.strictEqual(shown, expect);
    },
  },
];
