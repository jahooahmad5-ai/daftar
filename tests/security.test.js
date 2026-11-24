'use strict';
// حماية: بيانات جاية من موبايل تاني أو من رابط ما بتشغّل كود، والأزرار يلي بتمسح كل شي محمية
const assert = require('assert');
const { page, OWNER } = require('./helpers');

const EVIL = '<img src=x onerror="window.__pwned=(window.__pwned||0)+1">';
const now = () => new Date().toISOString();
// سجلات «ملغومة» كأنها جاية من موبايل مندوب عبر السحابة
const badRecords = [
  { kind: 'invoices', id: 'bad1', deleted: false, data: { id: 'bad1', type: 'sale', no: 7, date: '2026-11-24', pay: 'cash', cashAcc: 'cash', party: '', cur: 'base', rate: '', lines: [], discount: 0, rep: EVIL, note: EVIL, created: 1 } },
  { kind: 'invoices', id: 'bad2', deleted: false, data: { id: 'bad2', type: 'sale', no: EVIL, date: '2026-11-24', pay: 'cash', cashAcc: 'cash', party: '', cur: 'base', rate: '', lines: [], discount: 0, created: 2 } },
  { kind: 'invoices', id: 'bad3', deleted: false, data: { id: 'bad3', type: 'sale" onmouseover="x', no: 3, date: '2026-11-24', pay: 'cash', cashAcc: 'cash', party: '', lines: [], created: 3 } },
  { kind: 'invoices', id: 'bad4', deleted: false, data: { id: 'bad4', type: 'sale', no: 4, date: 20261124, pay: 'cash', cashAcc: 'cash', party: '', lines: 'x', created: 4 } },
  { kind: 'vouchers', id: 'badv', deleted: false, data: { id: 'badv', type: 'receipt', no: EVIL, date: EVIL, acc: 'cash', cashAcc: 'cash', amount: 5, rep: EVIL, created: 5 } },
  { kind: 'seq', id: 'main', deleted: false, data: { sale: '<b>9</b>', receipt: 5 } },
];

module.exports = [
  {
    name: 'بيانات ملغومة جاية من السحابة: ما بتشغّل كود، والغلط منها ما بيوقّف البرنامج',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.unroute(/supabase\.co/);
      await p.route(/supabase\.co/, r => (r.request().url().includes('/rest/v1/records') && r.request().method() === 'GET'
        ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(badRecords.map(x => ({ ...x, updated_at: now() }))) })
        : p.cloud.handler(r)));
      await p.evaluate(() => Cloud.sync(true)); await p.waitForTimeout(400);
      for (const h of ['#/', '#/invoices', '#/invoice/bad1', '#/vouchers', '#/journal', '#/report/statement?acc=cash']) { await p.go(h); await p.waitForTimeout(150); }
      assert.strictEqual(await p.evaluate(() => window.__pwned || 0), 0, 'الكود المخبّى اشتغل!');
      const got = await p.evaluate(() => ({ ids: db.invoices.map(i => i.id).sort().join(','), rep: (db.invoices.find(i => i.id === 'bad1') || {}).rep, seq: db.seq.sale, vch: db.vouchers.length }));
      assert.strictEqual(got.ids, 'bad1', 'الفواتير الغلط (نوع/رقم/تاريخ/مواد مش صحيحين) لازم تنرفض');
      assert.ok(!/[<>]/.test(got.rep), 'اسم المندوب لازم يتنظّف');
      assert.strictEqual(got.vch, 0, 'السند بتاريخ غلط لازم ينرفض');
      assert.ok(!(got.seq > 0) || got.seq === 9, 'الترقيم الغلط ما لازم يخرّب');
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'حتى لو البيانات الملغومة صارت محفوظة عالموبايل، الشاشات بتعرضها كنص وما بتشغّلها',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(e => { db.invoices.push({ id: 'old', type: 'sale', no: e, date: '2026-11-24', pay: 'cash', cashAcc: 'cash', party: '', cur: 'base', rate: '', lines: [], discount: 0, rep: e, created: 1 });
        db.vouchers.push({ id: 'oldv', type: 'receipt', no: e, date: '2026-11-24', acc: 'cash', cashAcc: 'cash', amount: 1, cur: 'base', rate: '', rep: e, created: 2 }); save(); }, EVIL);
      for (const h of ['#/', '#/invoices', '#/invoice/old', '#/vouchers', '#/journal']) { await p.go(h); await p.waitForTimeout(150); }
      await p.go('#/vouchers'); await p.click('tr[data-id="oldv"]'); await p.waitForTimeout(150);
      assert.strictEqual(await p.evaluate(() => window.__pwned || 0), 0);
    },
  },
  {
    name: 'رابط تقرير ملغوم ما بيشغّل كود',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      const e = encodeURIComponent(EVIL);
      await p.go(`#/report/statement?acc=cash&from=${e}&to=${e}`); await p.waitForTimeout(200);
      await p.go(`#/report/income?from=${e}`); await p.waitForTimeout(200);
      assert.strictEqual(await p.evaluate(() => window.__pwned || 0), 0);
      assert.match(await p.text(), /قائمة الدخل/);
    },
  },
  {
    name: '«بيانات تجريبية» ممنوعة والموبايل مربوط بالسحابة، و«مسح كل البيانات» بياخد نسخة قبل',
    fn: async base => {
      const p = await page(base, { cloud: OWNER, hash: '#/settings' });
      await p.evaluate(async () => { db.items.push({ id: 'real1', name: 'مادة حقيقية' }); save(); await Cloud.sync(true); });
      p.cloud.pushed.length = 0;
      await p.click('[data-act=demo]'); await p.waitForTimeout(300); await p.evaluate(() => Cloud.sync(true));
      assert.strictEqual(await p.evaluate(() => db.items.some(i => i.id === 'real1')), true, 'البيانات الحقيقية لازم تضل');
      assert.strictEqual(p.cloud.pushed.filter(x => x.deleted).length, 0, 'ما لازم ينمسح شي من السحابة');
      // مسح الكل (بعد التأكيد) ← في نسخة «قبل آخر رجوع»
      await p.evaluate(() => { window.prompt = () => 'مسح'; });
      await p.click('[data-act=reset]'); await p.waitForTimeout(500);
      const pre = await p.evaluate(async () => JSON.parse(await Store.get('bak:pre')).db.items.map(i => i.id));
      assert.deepStrictEqual(pre, ['real1']);
    },
  },
  {
    name: 'فاتورة بالدولار مع دفعة: الدفعة بتنسجّل بالدولار ورصيد الزبون صحيح',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => {
        db.settings.rate = 13000;
        db.items.push({ id: 'it1', name: 'سكر', sellPrice: 13000, buyPrice: 12000, openQty: 100 });
        db.accounts.push({ id: 'c1', code: '112001', name: 'أحمد', type: 'asset', parent: 'customers', group: false }); save();
        localStorage.setItem('daftar_draft_sale', JSON.stringify({ lines: [{ item: 'it1', qty: 2, price: 1 }], payment: '', inv: { date: today(), pay: 'credit', cashAcc: 'cash', party: 'c1', cur: 'fx', rate: 13000 }, at: Date.now() }));
      });
      await p.go('#/invoice/new?type=sale'); await p.closeDlg(); await p.click('[data-act=more]');
      await p.fill('[name=payment]', '0.5'); await p.dispatchEvent('[name=payment]', 'input');
      assert.match(await p.text('#tRest'), /الباقي على الحساب: 1.5 \$ — الدفعة بالقديم: 650,000/);
      await p.click('[data-act=save]'); await p.waitForTimeout(500);
      const r = await p.evaluate(() => { const v = db.vouchers.slice(-1)[0], inv = db.invoices.slice(-1)[0]; return { cur: v.cur, amount: v.amount, rate: v.rate, bal: partyBal(acc('c1')), paid: paidBase(inv) }; });
      assert.deepStrictEqual(r, { cur: 'fx', amount: 0.5, rate: 13000, bal: 19500, paid: 6500 });
      // فتح الفاتورة من جديد: الدفعة بتطلع 0.5 (بالدولار) وما في «تغييرات ما انحفظت»
      const id = await p.evaluate(() => db.invoices.slice(-1)[0].id);
      await p.go('#/invoices'); await p.go('#/invoice/' + id);
      assert.strictEqual(await p.inputValue('[name=payment]'), '0.5');
      assert.strictEqual(await p.locator('#dirtyNote').isVisible(), false);
    },
  },
];
