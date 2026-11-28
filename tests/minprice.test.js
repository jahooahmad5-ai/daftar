'use strict';
// الحد الأدنى لسعر المبيع: المندوب ما بيبيع تحت سعر البطاقة، والمدير بيطلعله تأكيد، وآخر سعر للزبون ما بينزل تحت البطاقة
const assert = require('assert');
const { page, OWNER, REP } = require('./helpers');

const draft = (o = {}) => JSON.stringify({ lines: [{ item: 'it1', qty: 1, price: o.price || 900 }], payment: '', inv: { date: new Date().toISOString().slice(0, 10), pay: 'cash', cashAcc: o.box || 'cash', party: 'walkin', discount: o.discount || 0 }, at: Date.now() });
const setupItem = (p, rep) => p.evaluate(rep => {
  if (rep) db.accounts.push({ id: 'repbox_1', code: '1113', name: 'صندوق المندوب: محمد', type: 'asset', parent: 'cashGroup', group: false, repBox: 'محمد' });
  db.items.push({ id: 'it1', code: '1', name: 'فري ميكس', sellPrice: 1000, buyPrice: 800, openQty: 50 }); ensureWalkin(); save();
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
    name: 'المندوب ما بينزل أكتر من 15٪ تحت سعر المبيع (ولا بالحسم) ولا تحت سعر الشراء، وما بيطلع أكتر من 15٪ فوقه',
    fn: async base => {
      const p = await page(base, { cloud: REP, ls: { daftar_rep_name: 'محمد' } });
      await setupItem(p, true);
      assert.strictEqual(await trySave(p, draft({ price: 790, box: 'repbox_1' })), 0, 'تحت الكلفة ممنوع');
      assert.match(await p.text('#toast'), /ما بينفع تبيع أقل من 850/);
      assert.strictEqual(await trySave(p, draft({ price: 840, box: 'repbox_1' })), 0, 'أكتر من 15٪ تحت سعر المبيع ممنوع للمندوب');
      assert.strictEqual(await trySave(p, draft({ price: 1000, box: 'repbox_1', discount: 200 })), 0, 'الحسم بينزّل السعر أكتر من 15٪ — ممنوع');
      assert.strictEqual(await trySave(p, draft({ price: 850, box: 'repbox_1' })), 1, 'نزلة 15٪ بالضبط مسموحة');
      assert.strictEqual(await trySave(p, draft({ price: 1000, box: 'repbox_1' })), 1, 'بسعر البطاقة لازم ينحفظ');
      assert.strictEqual(await trySave(p, draft({ price: 1160, box: 'repbox_1' })), 0, 'أكتر من 15٪ فوق سعر المبيع ممنوع');
      assert.match(await p.text('#toast'), /أعلى سعر مسموح 1,150/);
      assert.strictEqual(await trySave(p, draft({ price: 1150, box: 'repbox_1' })), 1, 'زيادة 15٪ بالضبط مسموحة');
    },
  },
  {
    name: 'المندوب ما بيقدر يعدّل بطاقة المادة (والأسعار) من جوّا الفاتورة',
    fn: async base => {
      const p = await page(base, { cloud: REP, ls: { daftar_rep_name: 'محمد' } });
      await setupItem(p, true);
      await p.evaluate(x => localStorage.setItem('daftar_draft_sale', x), draft({ price: 1000, box: 'repbox_1' }));
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
      assert.strictEqual(await trySave(p, draft({ price: 800 })), 0, 'لغى التأكيد ← ما بينحفظ');
      const q = await page(base, { cloud: OWNER });
      await setupItem(q, false);
      assert.strictEqual(await trySave(q, draft({ price: 800 })), 1, 'وافق ← بينحفظ');
      assert.strictEqual(await trySave(q, draft({ price: 1000 })), 1, 'بسعر البطاقة بلا تأكيد');
    },
  },
  {
    name: 'آخر سعر للزبون: إذا برّا ±15٪ عن البطاقة ← سعر البطاقة، وإذا ضمن الـ 15٪ بيضل',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => {
        db.items.push({ id: 'it1', code: '1', name: 'فري ميكس', buyPrice: 700, sellPrice: 1100, openQty: 100 });
        db.items.push({ id: 'it2', code: '2', name: 'شيبس', buyPrice: 800, sellPrice: 1000, openQty: 100 });
        db.items.push({ id: 'it3', code: '3', name: 'بيبسي 330', buyPrice: 300, sellPrice: 400, openQty: 100 });
        db.accounts.push({ id: 'c1', code: '112001', name: 'أبو طوني', type: 'asset', parent: 'customers', group: false });
        db.invoices.push({ id: 'old', type: 'sale', no: 1, date: '2026-01-01', pay: 'credit', party: 'c1', cur: 'base', rate: '', lines: [{ item: 'it1', qty: 1, price: 900 }, { item: 'it2', qty: 1, price: 950 }, { item: 'it3', qty: 1, price: 1600 }], discount: 0, created: 1 }); save();
      });
      await p.go('#/invoices'); await p.go('#/invoice/new?type=sale'); await p.closePicker();
      await p.click('[data-act=more]');
      await p.selectOption('[name=party]', 'c1'); await p.dispatchEvent('[name=party]', 'change');
      await p.click('#scanIn'); await p.keyboard.type('فري'); await p.waitForTimeout(300);
      const m = await p.locator('.sg-meta').first().innerText();
      assert.match(m, /1,100/); assert.doesNotMatch(m, /آخر سعر إله/);
      // شيبس: آخر سعر إله 950 (نزلة 5٪ بس) ← بيضل آخر سعر
      await p.locator('#scanIn').fill(''); await p.keyboard.type('شيبس'); await p.waitForTimeout(300);
      const m2 = await p.locator('.sg-meta').first().innerText();
      assert.match(m2, /950/); assert.match(m2, /آخر سعر إله/);
      // بيبسي: آخر سعر إله 1600 والبطاقة 400 (أكتر من 15٪ فوق) ← سعر البطاقة
      await p.locator('#scanIn').fill(''); await p.keyboard.type('بيبسي'); await p.waitForTimeout(300);
      const m3 = await p.locator('.sg-meta').first().innerText();
      assert.match(m3, /400/); assert.doesNotMatch(m3, /1,600/); assert.doesNotMatch(m3, /آخر سعر إله/);
    },
  },
  {
    name: 'المندوب ما بيقدر يبيع فوق 15٪ حتى لو آخر سعر للزبون كان أعلى (بيبسي 400 بالبطاقة، والزبون قديماً بـ 1600)',
    fn: async base => {
      const p = await page(base, { cloud: REP, ls: { daftar_rep_name: 'محمد' } });
      await setupItem(p, true);
      await p.evaluate(() => {
        db.accounts.push({ id: 'c1', code: '112001', name: 'أبو طوني', type: 'asset', parent: 'customers', group: false });
        db.invoices.push({ id: 'old', type: 'sale', no: 1, date: '2026-01-01', pay: 'credit', party: 'c1', cur: 'base', rate: '', lines: [{ item: 'it1', qty: 1, price: 4000 }], discount: 0, created: 1 }); save();
      });
      const d = o => JSON.stringify({ lines: [{ item: 'it1', qty: 1, price: o }], payment: '', inv: { date: new Date().toISOString().slice(0, 10), pay: 'credit', cashAcc: '', party: 'c1', discount: 0 }, at: Date.now() });
      assert.strictEqual(await trySave(p, d(4000)), 0, 'آخر سعر للزبون ما بيفتح الباب فوق الـ 15٪');
      assert.match(await p.text('#toast'), /أعلى سعر مسموح 1,150/);
      assert.strictEqual(await trySave(p, d(1100)), 1);
    },
  },
];
