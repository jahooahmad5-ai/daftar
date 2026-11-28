'use strict';
// تقرير «مواد سعر شرائها مو حقيقي»: بيلقط اللي انعبّى لحاله (المبيع − 20٪) واللي ما إلها سعر شراء، والتصليح منه بيصلّح الربح
const assert = require('assert');
const { page, OWNER } = require('./helpers');

module.exports = [
  {
    name: 'بيطلع بالتقرير اللي سعره انعبّى لحاله، والتصليح بيعدّل البطاقة وفاتورة شراء المواد السالبة والربح',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => {
        db.items.push({ id: 'au', code: '1', name: 'سكر', sellPrice: 1000 }); // بينعبّى لحاله
        db.items.push({ id: 'h8', code: '2', name: 'رز', sellPrice: 500, buyPrice: 400 }); // 80٪ بالضبط (بيانات قديمة)
        db.items.push({ id: 'ok', code: '3', name: 'شاي', sellPrice: 100, buyPrice: 90 }); // حقيقي
        db.items.push({ id: 'no', code: '4', name: 'زيت', sellPrice: 0, buyPrice: 0 }); // ما إلها سعر
        fillPrices(db.items[db.items.length - 4]);
        db.invoices.push({ id: 's1', type: 'sale', no: '1', date: daysAgo(2), pay: 'cash', cashAcc: 'cash', party: '', cur: 'base', rate: '', lines: [{ item: 'au', qty: 10, price: 1000 }], discount: 0, created: 1 });
        save();
      });
      // شراء المواد السالبة بالسعر الأوتوماتيكي (800)
      await p.go('#/invoice/new?type=purchase&neg=1');
      await p.click('[data-act=save]'); await p.waitForTimeout(400);
      await p.go('#/report/income');
      assert.match(await p.text(), /3 مادة سعر شرائها مو حقيقي/);
      await p.go('#/report/autobuy');
      const t = await p.text();
      assert.match(t, /سكر/); assert.match(t, /رز/); assert.match(t, /زيت/); assert.doesNotMatch(t, /شاي/);
      assert.match(t, /3 مادة/);
      // سعر السكر الحقيقي 900
      await p.fill('[data-buy=au]', '900'); await p.click('[data-act=fixbuy][data-id=au]'); await p.waitForTimeout(400);
      const r = await p.evaluate(() => {
        const it = db.items.find(i => i.id === 'au'), iv = db.invoices.find(i => i.early);
        return [it.buyPrice, it.autoBuy, iv.lines[0].price, r2(engine().moves.filter(m => m.item === 'au' && m.kind === 'sale').reduce((s, m) => s + m.cost, 0))];
      });
      assert.deepStrictEqual(r, [900, undefined, 900, 9000]);
      assert.doesNotMatch(await p.text(), /سكر/);
      // فرق أكتر من 20٪ ممنوع متل بطاقة المادة
      await p.fill('[data-buy=h8]', '100'); await p.click('[data-act=fixbuy][data-id=h8]'); await p.waitForTimeout(300);
      assert.strictEqual(await p.evaluate(() => db.items.find(i => i.id === 'h8').buyPrice), 400);
      assert.deepStrictEqual(p.errors, []);
    },
  },
];
