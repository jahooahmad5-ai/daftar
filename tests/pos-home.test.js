'use strict';
// الرئيسية: فواتير نقطة البيع لليوم بجدول لحالها، وقديش زاد على حسابات الزباين
const assert = require('assert');
const { page, OWNER } = require('./helpers');

module.exports = [
  {
    name: 'جدول نقطة البيع: بس فواتير المندوب لليوم، والمقبوض ويلي زاد عالزبون صح',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => {
        db.items.push({ id: 'it', name: 'سكر', sellPrice: 1000, buyPrice: 900, openQty: 100 });
        db.accounts.push({ id: 'c1', code: '112001', name: 'كريم', type: 'asset', parent: 'customers', group: false });
        db.accounts.push({ id: 'c2', code: '112002', name: 'معهد البيان', type: 'asset', parent: 'customers', group: false });
        const inv = (id, o) => db.invoices.push({ id, type: 'sale', no: id, date: today(), pay: 'credit', cashAcc: '', party: 'c1', cur: 'base', rate: '', lines: [{ item: 'it', qty: 3, price: 1000 }], discount: 0, created: 1, ...o });
        inv('r1', { rep: 'محمد' });                                              // آجل 3000 بلا دفعة ← زاد 3000
        inv('r2', { rep: 'محمد', party: 'c2' });                                 // آجل 3000 دفع 1000 ← زاد 2000
        db.vouchers.push({ id: 'v', type: 'receipt', no: 1, date: today(), acc: 'c2', cashAcc: 'cash', amount: 1000, cur: 'base', rate: '', inv: 'r2', rep: 'محمد', created: 2 });
        inv('r3', { rep: 'محمد', pay: 'cash', cashAcc: 'cash' });               // نقدي ← ما زاد شي
        inv('r4', { rep: 'محمد', date: daysAgo(1) });                           // مبارح ← ما بيطلع
        inv('m1', { no: 'M1' });                                                  // فاتورة المدير ← بآخر الفواتير بس
        save();
      });
      await p.evaluate(() => route()); await p.waitForTimeout(300);
      const card = await p.text('.pos-today');
      assert.match(card, /مبيعات \(ل.س\) 9,000/);
      assert.match(card, /انقبض \(ل.س\) 4,000/);
      assert.match(card, /زاد على الزباين 5,000/);
      assert.match(card, /المجموع \(3 فاتورة\) 9,000 4,000 5,000/);
      assert.match(card, /معهد البيان 3,000 1,000 \+2,000/);
      assert.doesNotMatch(card, /r4|M1/);
      const recent = await p.evaluate(() => [...document.querySelectorAll('.cols2 .card')][0].innerText);
      assert.match(recent, /M1/); assert.doesNotMatch(recent, /\br1\b/);
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'عمود «زاد عالحساب» بصفحة الفواتير وبآخر الفواتير بالرئيسية (بلا ما تفتح الفاتورة)',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => {
        db.items.push({ id: 'it', name: 'سكر', sellPrice: 1000, buyPrice: 900, openQty: 100 });
        db.accounts.push({ id: 'c1', code: '112001', name: 'كريم', type: 'asset', parent: 'customers', group: false });
        const inv = (id, o) => db.invoices.push({ id, type: 'sale', no: id, date: today(), pay: 'credit', cashAcc: '', party: 'c1', cur: 'base', rate: '', lines: [{ item: 'it', qty: 3, price: 1000 }], discount: 0, created: 1, ...o });
        inv('A1'); inv('A2'); inv('A3', { pay: 'cash', cashAcc: 'cash' });
        db.vouchers.push({ id: 'v', type: 'receipt', no: 1, date: today(), acc: 'c1', cashAcc: 'cash', amount: 1200, cur: 'base', rate: '', inv: 'A2', created: 2 });
        save(); route();
      });
      await p.waitForTimeout(300);
      const row = async (sel, no) => (await p.locator(`${sel} tr:has(td:text-is("${no}"))`).innerText()).replace(/\s+/g, ' ');
      assert.match(await row('.cols2', 'A1'), /\+3,000/);
      assert.match(await row('.cols2', 'A2'), /\+1,800/);
      assert.match(await row('.cols2', 'A3'), /—/);
      await p.go('#/invoices?t=sale');
      assert.match(await row('#view', 'A2'), /3,000 ل\.س \+1,800/);
      assert.match(await p.text("tfoot"), /9,000 4,800/);
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'بلا مندوبين ما بيطلع جدول نقطة البيع',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.go('#/');
      assert.strictEqual(await p.locator('.pos-today').count(), 0);
    },
  },
];
