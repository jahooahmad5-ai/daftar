'use strict';
// المواد: تحديد عدة مواد وحذفها، وإهمال المواد (ما بتطلع بالقائمة ولا بالبحث بالفاتورة) وإرجاعها
const assert = require('assert');
const { page, OWNER } = require('./helpers');

module.exports = [
  {
    name: 'تحديد وحذف عدة مواد: اللي إلها فواتير ما بتنحذف وبتنحط بالمهملة، والمهملة بترجع',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => {
        [['a', 'سكر'], ['b', 'رز'], ['c', 'شاي'], ['d', 'زيت']].forEach(([id, name], i) => db.items.push({ id, code: String(i + 1), name, sellPrice: 100, buyPrice: 90, barcodes: [id === 'c' ? '6290001' : ''] .filter(Boolean) }));
        db.invoices.push({ id: 's1', type: 'sale', no: '1', date: today(), pay: 'cash', cashAcc: 'cash', party: '', cur: 'base', rate: '', lines: [{ item: 'c', qty: 1, price: 100 }], discount: 0, created: 1 });
        save();
      });
      await p.go('#/items');
      assert.strictEqual(await p.isHidden('#selBar'), true);
      await p.check('[data-sel=a]'); await p.check('[data-sel=b]'); await p.check('[data-sel=c]');
      assert.match(await p.textContent('#selN'), /3 مادة محددة/);
      await p.click('[data-act=selDel]'); await p.waitForTimeout(400);
      const r = await p.evaluate(() => db.items.map(i => [i.id, !!i.hidden]));
      assert.deepStrictEqual(r, [['c', true], ['d', false]]);
      const t = await p.text();
      assert.match(t, /المواد المهملة \(1\)/); assert.doesNotMatch(t, /شاي/); assert.match(t, /زيت/);
      // إهمال بالتحديد
      await p.check('[data-sel=d]'); await p.click('[data-act=selHide]'); await p.waitForTimeout(300);
      assert.match(await p.text(), /المواد المهملة \(2\)/);
      // بالفاتورة: المهملة ما بتطلع بالبحث بالاسم، بس بالباركود
      await p.go('#/invoice/new?type=purchase');
      await p.fill('#scanIn', 'شاي'); await p.waitForTimeout(300);
      assert.doesNotMatch(await p.evaluate(() => document.getElementById('sugg').innerText), /شاي/);
      await p.fill('#scanIn', '6290001'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
      assert.match(await p.evaluate(() => document.getElementById('ln').innerText), /شاي/);
      // صفحة المهملة: إرجاع
      await p.click('[data-act=rmLine]'); await p.click('#dlg button.pri'); await p.waitForTimeout(200);
      await p.go('#/items?h=1');
      const h = await p.text(); assert.match(h, /شاي/); assert.match(h, /زيت/);
      await p.check('#selAll'); await p.click('[data-act=selUnhide]'); await p.waitForTimeout(300);
      assert.deepStrictEqual(await p.evaluate(() => db.items.filter(i => i.hidden).length), 0);
      assert.deepStrictEqual(p.errors, []);
    },
  },
];
