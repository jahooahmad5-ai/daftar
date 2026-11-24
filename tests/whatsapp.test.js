'use strict';
// واتساب: أول مرة شاشة تأكيد، وبعدها إرسال مباشر على رقم الزبون — للفواتير والسندات وكشف الحساب
const assert = require('assert');
const { page, OWNER, REP } = require('./helpers');

const setup = p => p.evaluate(() => {
  window.open = u => { (window.__opened = window.__opened || []).push(decodeURIComponent(u)); };
  db.items.push({ id: 'it1', name: 'سكر', sellPrice: 1000, buyPrice: 900, openQty: 100 });
  db.accounts.push({ id: 'c1', code: '112001', name: 'أحمد', type: 'asset', parent: 'customers', group: false, phone: '0933123456' });
  db.invoices.push({ id: 'inv1', type: 'sale', no: 4, date: today(), pay: 'credit', cashAcc: '', party: 'c1', cur: 'base', rate: '', lines: [{ item: 'it1', qty: 2, price: 1000 }], discount: 0, created: 1 });
  db.vouchers.push({ id: 'vr1', type: 'receipt', no: 9, date: today(), acc: 'c1', cashAcc: 'cash', amount: 1500, cur: 'base', rate: '', note: 'دفعة', created: 2 });
  save();
});
const opened = p => p.evaluate(() => (window.__opened || []).slice());

module.exports = [
  {
    name: 'أول مرة بتطلع شاشة التأكيد، وبعدها الفاتورة بتنبعت دغري على رقم الزبون',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await setup(p);
      await p.go('#/invoice/inv1'); await p.click('[data-act=wa]'); await p.waitForTimeout(200);
      assert.strictEqual(await p.evaluate(() => document.getElementById('dlg').open), true, 'أول مرة لازم تطلع شاشة التأكيد');
      assert.strictEqual(await p.isChecked('#waDir'), true, '«ابعت دغري المرات الجاية» لازم يكون معلّم لحاله');
      await p.click('#waGo'); await p.waitForTimeout(200);
      let o = await opened(p);
      assert.strictEqual(o.length, 1); assert.match(o[0], /^https:\/\/wa\.me\/963933123456\?text=/); assert.match(o[0], /فاتورة مبيع رقم 4/);
      // المرة التانية: دغري
      await p.go('#/invoices'); await p.go('#/invoice/inv1'); await p.click('[data-act=wa]'); await p.waitForTimeout(200);
      assert.strictEqual(await p.evaluate(() => document.getElementById('dlg').open), false, 'المرة التانية ما لازم تطلع شاشة');
      o = await opened(p);
      assert.strictEqual(o.length, 2); assert.match(o[1], /^https:\/\/wa\.me\/963933123456\?text=/);
      // كشف الحساب من قائمة الزباين كمان دغري
      await p.go('#/parties'); await p.click('[data-act=wa][data-id=c1]'); await p.waitForTimeout(200);
      o = await opened(p);
      assert.strictEqual(o.length, 3); assert.match(o[2], /رصيد حسابكم/);
    },
  },
  {
    name: 'إذا تغيّر رقم الزبون، أو اخترت «اسألني كل مرة»، بترجع شاشة التأكيد',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await setup(p);
      await p.evaluate(() => waSetDirect('c1', '963933123456'));
      // تغيّر الرقم ببطاقة الزبون (لـ «اسألني كل مرة»)
      await p.go('#/parties'); await p.click('[data-act=edit][data-id=c1]'); await p.waitForTimeout(200);
      assert.strictEqual(await p.inputValue('#dlg [name=waDirect]'), '1');
      await p.selectOption('#dlg [name=waDirect]', '0'); await p.click('#dlg button.pri'); await p.waitForTimeout(200);
      await p.click('[data-act=wa][data-id=c1]'); await p.waitForTimeout(200);
      assert.strictEqual(await p.evaluate(() => document.getElementById('dlg').open), true);
      await p.closeDlg();
      // رجّعها «دغري»، وبعدين تغيّر الرقم من برّا (متل مزامنة من جهاز تاني)
      await p.evaluate(() => { waSetDirect('c1', '963933123456'); acc('c1').phone = '0944555666'; });
      await p.click('[data-act=wa][data-id=c1]'); await p.waitForTimeout(200);
      assert.strictEqual(await p.evaluate(() => document.getElementById('dlg').open), true, 'رقم جديد لازم يتأكد مرة');
      assert.strictEqual(await p.inputValue('#waPh'), '0944555666');
    },
  },
  {
    name: 'سند القبض بينبعت بالواتساب (بالجديد والقديم) — ومن موبايل المندوب بلا رصيد',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await setup(p);
      await p.evaluate(() => waSetDirect('c1', '963933123456'));
      await p.go('#/vouchers'); await p.click('tr[data-id="vr1"]'); await p.waitForTimeout(200);
      await p.click('#vWa'); await p.waitForTimeout(200);
      const t = (await opened(p))[0];
      assert.match(t, /^https:\/\/wa\.me\/963933123456\?text=/);
      assert.match(t, /سند قبض رقم 9/); assert.match(t, /استلمنا من السيد: أحمد/); assert.match(t, /المبلغ: 1,500/); assert.match(t, /بالقديم: 150,000/); assert.match(t, /رصيد حسابكم/);
      // المندوب: نفس السند بلا رصيد
      const r = await page(base, { cloud: REP, ls: { daftar_rep_name: 'محمد' } });
      const rt = await r.evaluate(() => {
        db.accounts.push({ id: 'c1', code: '112001', name: 'أحمد', type: 'asset', parent: 'customers', group: false });
        return waVoucherText({ id: 'x', type: 'receipt', no: 3, date: today(), acc: 'c1', cashAcc: 'cash', amount: 500, cur: 'base', rate: '', rep: 'محمد' });
      });
      assert.match(rt, /المندوب|مندوب: محمد/); assert.doesNotMatch(rt, /رصيد/);
    },
  },
];
