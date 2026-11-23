'use strict';
// القفل، نقطة البيع، ودخول المدير
const assert = require('assert');
const { page, OWNER, REP } = require('./helpers');

module.exports = [
  {
    name: 'موبايل غريب (بلا دخول) بيشوف شاشة القفل بس',
    fn: async base => {
      const p = await page(base, { cloud: null, hash: '#/reports' });
      assert.match(await p.text(), /البرنامج مقفول/);
      assert.strictEqual(await p.locator('#cUp').count(), 0, 'ما لازم يطلع زر إنشاء حساب');
      assert.strictEqual(await p.locator('#menuBtn').isVisible(), false, 'القائمة لازم تكون مخفية');
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'موبايل المدير بيفتح البرنامج كامل وزر الباركود موجود',
    fn: async base => {
      const p = await page(base, { cloud: OWNER, hash: '#/settings' });
      assert.doesNotMatch(await p.text(), /البرنامج مقفول/);
      assert.strictEqual(await p.locator('[data-act=posqr]').count(), 1);
      assert.strictEqual(await p.locator('#menuBtn').isVisible(), true);
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'باركود نقطة البيع: الموبايل الجديد بيستنى تفعيل المدير وبينقفل على نقطة البيع',
    fn: async base => {
      const p = await page(base, { cloud: null, hash: '#/pos?name=علي&c=c1', cloudOpts: { requests: [{ approved: false }], companies: [] } });
      await p.waitForTimeout(800);
      assert.match(await p.text(), /بانتظار تفعيل المدير/);
      await p.go('#/reports');
      assert.match(p.url(), /#\/pos/, 'أي صفحة تانية لازم ترجع لنقطة البيع');
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'موبايل المندوب بيفتح نقطة البيع وما بيوصل للتقارير',
    fn: async base => {
      const p = await page(base, { cloud: REP, ls: { daftar_rep_name: 'محمد' } });
      assert.match(await p.text(), /نقطة البيع — محمد/);
      await p.go('#/reports');
      assert.doesNotMatch(await p.text(), /ميزان المراجعة/);
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: '«دخول المدير» من شاشة نقطة البيع بيرجّع الدفتر كامل',
    fn: async base => {
      const p = await page(base, { cloud: { ...REP, owner: false, posReq: null }, ls: { daftar_rep_name: 'محمد' }, cloudOpts: { loginUid: 'u-owner' } });
      await p.click('[data-act=boss]');
      await p.fill('#dlg [name=email]', 'boss@test'); await p.fill('#dlg [name=pw]', 'secret1');
      await p.click('#dlg button.pri'); await p.waitForTimeout(1000);
      assert.match(await p.text(), /الرئيسية/);
      assert.strictEqual(await p.locator('#menuBtn').isVisible(), true);
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'وضع البيّاع القديم بينتقل لنقطة بيع (وموبايل المدير ما بينقفل)',
    fn: async base => {
      const old = JSON.stringify({ pin: '1234', name: 'محمد صعوبي' });
      const rep = await page(base, { cloud: null, ls: { daftar_seller: old } });
      assert.match(rep.url(), /#\/pos/);
      assert.strictEqual(await rep.evaluate(() => localStorage.getItem('daftar_rep_name')), 'محمد صعوبي');
      const own = await page(base, { cloud: OWNER, ls: { daftar_seller: old } });
      assert.match(await own.text(), /الرئيسية/);
      assert.strictEqual(await own.evaluate(() => localStorage.getItem('daftar_seller')), null);
    },
  },
];
