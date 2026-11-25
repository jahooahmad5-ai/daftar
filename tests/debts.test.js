'use strict';
// الديون: أرصدة الزباين المديونين، أعمار الديون (الدفعات بتسدّ الأقدم أول)، موعد السداد وسقف الدين، القبض والتذكير
const assert = require('assert');
const { page, OWNER, REP } = require('./helpers');

const setup = p => p.evaluate(() => {
  db.settings.waMode = 'text';
  window.open = u => { (window.__opened = window.__opened || []).push(decodeURIComponent(u)); };
  db.items.push({ id: 'it1', name: 'سكر', sellPrice: 1000, buyPrice: 900, openQty: 1000 });
  const c = (id, name, phone) => db.accounts.push({ id, code: '1120' + id, name, type: 'asset', parent: 'customers', group: false, phone });
  c('c1', 'أحمد', '0933123456'); c('c2', 'سمير', ''); c('c3', 'خالد', '');
  const inv = (id, party, qty, d) => db.invoices.push({ id, type: 'sale', no: id, date: daysAgo(d), pay: 'credit', cashAcc: '', party, cur: 'base', rate: '', lines: [{ item: 'it1', qty, price: 1000 }], discount: 0, created: d });
  // أحمد: 5000 قبل 100 يوم، 3000 قبل 40 يوم، 2000 قبل 5 أيام، ودفع 6000 → باقي 4000: 2000 (40 يوم) + 2000 (5 أيام)
  inv('i1', 'c1', 5, 100); inv('i2', 'c1', 3, 40); inv('i3', 'c1', 2, 5);
  db.vouchers.push({ id: 'v1', type: 'receipt', no: 1, date: daysAgo(10), acc: 'c1', cashAcc: 'cash', amount: 6000, cur: 'base', rate: '', created: 1 });
  // سمير: 1000 قبل يومين، ما دفع
  inv('i4', 'c2', 1, 2);
  // خالد: مسدّد بالكامل
  inv('i5', 'c3', 1, 20);
  db.vouchers.push({ id: 'v2', type: 'receipt', no: 2, date: daysAgo(1), acc: 'c3', cashAcc: 'cash', amount: 1000, cur: 'base', rate: '', created: 2 });
  save();
});

module.exports = [
  {
    name: 'صفحة الديون: بس المديونين، والمبالغ وأعمار الديون صح (الدفعة بتسدّ الأقدم أول)',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await setup(p);
      const info = await p.evaluate(() => debtors().map(d => ({ id: d.a.id, bal: d.bal, age: d.age, ages: d.ages, lastPay: d.lastPay === daysAgo(10) })));
      assert.deepStrictEqual(info.map(x => x.id).sort(), ['c1', 'c2'], 'خالد مسدّد ما لازم يطلع');
      const a = info.find(x => x.id === 'c1');
      assert.strictEqual(a.bal, 4000);
      assert.strictEqual(a.age, 40, 'أقدم دين باقي عمره 40 يوم (يلي قبل 100 يوم انسدّ)');
      assert.deepStrictEqual(a.ages, [2000, 2000, 0, 0]);
      assert.strictEqual(a.lastPay, true);
      await p.go('#/debts');
      const t = await p.text();
      assert.match(t, /إجمالي الديون لنا 5,000/);
      assert.match(t, /عدد المديونين 2/);
      assert.match(t, /أحمد/); assert.match(t, /سمير/); assert.doesNotMatch(t, /خالد/);
      assert.match(t, /سمير.*ما دفع ولا مرة/);
      // فلتر «أكتر من ٣٠ يوم»
      await p.go('#/debts?f=30');
      const t2 = await p.text();
      assert.match(t2, /أحمد/); assert.doesNotMatch(t2, /سمير 1,000/);
      // القائمة بالقائمة الجانبية
      assert.strictEqual(await p.evaluate(() => document.querySelector('#nav a[data-r=debts]').classList.contains('on')), true);
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'قبض دفعة من صفحة الديون: سند قبض للزبون، والدين بينقص ومنرجع عالديون',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await setup(p);
      await p.go('#/debts');
      await p.click('[data-act=pay][data-id=c2]'); await p.waitForTimeout(200);
      assert.strictEqual(await p.evaluate(() => document.querySelector('#dlg [name=acc]').value), 'c2', 'الزبون لازم يكون مختار لحاله');
      await p.fill('#dlg [name=amount]', '1000');
      await p.click('#dlg footer .btn.pri'); await p.waitForTimeout(400);
      await p.closeDlg();
      assert.match(await p.evaluate(() => location.hash), /^#\/debts/);
      const v = await p.evaluate(() => db.vouchers.filter(x => x.acc === 'c2').map(x => [x.type, x.amount]));
      assert.deepStrictEqual(v, [['receipt', 1000]]);
      assert.doesNotMatch(await p.text(), /سمير/, 'سمير سدّد — ما لازم يضل بالديون');
    },
  },
  {
    name: 'موعد السداد وسقف الدين: بينحفظو عالزبون، وبيطلعو بالفلاتر والرئيسية والفاتورة',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await setup(p);
      await p.go('#/debts');
      await p.click('[data-act=setup][data-id=c1]'); await p.waitForTimeout(200);
      await p.fill('#dlg [name=promise]', await p.evaluate(() => today()));
      await p.fill('#dlg [name=limit]', '3000');
      await p.fill('#dlg [name=promiseNote]', 'بيدفع آخر الشهر');
      await p.click('#dlg footer .btn.pri'); await p.waitForTimeout(300);
      const a = await p.evaluate(() => { const x = acc('c1'); return [x.limit, x.promiseNote, x.promise === today()]; });
      assert.deepStrictEqual(a, [3000, 'بيدفع آخر الشهر', true]);
      let t = await p.text();
      assert.match(t, /وعد يدفع اليوم/); assert.match(t, /تجاوز السقف/); assert.match(t, /بيدفع آخر الشهر/);
      await p.go('#/debts?f=limit'); t = await p.text();
      assert.match(t, /أحمد/); assert.doesNotMatch(t, /سمير 1,000/);
      await p.go('#/debts?f=due'); assert.match(await p.text(), /أحمد/);
      await p.go('#/'); assert.match(await p.text(), /1 زبون موعد دفعتهم اليوم/);
      // الفاتورة المفتوحة لأحمد بتحذّر من تجاوز السقف
      await p.go('#/invoice/i3'); await p.waitForTimeout(300);
      assert.match(await p.text(), /رح يتجاوز سقف الدين/);
      // شيل الموعد
      await p.go('#/debts'); await p.click('[data-act=setup][data-id=c1]'); await p.waitForTimeout(200);
      await p.click('#pClr'); await p.waitForTimeout(300);
      assert.strictEqual(await p.evaluate(() => acc('c1').promise), '');
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'تذكير واتساب بالدين: الرصيد وتاريخ أقدم مبلغ',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await setup(p);
      await p.go('#/debts');
      await p.click('[data-act=wa][data-id=c1]'); await p.waitForTimeout(200);
      await p.click('#waGo'); await p.waitForTimeout(200);
      const o = await p.evaluate(() => window.__opened || []);
      assert.strictEqual(o.length, 1);
      assert.match(o[0], /^https:\/\/wa\.me\/963933123456\?text=/);
      assert.match(o[0], /4,000/); assert.match(o[0], /أقدم مبلغ مستحق/);
    },
  },
  {
    name: 'المندوب ما بيقدر يفتح صفحة الديون',
    fn: async base => {
      const p = await page(base, { cloud: REP, ls: { daftar_rep_name: 'محمد' } });
      await p.go('#/debts');
      assert.doesNotMatch(await p.text(), /إجمالي الديون/);
      assert.strictEqual(await p.evaluate(() => location.hash), '#/');
    },
  },
];
