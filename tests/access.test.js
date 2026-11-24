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
  {
    name: 'مندوب انوقف: أول مزامنة بتمسح بيانات الشركة من موبايله',
    fn: async base => {
      const p = await page(base, { cloud: REP, ls: { daftar_rep_name: 'محمد', daftar_pos_device: '1' } });
      await p.evaluate(async () => { db.items.push({ id: 'x', name: 'سعر سري', buyPrice: 900 }); db.accounts.push({ id: 'cz', code: '112009', name: 'زبون مهم', type: 'asset', parent: 'customers' }); save(); await Store.flush(); });
      p.cloud.companies.length = 0; // المدير وقّفه: ما عاد يشوف الشركة
      await p.evaluate(() => Cloud.sync(true)); await p.waitForTimeout(800);
      assert.deepStrictEqual(await p.evaluate(() => ({ items: db.items.length, cust: db.accounts.some(a => a.id === 'cz'), linked: Cloud.info().linked })), { items: 0, cust: false, linked: false });
      await p.reload(); await p.waitForFunction(() => typeof db !== 'undefined' && window.Cloud, null, { timeout: 15000 });
      assert.strictEqual(await p.evaluate(() => db.items.length), 0, 'لازم البيانات تكون انمسحت من التخزين كمان');
      assert.match(p.url(), /#\/pos/, 'الموبايل بيضل نقطة بيع (بيقدر يطلب تفعيل من جديد)');
    },
  },
  {
    name: '«خروج ومسح البيانات»: بيمسح بعد ما يرفع كل شي، وبيمنع إذا في شي ما ارتفع',
    fn: async base => {
      const p = await page(base, { cloud: OWNER, hash: '#/settings' });
      await p.evaluate(async () => { db.items.push({ id: 'x', name: 'مادة' }); save(); await Store.flush(); await autoBackup(); });
      // السحابة رافضة الرفع ← لازم يمنع المسح
      await p.unroute(/supabase\.co/);
      await p.route(/supabase\.co/, r => (r.request().method() === 'POST' && r.request().url().includes('/records') ? r.fulfill({ status: 500, body: '{}' }) : p.cloud.handler(r)));
      await p.click('#cWipe'); await p.waitForTimeout(1200);
      assert.strictEqual(await p.evaluate(() => db.items.length), 1, 'ما لازم يمسح وفي تغييرات ما ارتفعت');
      await p.unroute(/supabase\.co/); await p.route(/supabase\.co/, p.cloud.handler);
      await p.click('#cWipe'); await p.waitForTimeout(2500);
      await p.waitForFunction(() => typeof db !== 'undefined' && window.Cloud, null, { timeout: 15000 });
      assert.strictEqual(await p.evaluate(() => db.items.length), 0);
      assert.strictEqual(await p.evaluate(async () => (await Store.keys('bak:')).length), 0, 'النسخ الأوتوماتيكية لازم تنمسح');
      assert.match(await p.text(), /البرنامج مقفول/);
    },
  },
  {
    name: 'باركود نقطة البيع فيه رابط ينبعت بالواتساب (إذا الكاميرا ما بتقرا)',
    fn: async base => {
      const p = await page(base, { cloud: OWNER, hash: '#/settings' });
      await p.evaluate(() => { window.open = u => { window.__opened = u; }; });
      await p.click('[data-act=posqr]'); await p.fill('#dlg [name=name]', 'محمد صعوبي'); await p.click('#dlg button.pri'); await p.waitForTimeout(300);
      await p.click('#qrWa');
      const u = decodeURIComponent(decodeURIComponent(await p.evaluate(() => window.__opened)));
      assert.match(u, /^https:\/\/wa\.me\/\?text=/);
      assert.match(u, /#\/pos\?name=محمد صعوبي&c=c1/);
    },
  },
  {
    name: 'موبايل نقطة بيع خسر جلسته: بيبعت طلب تفعيل جديد لحاله، وما بيمسح شي، وبعد التفعيل بترتفع مبيعاته',
    fn: async base => {
      const lost = { ...REP, session: null };
      const p = await page(base, { cloud: lost, ls: { daftar_rep_name: 'محمد', daftar_pos_device: '1' }, cloudOpts: { companies: [], requests: [{ approved: false }] } });
      // ما لازم يطلع فورم إيميل وكلمة سر
      assert.strictEqual(await p.locator('#view [name=email]').count(), 0, 'ما لازم يطلع فورم دخول للمندوب');
      assert.match(await p.text(), /مش متصل بالسحابة/);
      // باع فاتورة وهو بلا جلسة
      await p.evaluate(() => { db.items.push({ id: 'it1', name: 'سكر', sellPrice: 1000 }); db.invoices.push({ id: 'sold1', type: 'sale', no: 5, date: today(), pay: 'cash', cashAcc: 'cash', party: '', cur: 'base', rate: '', lines: [{ item: 'it1', qty: 1, price: 1000 }], discount: 0, rep: 'محمد', created: 1 }); save(); });
      await p.evaluate(() => Cloud.sync(true)); await p.waitForTimeout(500);
      let st = await p.evaluate(() => ({ relink: Cloud.info().relink, signedIn: Cloud.info().signedIn, inv: db.invoices.length, items: db.items.length }));
      assert.deepStrictEqual(st, { relink: true, signedIn: true, inv: 1, items: 1 }, 'لازم يعمل حساب جديد ويبعت طلب بلا ما يمسح');
      assert.strictEqual(p.cloud.pushed.length, 0, 'ما لازم يرفع شي قبل التفعيل');
      // المدير فعّله
      p.cloud.companies.push({ id: 'c1', name: 'شركة الاختبار', owner: 'u-owner' });
      await p.evaluate(() => Cloud.sync(true)); await p.waitForTimeout(500);
      assert.strictEqual(await p.evaluate(() => Cloud.info().relink), false);
      assert.ok(p.cloud.pushed.some(x => x.kind === 'invoices' && x.id === 'sold1'), 'الفاتورة لازم ترتفع بعد التفعيل');
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'مندوب انوقف وعنده فواتير ما ارتفعت: بتنحفظ، بتنبعت بالواتساب، وبترتفع إذا رجع انفعّل',
    fn: async base => {
      const p = await page(base, { cloud: REP, ls: { daftar_rep_name: 'محمد', daftar_pos_device: '1' }, cloudOpts: { requests: [] } });
      await p.evaluate(async () => {
        db.items.push({ id: 'it1', name: 'سكر', sellPrice: 1000, buyPrice: 900 });
        db.accounts.push({ id: 'cz', code: '112009', name: 'زبون مهم', type: 'asset', parent: 'customers', group: false });
        save(); await Cloud.sync(true); // كل شي ارتفع
        db.invoices.push({ id: 'off1', type: 'sale', no: 7, date: today(), pay: 'credit', cashAcc: '', party: 'cz', cur: 'base', rate: '', lines: [{ item: 'it1', qty: 3, price: 1000 }], discount: 0, rep: 'محمد', created: 1 });
        save(); // بلا نت: ما ارتفعت
      });
      // المدير وقّفه قبل ما الموبايل يتصل ويرفع الفاتورة — وبعدين الموبايل اتصل
      p.cloud.companies.length = 0;
      await p.evaluate(() => Cloud.sync(true)); await p.waitForTimeout(800);
      const st = await p.evaluate(() => ({ items: db.items.length, cust: db.accounts.some(a => a.id === 'cz'), stash: (Cloud.info().stash || { docs: [] }).docs.map(d => d.id) }));
      assert.deepStrictEqual(st, { items: 0, cust: false, stash: ['off1'] }, 'الأسعار والزباين بينمسحوا، والفاتورة يلي ما ارتفعت بتنحفظ');
      await p.go('#/pos'); await p.waitForTimeout(800);
      assert.match(await p.text(), /في 1 فاتورة ما وصلوا للمدير/);
      await p.evaluate(() => { window.open = u => { window.__wa = u; }; });
      await p.click('#stashWa');
      const wa = decodeURIComponent(await p.evaluate(() => window.__wa));
      assert.match(wa, /زبون مهم/); assert.match(wa, /سكر: 3 × 1,000 = 3,000/);
      // رجع انفعّل
      p.cloud.pushed.length = 0;
      p.cloud.companies.push({ id: 'c1', name: 'شركة الاختبار', owner: 'u-owner' });
      await p.evaluate(() => Cloud.posCheck()); await p.waitForTimeout(800);
      assert.ok(p.cloud.pushed.some(x => x.kind === 'invoices' && x.id === 'off1'), 'الفاتورة المحفوظة لازم ترتفع');
      assert.strictEqual(await p.evaluate(() => Cloud.info().stash), null);
    },
  },
];
