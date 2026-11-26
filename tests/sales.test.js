'use strict';
// المبيعات: صندوق المندوب، القبض، الترقيم، التسعير، المسودة، زر +
const assert = require('assert');
const { page, OWNER, REP } = require('./helpers');

const setupRep = p => p.evaluate(() => {
  db.accounts.push({ id: 'repbox_1', code: '1113', name: 'صندوق المندوب: محمد', type: 'asset', parent: 'cashGroup', group: false, repBox: 'محمد' },
    { id: 'cust1', code: '112001', name: 'أحمد', type: 'asset', parent: 'customers', group: false });
  db.items.push({ id: 'it1', code: '1', name: 'سكر', sellPrice: 1000, buyPrice: 900, openQty: 50 });
  save(); route();
});

module.exports = [
  {
    name: 'تفعيل المندوب من موبايل المدير بيعمل صندوق باسمه',
    fn: async base => {
      const p = await page(base, { cloud: OWNER, hash: '#/settings', cloudOpts: { requests: [{ user_id: 'u-rep', name: 'محمد', approved: true }] } });
      await p.waitForTimeout(600);
      assert.deepStrictEqual(await p.evaluate(() => db.accounts.filter(a => a.repBox).map(a => a.name)), ['صندوق المندوب: محمد']);
    },
  },
  {
    name: 'المندوب بيقبض من زبون: بينزل بصندوقه، وبيبيّن العملة القديمة، وبلا رصيد',
    fn: async base => {
      const p = await page(base, { cloud: REP, ls: { daftar_rep_name: 'محمد' } });
      await setupRep(p);
      await p.click('a[href="#/vouchers?new=receipt"]'); await p.waitForTimeout(300);
      await p.selectOption('#dlg [name=acc]', 'cust1');
      await p.fill('#dlg [name=amount]', '1000'); await p.dispatchEvent('#dlg [name=amount]', 'input');
      assert.match(await p.text('.amt-old'), /100,000/);
      await p.click('#dlg button.pri'); await p.waitForTimeout(400);
      const v = await p.evaluate(() => db.vouchers.slice(-1)[0]);
      assert.strictEqual(v.cashAcc, 'repbox_1'); assert.strictEqual(v.rep, 'محمد'); assert.strictEqual(v.amount, 1000);
      assert.doesNotMatch(await p.text('#dlg'), /الحساب القديم|رصيد الحساب/);
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'فاتورة المندوب ما فيها غير صندوقه',
    fn: async base => {
      const p = await page(base, { cloud: REP, ls: { daftar_rep_name: 'محمد' } });
      await setupRep(p);
      await p.go('#/invoice/new?type=sale'); await p.closeDlg();
      assert.deepStrictEqual(await p.$$eval('[name=cashAcc] option', os => os.map(o => o.value)), ['repbox_1']);
    },
  },
  {
    name: 'المدير بيستلم من صندوق المندوب ورصيده بيصير صفر',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await setupRep(p);
      await p.evaluate(() => { db.vouchers.push({ id: 'v1', type: 'receipt', no: 1, date: today(), acc: 'cust1', cashAcc: 'repbox_1', amount: 5000, cur: 'base', rate: '', rep: 'محمد' }); save(); route(); });
      assert.match(await p.text(), /صندوق المندوب: محمد 5,000/);
      await p.click('[data-act=takeBox]'); await p.click('#dlg button.pri'); await p.waitForTimeout(300);
      assert.match(await p.text(), /صندوق المندوب: محمد 0 /);
    },
  },
  {
    name: 'الترقيم: جهازين بنفس الوقت ما بياخدوا نفس الرقم',
    fn: async base => {
      const a = await page(base, { cloud: OWNER }), b = await page(base, { cloud: OWNER });
      // السحابة الوهمية مشتركة بين الجهازين
      b.cloud.counter = 0; await b.unroute(/supabase\.co/); await b.route(/supabase\.co/, a.cloud.handler);
      const mk = p => p.evaluate(() => { const o = newNo('receipt'); db.vouchers.push({ id: uid(), type: 'receipt', ...o, date: today(), acc: 'cash', cashAcc: 'cash', amount: 1 }); save(); return o.no; });
      await a.evaluate(() => reserveNo('receipt')); await b.evaluate(() => reserveNo('receipt')); await a.waitForTimeout(400);
      const nums = [await mk(a), await mk(b)]; await a.waitForTimeout(500); nums.push(await mk(a), await mk(b));
      assert.strictEqual(new Set(nums).size, 4, 'أرقام مكررة: ' + nums);
    },
  },
  {
    name: 'الترقيم: رقم انعمل بلا نت وطلع مكرر بيتصلّح لحاله',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      const r = await p.evaluate(async () => {
        db.vouchers.push({ id: 'srv', type: 'receipt', no: 99, date: today(), acc: 'cash', cashAcc: 'cash', amount: 5, created: 1 },
          { id: 'loc', type: 'receipt', no: 99, nl: 1, date: today(), acc: 'cash', cashAcc: 'cash', amount: 6, created: 2 }); save();
        await Cloud.sync(true); return db.vouchers.filter(v => ['srv', 'loc'].includes(v.id)).map(v => v.no);
      });
      assert.strictEqual(r[0], 99); assert.notStrictEqual(r[1], 99);
    },
  },
  {
    name: 'التسعير: آخر سعر للزبون، وإلا سعر البطاقة، و«زبون عام» دايماً البطاقة',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => {
        db.items.push({ id: 'it1', code: '1', name: 'سكر', unit: 'كغ', buyPrice: 900, sellPrice: 1000, openQty: 100 });
        db.accounts.push({ id: 'c1', code: '112001', name: 'أحمد', type: 'asset', parent: 'customers', group: false }, { id: 'c2', code: '112002', name: 'سامر', type: 'asset', parent: 'customers', group: false });
        ensureWalkin();
        db.invoices.push({ id: 'old', type: 'sale', no: 1, date: '2026-01-01', pay: 'credit', party: 'c1', cur: 'base', rate: '', lines: [{ item: 'it1', qty: 1, price: 1080 }], discount: 0, created: 1 },
          { id: 'w', type: 'sale', no: 2, date: '2026-01-02', pay: 'cash', party: 'walkin', cur: 'base', rate: '', lines: [{ item: 'it1', qty: 1, price: 1090 }], discount: 0, created: 2 }); save();
      });
      const priceFor = async party => {
        await p.go('#/invoices'); await p.go('#/invoice/new?type=sale'); await p.closePicker();
        await p.click('[data-act=more]');
        await p.selectOption('[name=party]', party); await p.dispatchEvent('[name=party]', 'change');
        await p.click('#scanIn'); await p.keyboard.type('سكر'); await p.waitForTimeout(300);
        return (await p.locator('.sg-meta').first().innerText()).match(/[\d,]+/)[0];
      };
      assert.strictEqual(await priceFor('c1'), '1,080');
      assert.strictEqual(await priceFor('c2'), '1,000');
      assert.strictEqual(await priceFor('walkin'), '1,000');
    },
  },
  {
    name: 'مسودة الفاتورة: بترجع إذا جديدة، وبتنتسى إذا قديمة',
    fn: async base => {
      const draft = at => JSON.stringify({ lines: [{ item: 'it1', qty: 1, price: 950 }], payment: '', inv: { date: '2026-01-01', pay: 'cash', cashAcc: 'cash', party: '' }, ...(at ? { at } : {}) });
      for (const [at, want] of [[null, 0], [Date.now(), 1]]) {
        const p = await page(base, { cloud: OWNER });
        await p.evaluate(d => { db.items.push({ id: 'it1', name: 'بسكوت', sellPrice: 950 }); save(); localStorage.setItem('daftar_draft_sale', d); }, draft(at));
        await p.asReload(); await p.go('#/invoice/new?type=sale');
        assert.strictEqual(await p.locator('.draft-note').count(), want);
      }
    },
  },
  {
    name: 'زر + بالمادة بيزيد الكمية وما بيطلّع الصفحة لفوق',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => { for (let i = 0; i < 8; i++) db.items.push({ id: 'i' + i, name: 'مادة ' + i, sellPrice: 1000, openQty: 50 }); ensureWalkin(); save();
        localStorage.setItem('daftar_draft_sale', JSON.stringify({ lines: db.items.map(it => ({ item: it.id, qty: 1, price: 1000 })), payment: '', inv: { date: today(), pay: 'cash', cashAcc: 'cash', party: 'walkin' }, at: Date.now() })); });
      await p.asReload(); await p.go('#/invoice/new?type=sale'); await p.closeDlg();
      const btn = p.locator('.ln-card [data-act=inc]').nth(5);
      await btn.scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, 150)); await p.waitForTimeout(200);
      const y0 = await p.evaluate(() => scrollY);
      await p.focus('#scanIn'); await p.evaluate(() => window.dispatchEvent(new Event('touchmove')));
      await btn.click(); await p.waitForTimeout(900);
      assert.ok(await p.evaluate(() => scrollY) > y0 - 200, 'الصفحة طلعت لفوق');
      assert.ok((await p.evaluate(() => JSON.parse(localStorage.getItem('daftar_draft_sale')).lines.map(l => l.qty))).includes(2));
    },
  },
  {
    name: 'المستودع: لا المدير ولا المندوب بيطلعلهن تنبيه، والفاتورة بتنحفظ دغري',
    fn: async base => {
      const draft = pt => JSON.stringify({ lines: [{ item: 'it1', qty: 5, price: 1000 }], payment: '', inv: { date: new Date().toISOString().slice(0, 10), pay: 'cash', cashAcc: pt === 'walkin' ? 'repbox_1' : 'cash', party: 'walkin' }, at: Date.now() });
      // المدير
      const o = await page(base, { cloud: OWNER });
      await o.evaluate(() => { db.items.push({ id: 'it1', code: '1', name: 'بسكوت', sellPrice: 1000, buyPrice: 900, openQty: 2 }); ensureWalkin(); save(); });
      await o.evaluate(d => localStorage.setItem('daftar_draft_sale', d), draft('x').replace('"cashAcc":"repbox_1"', '"cashAcc":"cash"'));
      await o.asReload(); await o.go('#/invoice/new?type=sale'); await o.closeDlg();
      const n0 = await o.evaluate(() => db.invoices.length);
      await o.click('[data-act=save]'); await o.waitForTimeout(600);
      assert.strictEqual(await o.evaluate(() => db.invoices.length), n0 + 1, 'المدير لازم يحفظ دغري بلا تنبيه');
      // المندوب
      const p = await page(base, { cloud: REP, ls: { daftar_rep_name: 'محمد' } });
      await p.evaluate(() => { db.accounts.push({ id: 'repbox_1', code: '1113', name: 'صندوق المندوب: محمد', type: 'asset', parent: 'cashGroup', group: false, repBox: 'محمد' }); db.items.push({ id: 'it1', code: '1', name: 'بسكوت', sellPrice: 1000, buyPrice: 900, openQty: 2 }); ensureWalkin(); save(); });
      await p.evaluate(d => localStorage.setItem('daftar_draft_sale', d), draft('walkin'));
      await p.asReload(); await p.go('#/invoice/new?type=sale'); await p.closeDlg();
      const m0 = await p.evaluate(() => db.invoices.length);
      await p.click('[data-act=save]'); await p.waitForTimeout(600);
      assert.doesNotMatch(await p.text('#dlg').catch(() => ''), /ما بتكفي/);
      assert.strictEqual(await p.evaluate(() => db.invoices.length), m0 + 1);
    },
  },
  {
    name: 'شرط الـ 10%: آخر سعر للزبون مقبول، وسعر عالي لزبون جديد ممنوع',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => {
        db.items.push({ id: 'it1', code: '1', name: 'سكر', sellPrice: 1000, buyPrice: 900, openQty: 100 });
        db.accounts.push({ id: 'c1', code: '112001', name: 'أحمد', type: 'asset', parent: 'customers', group: false }, { id: 'c2', code: '112002', name: 'سامر', type: 'asset', parent: 'customers', group: false });
        db.invoices.push({ id: 'old', type: 'sale', no: 1, date: '2026-01-01', pay: 'credit', party: 'c1', cur: 'base', rate: '', lines: [{ item: 'it1', qty: 1, price: 1150 }], discount: 0, created: 1 }); save();
      });
      const trySave = async party => {
        await p.evaluate(pt => localStorage.setItem('daftar_draft_sale', JSON.stringify({ lines: [{ item: 'it1', qty: 1, price: 1150 }], payment: '', inv: { date: today(), pay: 'credit', cashAcc: 'cash', party: pt }, at: Date.now() })), party);
        await p.go('#/invoices'); await p.asReload(); await p.go('#/invoice/new?type=sale'); await p.closeDlg();
        const n0 = await p.evaluate(() => db.invoices.length);
        await p.click('[data-act=save]'); await p.waitForTimeout(500);
        return (await p.evaluate(() => db.invoices.length)) - n0;
      };
      assert.strictEqual(await trySave('c1'), 1, 'آخر سعر لأحمد (1150) لازم ينقبل');
      assert.strictEqual(await trySave('c2'), 0, 'سامر ما اشترى قبل — 1150 أعلى من البطاقة بـ 15٪ لازم ينرفض');
    },
  },
  {
    name: 'فاتورة المبيع: الخانات مخبّاية تحت زر «تعديل» واحد، وبتنفتح بكبسة',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => { db.accounts.push({ id: 'c1', code: '112001', name: 'أحمد', type: 'asset', parent: 'customers', group: false }); save(); });
      await p.go('#/invoice/new?type=sale'); await p.closePicker();
      assert.strictEqual(await p.locator('#invMore').isVisible(), false, 'لازم تكون مخبّاية');
      assert.strictEqual(await p.locator('[name=date]').isVisible(), false);
      await p.click('[data-act=more]');
      assert.strictEqual(await p.locator('[name=date]').isVisible(), true);
      await p.selectOption('[name=party]', 'c1'); await p.dispatchEvent('[name=party]', 'change');
      assert.match(await p.text('#moreSum'), /أحمد · آجل/);
      await p.click('[data-act=more]');
      assert.strictEqual(await p.locator('#invMore').isVisible(), false, 'كبسة تانية بتسكّرها');
      // فاتورة الشراء ما تغيّرت
      await p.go('#/invoices'); await p.go('#/invoice/new?type=purchase'); await p.closeDlg();
      assert.strictEqual(await p.locator('[name=date]').isVisible(), true);
    },
  },
  {
    name: 'زبون جديد من فاتورة المبيع: من نافذة «اختار العميل» ومن زر جنب خانة العميل',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => { db.items.push({ id: 'it1', code: '1', name: 'سكر', sellPrice: 1000, openQty: 50 }); save(); });
      await p.go('#/invoice/new?type=sale');
      await p.waitForFunction(() => document.getElementById('dlg').open);
      await p.fill('#ppQ', 'أبو خالد');
      assert.match(await p.text('#ppNew'), /إضافة «أبو خالد» كزبون جديد/);
      await p.click('#ppNew'); await p.waitForTimeout(150);
      assert.strictEqual(await p.inputValue('#dlg [name=name]'), 'أبو خالد');
      await p.fill('#dlg [name=phone]', '0933111222');
      await p.click('#dlg button.pri'); await p.waitForTimeout(200);
      const a = await p.evaluate(() => db.accounts.find(x => x.name === 'أبو خالد'));
      assert.ok(a && a.parent === 'customers' && a.phone === '0933111222');
      assert.strictEqual(await p.evaluate(() => document.querySelector('[name=party]').value), a.id);
      assert.strictEqual(await p.evaluate(() => document.getElementById('dlg').open), false);
      // الزر جنب خانة العميل
      await p.click('[data-act=more]'); await p.click('[data-act=newParty]'); await p.waitForTimeout(150);
      await p.fill('#dlg [name=name]', 'محل النور'); await p.click('#dlg button.pri'); await p.waitForTimeout(200);
      const b = await p.evaluate(() => db.accounts.find(x => x.name === 'محل النور'));
      assert.strictEqual(await p.evaluate(() => document.querySelector('[name=party]').value), b.id);
      // الحفظ بيمشي عالزبون الجديد
      await p.fill('#scanIn', 'سكر'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
      await p.click('[data-act=save]'); await p.waitForTimeout(500);
      assert.strictEqual(await p.evaluate(() => db.invoices.slice(-1)[0].party), b.id);
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'بطاقة المادة: تحت سعر الشراء والمبيع بيطلع السعر بالعملة القديمة',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => { db.settings.showOld = '1'; db.settings.oldFactor = 100; db.items.push({ id: 'it1', code: '1', name: 'سكر', sellPrice: 12, buyPrice: 10 }); save(); });
      await p.go('#/items'); await p.click('[data-act=edit][data-id=it1]'); await p.waitForTimeout(150);
      const hint = k => p.evaluate(k => document.querySelector(`#dlg [name=${k}]`).closest('.fld').querySelector('.amt-old').textContent, k);
      assert.match(await hint('sellPrice'), /1,200/); assert.match(await hint('buyPrice'), /1,000/);
      await p.fill('#dlg [name=sellPrice]', '15');
      assert.match(await hint('sellPrice'), /1,500/);
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'فاتورة مبيع جديدة دايماً بتفتح فاضية (المسودة بترجع بس إذا البرنامج رجع حمّل عليها)',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => { db.items.push({ id: 'it1', name: 'بسكوت', sellPrice: 950 }); ensureWalkin(); save();
        localStorage.setItem('daftar_draft_sale', JSON.stringify({ lines: [{ item: 'it1', qty: 3, price: 950 }], payment: '', inv: { date: today(), pay: 'cash', cashAcc: 'cash', party: 'walkin' }, at: Date.now() })); });
      await p.go('#/invoice/new?type=sale'); await p.closeDlg();
      assert.strictEqual(await p.locator('.draft-note').count(), 0);
      assert.strictEqual(await p.locator('.ln-card').count(), 0);
      assert.strictEqual(await p.evaluate(() => localStorage.getItem('daftar_draft_sale')), null);
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'ما في طلعة من الفاتورة إلا بالحفظ أو الحذف',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => { db.items.push({ id: 'it1', name: 'بسكوت', sellPrice: 950, openQty: 50 }); ensureWalkin(); save(); });
      await p.go('#/invoice/new?type=sale');
      await p.click('.pp-item.wk'); await p.waitForTimeout(150);
      await p.fill('#scanIn', 'بسكوت'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
      // محاولة الطلعة ← بيضل عالفاتورة وبتطلع نافذة
      await p.go('#/items');
      assert.match(await p.evaluate(() => location.hash), /invoice\/new/);
      assert.match(await p.text('#dlg'), /لسا ما انحفظت/);
      await p.click('#dlg footer [data-close]'); // رجوع للفاتورة
      assert.strictEqual(await p.locator('.ln-card').count(), 1);
      // حفظ من النافذة ← بينحفظ وبيروح للصفحة المطلوبة
      const n0 = await p.evaluate(() => db.invoices.length);
      await p.go('#/items'); await p.click('#lvSave'); await p.waitForTimeout(400);
      assert.strictEqual(await p.evaluate(() => db.invoices.length), n0 + 1);
      assert.strictEqual(await p.evaluate(() => location.hash), '#/items');
      // فاتورة تانية ← حذف ← بتطلع بلا حفظ
      await p.go('#/invoice/new?type=sale'); await p.click('.pp-item.wk'); await p.waitForTimeout(150);
      await p.fill('#scanIn', 'بسكوت'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
      await p.go('#/'); await p.click('#lvDel'); await p.waitForTimeout(300);
      assert.strictEqual(await p.evaluate(() => db.invoices.length), n0 + 1);
      assert.match(await p.evaluate(() => location.hash), /^#\/?$/);
      // فاتورة فاضية ← بتطلع عادي
      await p.go('#/invoice/new?type=sale'); await p.closeDlg(); await p.go('#/items');
      assert.strictEqual(await p.evaluate(() => location.hash), '#/items');
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'زر «مراجعة» بدل المايك بالفاتورة: بيفتح صورة الفاتورة حتى لو لسا ما انحفظت، والرصيد محسوب صح، والصورة بتكبر وبتصغر',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => {
        db.items.push({ id: 'it1', code: '1', name: 'سكر', sellPrice: 1000, buyPrice: 900, openQty: 50 });
        db.accounts.push({ id: 'c1', code: '112001', name: 'أحمد', type: 'asset', parent: 'customers', group: false });
        db.invoices.push({ id: 'o', type: 'sale', no: 1, date: '2026-01-01', pay: 'credit', party: 'c1', cur: 'base', rate: '', lines: [{ item: 'it1', qty: 5, price: 1000 }], discount: 0, created: 1 }); save();
      });
      await p.go('#/invoice/new?type=sale'); await p.closePicker();
      assert.strictEqual(await p.locator('.search-wrap [data-act=mic]').count(), 0, 'المايك انشال من جنب البحث');
      await p.click('[data-act=review]'); await p.waitForTimeout(200);
      assert.match(await p.text('#toast'), /ما في مواد/);
      await p.evaluate(() => InvHook.setParty('c1'));
      await p.fill('#scanIn', 'سكر'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
      await p.click('[data-act=more]'); await p.fill('[name=payment]', '300'); await p.dispatchEvent('[name=payment]', 'input');
      // نفس الأرقام يلي بتنرسم بالصورة
      await p.evaluate(() => { const b = Receipt.build; window.__rev = null; Receipt.build = (d, o) => { window.__rev = { no: d.no, before: o.before, paid: o.paid, n: d.lines.length }; return b(d, o); }; });
      await p.click('[data-act=review]'); await p.waitForTimeout(500);
      assert.deepStrictEqual(await p.evaluate(() => window.__rev), { no: 'جديدة', before: 5000, paid: 300, n: 1 });
      assert.ok(await p.evaluate(() => document.querySelector('#dlg .rev-img').src.startsWith('data:image/png')));
      assert.strictEqual(await p.evaluate(() => db.invoices.length), 1, 'المراجعة ما بتحفظ الفاتورة');
      // تكبير وتصغير: بالأزرار وبالشريط، وبين 50% و400%
      const w = () => p.evaluate(() => document.querySelector('#dlg .rev-img').style.width);
      await p.click('#dlg [data-z=in]'); assert.strictEqual(await w(), '125%');
      await p.click('#dlg [data-z=out]'); await p.click('#dlg [data-z=out]'); assert.strictEqual(await w(), '75%');
      await p.fill('#dlg .rev-zoom input', '400'); assert.strictEqual(await w(), '400%');
      await p.click('#dlg [data-z=in]'); assert.strictEqual(await w(), '400%', 'ما بيكبر أكتر من 400%');
      assert.match(await p.text('#dlg .rev-pct'), /400%/);
      await p.click('#dlg [data-z=fit]'); assert.strictEqual(await w(), '100%');
      assert.deepStrictEqual(p.errors, []);
    },
  },
];
