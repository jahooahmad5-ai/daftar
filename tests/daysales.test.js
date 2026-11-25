'use strict';
// تقرير مبيعات المواد باليوم: الكمية (ناقص المرتجع)، المبلغ والربح، فلتر المندوب، والتنقّل بين الأيام
const assert = require('assert');
const { page, OWNER } = require('./helpers');

const setup = p => p.evaluate(() => {
  db.items.push({ id: 'su', name: 'سكر', unit: 'كغ', sellPrice: 1000, buyPrice: 900, openQty: 500, openCost: 900 });
  db.items.push({ id: 'ri', name: 'رز', sellPrice: 2000, buyPrice: 1500, openQty: 500, openCost: 1500 });
  ensureWalkin();
  const inv = (id, type, lines, o = {}) => db.invoices.push({ id, type, no: id, date: today(), pay: 'cash', cashAcc: 'cash', party: 'walkin', cur: 'base', rate: '', lines, discount: 0, created: 1, ...o });
  inv('a', 'sale', [{ item: 'su', qty: 10, price: 1000 }, { item: 'ri', qty: 2, price: 2000 }]);
  inv('b', 'sale', [{ item: 'su', qty: 5, price: 1000 }], { rep: 'محمد' });
  inv('c', 'saleReturn', [{ item: 'su', qty: 3, price: 1000 }]);
  inv('d', 'sale', [{ item: 'ri', qty: 7, price: 2000 }], { date: daysAgo(1) });
  inv('e', 'purchase', [{ item: 'su', qty: 100, price: 900 }]);
  save();
});

module.exports = [
  {
    name: 'مبيعات المواد باليوم: الكمية ناقص المرتجع، المبلغ والربح، وبس هاليوم',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await setup(p);
      await p.go('#/report/daysales');
      const t = await p.text('#rep');
      assert.match(t, /سكر كغ 12 مرتجع 3 12,000 1,200/, 'سكر: 15 انباع − 3 مرتجع = 12');
      assert.match(t, /رز 2 4,000 1,000/);
      assert.match(t, /المجموع \(2 مادة\) 14 16,000 2,200/);
      assert.match(t, /عدد الفواتير 2/);
      // المندوب لحاله
      await p.go('#/report/daysales?rep=' + encodeURIComponent('محمد'));
      const t2 = await p.text('#rep');
      assert.match(t2, /سكر كغ 5 5,000/); assert.doesNotMatch(t2, /رز/);
      // من موبايلي (بلا المندوب)
      await p.go('#/report/daysales?rep=-');
      assert.match(await p.text('#rep'), /سكر كغ 7 مرتجع 3/);
      // اليوم السابق
      await p.go('#/report/daysales'); await p.click('.day-nav a.btn'); await p.waitForTimeout(300);
      const t3 = await p.text('#rep');
      assert.match(t3, /رز 7 14,000/); assert.doesNotMatch(t3, /سكر/);
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'يوم ما انباع فيه شي، والرابط من الرئيسية',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.go('#/report/daysales?day=2020-01-01');
      assert.match(await p.text('#rep'), /ما انباع شي/);
      await p.go('#/');
      assert.strictEqual(await p.locator('.quick a[href="#/report/daysales"]').count(), 1);
    },
  },
];
