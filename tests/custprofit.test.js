'use strict';
// تقرير أرباح الزباين: مين الأكثر ربحاً ومين الأكثر سحب بضاعة، ومين بيسحب كتير بربح قليل
const assert = require('assert');
const { page, OWNER } = require('./helpers');

const setup = p => p.evaluate(() => {
  // كلفة السكر 900 والرز 500
  db.items.push({ id: 'su', name: 'سكر', sellPrice: 1000, buyPrice: 900, openQty: 1000, openCost: 900 });
  db.items.push({ id: 'ri', name: 'رز', sellPrice: 1000, buyPrice: 500, openQty: 1000, openCost: 500 });
  const c = (id, name) => db.accounts.push({ id, code: '1120' + id, name, type: 'asset', parent: 'customers', group: false });
  c('big', 'تاجر الجملة'); c('good', 'محل صغير');
  const inv = (id, type, party, item, qty, price, pay) => db.invoices.push({ id, type, no: id, date: today(), pay: pay || 'credit', cashAcc: pay === 'cash' ? 'cash' : '', party, cur: 'base', rate: '', lines: [{ item, qty, price }], discount: 0, created: 1 });
  // تاجر الجملة: 100 سكر بـ 950 (ربح 5000 من 95000 = 5.3٪) ورجّع 10
  inv('a', 'sale', 'big', 'su', 100, 950); inv('b', 'saleReturn', 'big', 'su', 10, 950);
  // محل صغير: 20 رز بـ 1000 (ربح 10000 من 20000 = 50٪)
  inv('c', 'sale', 'good', 'ri', 20, 1000);
  // زبون نقدي: 5 رز
  inv('d', 'sale', '', 'ri', 5, 1000, 'cash');
  save();
});

module.exports = [
  {
    name: 'أرباح كل زبون: المبيعات والكلفة والربح والمرتجعات صح',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await setup(p);
      const r = await p.evaluate(() => Object.fromEntries(custProfit(daysAgo(1), today()).map(c => [c.id, [c.val, c.cost, c.profit, c.qty, c.n]])));
      assert.deepStrictEqual(r.big, [85500, 81000, 4500, 90, 1]);
      assert.deepStrictEqual(r.good, [20000, 10000, 10000, 20, 1]);
      assert.deepStrictEqual(r._cash, [5000, 2500, 2500, 5, 1]);
    },
  },
  {
    name: 'صفحة التقرير: الأكثر ربحاً والأكثر سحباً، وتحذير «بيسحب كتير بربح قليل»، والترتيب',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await setup(p);
      await p.go('#/report/custprofit');
      const t = await p.text();
      assert.match(t, /الأكثر ربحاً محل صغير/);
      assert.match(t, /الأكثر سحب بضاعة تاجر الجملة/);
      assert.match(t, /تاجر الجملة.*بيسحب كتير بربح قليل/);
      assert.match(t, /محل صغير.*ربح ممتاز/);
      // الترتيب الافتراضي بالربح: محل صغير أول
      const first = () => p.evaluate(() => document.querySelector('.cp-tbl tbody tr td:nth-child(2)').textContent.trim());
      assert.strictEqual(await first(), 'محل صغير');
      await p.go('#/report/custprofit?sort=val');
      assert.strictEqual(await first(), 'تاجر الجملة');
      // الضغط على زبون بيفتح كشف حسابه
      await p.click('.cp-card[data-id=big]'); await p.waitForTimeout(300);
      assert.match(await p.evaluate(() => location.hash), /statement\?acc=big/);
      assert.deepStrictEqual(p.errors, []);
    },
  },
];
