'use strict';
// الحد الأدنى لسعر المبيع: المندوب ما بيبيع تحت سعر البطاقة، والمدير بيطلعله تأكيد، وآخر سعر للزبون ما بينزل تحت البطاقة
const assert = require('assert');
const { page, OWNER, REP } = require('./helpers');

const draft = (o = {}) => JSON.stringify({ lines: [{ item: 'it1', qty: 1, price: o.price || 900 }], payment: '', inv: { date: new Date().toISOString().slice(0, 10), pay: 'cash', cashAcc: o.box || 'cash', party: 'walkin', discount: o.discount || 0 }, at: Date.now() });
const setupItem = (p, rep) => p.evaluate(rep => {
  if (rep) db.accounts.push({ id: 'repbox_1', code: '1113', name: 'صندوق المندوب: محمد', type: 'asset', parent: 'cashGroup', group: false, repBox: 'محمد' });
  db.items.push({ id: 'it1', code: '1', name: 'فري ميكس', sellPrice: 1100, buyPrice: 1000, openQty: 50 }); ensureWalkin(); save();
}, rep);
const trySave = async (p, d) => {
  // الفاتورة يلي ما انحفظت بتمنع الطلعة منها — منفكّها بين المحاولات
  await p.evaluate(x => { leaveGuard = null; const g = document.getElementById('dlg'); if (g.open) g.close(); localStorage.setItem('daftar_draft_sale', x); }, d);
  await p.go('#/invoices'); await p.asReload(); await p.go('#/invoice/new?type=sale'); await p.closeDlg();
  const n0 = await p.evaluate(() => db.invoices.length);
  await p.click('[data-act=save]'); await p.waitForTimeout(600);
  return (await p.evaluate(() => db.invoices.length)) - n0;
};

module.exports = [
  {
    name: 'المندوب ما بيقدر يبيع تحت سعر المبيع (ولا بالحسم)، وبسعر البطاقة بيمشي',
    fn: async base => {
      const p = await page(base, { cloud: REP, ls: { daftar_rep_name: 'محمد' } });
      await setupItem(p, true);
      assert.strictEqual(await trySave(p, draft({ price: 900, box: 'repbox_1' })), 0, 'تحت الكلفة ممنوع');
      assert.match(await p.text('#toast'), /ما بينفع تبيع أقل من سعر المبيع/);
      assert.strictEqual(await trySave(p, draft({ price: 1050, box: 'repbox_1' })), 0, 'تحت سعر المبيع ممنوع للمندوب');
      assert.strictEqual(await trySave(p, draft({ price: 1100, box: 'repbox_1', discount: 200 })), 0, 'الحسم بينزّل السعر تحت البطاقة — ممنوع');
      assert.strictEqual(await trySave(p, draft({ price: 1100, box: 'repbox_1' })), 1, 'بسعر البطاقة لازم ينحفظ');
    },
  },
  {
    name: 'المندوب ما بيقدر يعدّل بطاقة المادة (والأسعار) من جوّا الفاتورة',
    fn: async base => {
      const p = await page(base, { cloud: REP, ls: { daftar_rep_name: 'محمد' } });
      await setupItem(p, true);
      await p.evaluate(x => localStorage.setItem('daftar_draft_sale', x), draft({ price: 1100, box: 'repbox_1' }));
      await p.asReload(); await p.go('#/invoice/new?type=sale'); await p.waitForTimeout(400); await p.closeDlg();
      await p.evaluate(() => document.querySelector('[data-act=editItem]').click()); await p.waitForTimeout(200);
      assert.strictEqual(await p.evaluate(() => document.getElementById('dlg').open), false);
      assert.match(await p.text('#toast'), /مسكّر بوضع البيّاع/);
    },
  },
  {
    name: 'المدير: تحت السعر بيطلعله تأكيد (إذا لغى ما بينحفظ، وإذا وافق بينحفظ)',
    fn: async base => {
      const p = await page(base, { cloud: OWNER, dialog: 'dismiss' });
      await setupItem(p, false);
      assert.strictEqual(await trySave(p, draft({ price: 900 })), 0, 'لغى التأكيد ← ما بينحفظ');
      const q = await page(base, { cloud: OWNER });
      await setupItem(q, false);
      assert.strictEqual(await trySave(q, draft({ price: 900 })), 1, 'وافق ← بينحفظ');
      assert.strictEqual(await trySave(q, draft({ price: 1100 })), 1, 'بسعر البطاقة بلا تأكيد');
    },
  },
  {
    name: 'آخر سعر للزبون أقل من البطاقة (السعر غلي) ← بيقترح سعر البطاقة',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => {
        db.items.push({ id: 'it1', code: '1', name: 'فري ميكس', buyPrice: 1000, sellPrice: 1100, openQty: 100 });
        db.accounts.push({ id: 'c1', code: '112001', name: 'أبو طوني', type: 'asset', parent: 'customers', group: false });
        db.invoices.push({ id: 'old', type: 'sale', no: 1, date: '2026-01-01', pay: 'credit', party: 'c1', cur: 'base', rate: '', lines: [{ item: 'it1', qty: 1, price: 900 }], discount: 0, created: 1 }); save();
      });
      await p.go('#/invoices'); await p.go('#/invoice/new?type=sale'); await p.closePicker();
      await p.click('[data-act=more]');
      await p.selectOption('[name=party]', 'c1'); await p.dispatchEvent('[name=party]', 'change');
      await p.click('#scanIn'); await p.keyboard.type('فري'); await p.waitForTimeout(300);
      const m = await p.locator('.sg-meta').first().innerText();
      assert.match(m, /1,100/); assert.doesNotMatch(m, /آخر سعر إله/);
    },
  },
];
