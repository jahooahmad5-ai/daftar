'use strict';
// «🛒 شراء المواد السالبة»: مواد انباعت بلا ما تنشرى (كميتها بالسالب) ← فاتورة شراء جاهزة، والربح بيطلع صح
const assert = require('assert');
const { page, OWNER } = require('./helpers');

const setup = p => p.evaluate(() => {
  db.items.push({ id: 'su', code: '1', name: 'سكر', sellPrice: 1000, buyPrice: 800 });
  db.items.push({ id: 'ri', code: '2', name: 'رز', sellPrice: 500, buyPrice: 400, openQty: 3, openCost: 400 });
  db.items.push({ id: 'ok', code: '3', name: 'شاي', sellPrice: 100, buyPrice: 90, openQty: 50, openCost: 90 });
  const inv = (id, date, item, qty, price) => db.invoices.push({ id, type: 'sale', no: id, date, pay: 'cash', cashAcc: 'cash', party: '', cur: 'base', rate: '', lines: [{ item, qty, price }], discount: 0, created: Date.now() });
  inv('a', daysAgo(5), 'su', 10, 1000); inv('b', daysAgo(2), 'ri', 8, 500); inv('c', daysAgo(1), 'ok', 5, 100);
  save();
});

module.exports = [
  {
    name: 'زر شراء المواد السالبة بيعبّي فاتورة شراء بالكمية الناقصة، وبعد الحفظ الربح صح والكمية صفر',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await setup(p);
      // قبل: السكر انباع قبل ما ينشرى ← كلفته تقديرية من سعر الشراء بالبطاقة (مش صفر)
      assert.strictEqual(await p.evaluate(() => r2(engine().moves.filter(m => m.item === 'su' && m.kind === 'sale').reduce((s, m) => s + m.cost, 0))), 8000);
      await p.go('#/items');
      assert.match(await p.text(), /شراء المواد السالبة \(2\)/);
      await p.go('#/invoice/new?type=purchase&neg=1');
      const t = await p.text();
      assert.match(t, /حطّيتلك 2 مادة/);
      await p.click('[data-act=save]'); await p.waitForTimeout(500);
      const r = await p.evaluate(() => {
        const e = engine(), iv = db.invoices.find(i => i.type === 'purchase');
        const cost = id => r2(e.moves.filter(m => m.item === id && m.kind === 'sale').reduce((s, m) => s + m.cost, 0));
        return { date: iv.date, five: daysAgo(5), lines: iv.lines.map(l => [l.item, l.qty, l.price]), su: [e.stock.su.qty, cost('su')], ri: [e.stock.ri.qty, cost('ri')] };
      });
      assert.strictEqual(r.date, r.five);
      assert.deepStrictEqual(r.lines, [['su', 10, 800], ['ri', 5, 400]]);
      assert.deepStrictEqual(r.su, [0, 8000]);
      assert.deepStrictEqual(r.ri, [0, 3200]);
      await p.go('#/items');
      assert.doesNotMatch(await p.text(), /شراء المواد السالبة/);
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'مادة انباعت قبل ما تنشرى وبعدين انشرت: كلفة المبيع من سعر الشراء بالبطاقة مش صفر، وبتقرير أرباح المواد «كلفتها تقديرية»',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => {
        db.items.push({ id: 'ct', code: '1', name: 'كرتون', sellPrice: 600, buyPrice: 560 });
        const inv = (id, type, date, qty, price) => db.invoices.push({ id, type, no: id, date, pay: 'cash', cashAcc: 'cash', party: '', cur: 'base', rate: '', lines: [{ item: 'ct', qty, price }], discount: 0, created: 1 });
        inv('s1', 'sale', daysAgo(5), 10, 600); inv('p1', 'purchase', daysAgo(3), 20, 550); inv('s2', 'sale', daysAgo(1), 5, 600);
        save();
      });
      const c = await p.evaluate(() => engine().moves.filter(m => m.kind === 'sale').map(m => [r2(m.cost), !!m.est]));
      assert.deepStrictEqual(c, [[5600, true], [2750, false]]);
      await p.go('#/report/itemprofit?from=' + await p.evaluate(() => daysAgo(10)));
      assert.match(await p.text(), /10 منها كلفتها تقديرية/);
      assert.deepStrictEqual(p.errors, []);
    },
  },
];
