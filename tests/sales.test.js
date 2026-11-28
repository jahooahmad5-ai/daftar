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
    name: 'شرط الـ 15%: فوق سعر البطاقة بأكتر من 15٪ ممنوع — حتى لو آخر سعر للزبون كان أعلى',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => {
        db.items.push({ id: 'it1', code: '1', name: 'سكر', sellPrice: 1000, buyPrice: 900, openQty: 100 });
        db.accounts.push({ id: 'c1', code: '112001', name: 'أحمد', type: 'asset', parent: 'customers', group: false }, { id: 'c2', code: '112002', name: 'سامر', type: 'asset', parent: 'customers', group: false });
        db.invoices.push({ id: 'old', type: 'sale', no: 1, date: '2026-01-01', pay: 'credit', party: 'c1', cur: 'base', rate: '', lines: [{ item: 'it1', qty: 1, price: 1600 }], discount: 0, created: 1 }); save();
      });
      const trySave = async (party, price) => {
        await p.evaluate(x => { leaveGuard = null; const g = document.getElementById('dlg'); if (g.open) g.close(); localStorage.setItem('daftar_draft_sale', JSON.stringify({ lines: [{ item: 'it1', qty: 1, price: x.price }], payment: '', inv: { date: today(), pay: 'credit', cashAcc: 'cash', party: x.party }, at: Date.now() })); }, { party, price });
        await p.go('#/invoices'); await p.asReload(); await p.go('#/invoice/new?type=sale'); await p.closeDlg();
        const n0 = await p.evaluate(() => db.invoices.length);
        await p.click('[data-act=save]'); await p.waitForTimeout(500);
        return (await p.evaluate(() => db.invoices.length)) - n0;
      };
      assert.strictEqual(await trySave('c1', 1600), 0, 'أحمد اشترى قبل بـ 1600 — بس هلق أعلى من البطاقة بأكتر من 15٪ ← مرفوض');
      assert.strictEqual(await trySave('c2', 1160), 0, '1160 أعلى من البطاقة بأكتر من 15٪ ← مرفوض');
      assert.strictEqual(await trySave('c2', 1150), 1, 'زيادة 15٪ بالضبط مسموحة');
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
  {
    name: 'زر + و − بالمادة ما بيسكّر الكيبورد: التركيز بيضل بالخانة (كبس بالإصبع)',
    fn: async base => {
      const p = await page(base, { cloud: OWNER, device: { hasTouch: true, isMobile: true } });
      await p.evaluate(() => { db.items.push({ id: 'it1', name: 'بسكوت', sellPrice: 1000, openQty: 50 }); ensureWalkin(); save(); });
      await p.go('#/invoice/new?type=sale'); await p.click('.pp-item.wk'); await p.waitForTimeout(150);
      await p.fill('#scanIn', 'بسكوت'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
      await p.focus('#scanIn');
      await p.tap('.ln-card [data-act=inc]'); await p.waitForTimeout(200);
      assert.strictEqual(await p.evaluate(() => document.activeElement.id), 'scanIn', 'الكيبورد تسكّر');
      assert.strictEqual(await p.inputValue('.ln-card [data-f=qty]'), '2');
      await p.tap('.ln-card [data-act=dec]'); await p.waitForTimeout(200);
      assert.strictEqual(await p.evaluate(() => document.activeElement.id), 'scanIn');
      assert.strictEqual(await p.inputValue('.ln-card [data-f=qty]'), '1');
      // وإذا كنت عم تكتب بخانة الكمية نفسها
      await p.focus('.ln-card [data-f=qty]');
      await p.tap('.ln-card [data-act=inc]'); await p.waitForTimeout(200);
      assert.ok(await p.evaluate(() => document.activeElement.matches('.ln-card [data-f=qty]')), 'الكيبورد تسكّر من خانة الكمية');
      assert.strictEqual(await p.inputValue('.ln-card [data-f=qty]'), '2');
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'صفحة السند: قبض ودفع من صفحة لحالها، الحساب، المبلغ، الحركات الأخيرة والرصيد، والتعديل',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => {
        db.items.push({ id: 'it1', code: '1', name: 'سكر', sellPrice: 1000, buyPrice: 900, openQty: 50 });
        db.accounts.push({ id: 'c1', code: '112001', name: 'أحمد', type: 'asset', parent: 'customers', group: false });
        db.invoices.push({ id: 'o', type: 'sale', no: 5, date: '2026-01-01', pay: 'credit', party: 'c1', cur: 'base', rate: '', lines: [{ item: 'it1', qty: 5, price: 1000 }], discount: 0, created: 1 }); save();
      });
      await p.go('#/vouchers'); await p.click('[data-act=new][data-id=receipt]'); await p.waitForTimeout(300);
      assert.match(await p.evaluate(() => location.hash), /#\/voucher\/new\?type=receipt/);
      // بلا حساب ← بتنفتح قائمة الحسابات
      await p.fill('[name=amount]', '1500'); await p.click('[data-act=save]'); await p.waitForTimeout(200);
      assert.ok(await p.evaluate(() => document.getElementById('dlg').open));
      await p.click('#dlg .pp-item[data-id=c1]'); await p.waitForTimeout(200);
      assert.match(await p.text('.vp-hist'), /مبيع #5.*\+5,000/);
      assert.match(await p.text('.vp-bar'), /5,000 ل.س عليه/);
      assert.strictEqual(await p.inputValue('[name=amount]'), '1500', 'المبلغ ما ضاع لما اخترت الحساب');
      await p.fill('[name=note]', 'دفعة'); await p.click('[data-act=save]'); await p.waitForTimeout(300);
      const v = await p.evaluate(() => db.vouchers.slice(-1)[0]);
      assert.strictEqual(v.type, 'receipt'); assert.strictEqual(v.acc, 'c1'); assert.strictEqual(v.amount, 1500); assert.strictEqual(v.note, 'دفعة');
      assert.strictEqual(await p.evaluate(() => location.hash), '#/voucher/' + v.id);
      assert.match(await p.text('.vp-bar'), /3,500 ل.س عليه/);
      assert.match(await p.text('.vp-bar-old'), /بالقديم: 350,000/, 'الرصيد بالعملة القديمة تحت الرصيد');
      assert.ok(await p.locator('.vp-bar.owe').count(), 'الشريط أحمر لما الزبون عليه');
      // رصيده مثبّت فوق: بعد التمرير لتحت بيضل مبيّن تحت الشريط الأخضر
      await p.evaluate(() => scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(200);
      const r = await p.evaluate(() => { const b = document.querySelector('.vp-bar').getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: innerHeight }; });
      assert.ok(r.top >= 0 && r.bottom <= r.h, 'رصيده مبيّن بعد التمرير');
      await p.evaluate(() => scrollTo(0, 0));
      assert.match(await p.text('.vp-hist'), /سند قبض #\d+ .*دفعة -1,500/);
      // الألوان: فاتورة المبيع (دين) أحمر، سند القبض (مصاري داخلة) أخضر
      assert.deepStrictEqual(await p.evaluate(() => [...document.querySelectorAll('.vp-mv-a')].map(x => x.className.split(' ').pop())), ['up', 'down']);
      // تعديل المبلغ
      await p.fill('[name=amount]', '2000'); await p.click('[data-act=save]'); await p.waitForTimeout(300);
      assert.strictEqual(await p.evaluate(id => db.vouchers.find(x => x.id === id).amount, v.id), 2000);
      assert.strictEqual(await p.evaluate(() => db.vouchers.length), 1);
      // مشاركة وطباعة ← خيارات الواتساب والطباعة
      await p.click('[data-act=share]'); assert.ok(await p.locator('#dlg #vWa').count()); await p.closeDlg();
      // سند دفع لنفس الزبون
      await p.go('#/voucher/new?type=payment&acc=c1'); await p.waitForTimeout(200);
      assert.match(await p.text('.vp-card'), /دفعنا إلى/);
      await p.fill('[name=amount]', '500'); await p.click('[data-act=save]'); await p.waitForTimeout(300);
      assert.strictEqual(await p.evaluate(() => db.vouchers.slice(-1)[0].type), 'payment');
      assert.match(await p.text('.vp-bar'), /3,500 ل.س عليه/);
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: '«💵 دفعة من زبون» مربع لحاله بالرئيسية والقائمة: زباين بس، بينحفظ سند قبض',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => {
        db.accounts.push({ id: 'c1', code: '112001', name: 'أحمد', type: 'asset', parent: 'customers', group: false, openBal: 0 });
        db.accounts.push({ id: 's1', code: '221001', name: 'مورد السكر', type: 'liability', parent: 'suppliers', group: false }); save(); route();
      });
      assert.strictEqual(await p.locator('#nav a[href*="mode=cust"]').count(), 1, 'بالقائمة');
      await p.click('.quick a[href*="mode=cust"]'); await p.waitForTimeout(300);
      assert.match(await p.text('.vp'), /دفعة من زبون/);
      assert.strictEqual(await p.locator('.vp-seg').count(), 0, 'ما في قبض/دفع — قبض بس');
      await p.click('[data-act=pick]'); await p.waitForTimeout(200);
      assert.strictEqual(await p.locator('#dlg .pp-item[data-id=s1]').count(), 0, 'الموردين ما بيطلعوا');
      await p.click('#dlg .pp-item[data-id=c1]'); await p.waitForTimeout(200);
      await p.fill('[name=amount]', '700'); await p.click('[data-act=save]'); await p.waitForTimeout(300);
      const v = await p.evaluate(() => db.vouchers.slice(-1)[0]);
      assert.strictEqual(v.type, 'receipt'); assert.strictEqual(v.acc, 'c1'); assert.strictEqual(v.amount, 700);
      assert.match(await p.text('.vp'), /دفعة من زبون/, 'بعد الحفظ بيضل بنفس الشكل');
      await p.click('[data-act=another]'); await p.waitForTimeout(200);
      assert.match(await p.evaluate(() => location.hash), /mode=cust/);
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'مادة جديدة وإنت نازل لآخر القائمة: الصفحة بتطلع لفوق لعند المادة الجديدة',
    fn: async base => {
      const p = await page(base, { cloud: OWNER, device: { viewport: { width: 390, height: 700 } } });
      await p.evaluate(() => { for (let i = 1; i <= 15; i++) db.items.push({ id: 'it' + i, code: String(i), name: 'مادة ' + i, sellPrice: 1000, openQty: 50 }); db.items.push({ id: 'pep', code: '99', name: 'بيبسي', sellPrice: 400, openQty: 50 }); ensureWalkin(); save(); });
      await p.go('#/invoice/new?type=sale'); await p.click('.pp-item.wk'); await p.waitForTimeout(150);
      for (let i = 1; i <= 15; i++) { await p.fill('#scanIn', String(i)); await p.keyboard.press('Enter'); await p.waitForTimeout(60); }
      await p.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, document.body.scrollHeight); });
      await p.waitForTimeout(1700);
      assert.ok(await p.evaluate(() => window.scrollY) > 300, 'لازم نكون نازلين تحت');
      await p.fill('#scanIn', 'بيبسي'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
      const top = await p.evaluate(() => { const r = document.querySelector('.ln-card').getBoundingClientRect(); return { top: r.top, sw: document.querySelector('.search-wrap').getBoundingClientRect().bottom, h: innerHeight, name: document.querySelector('.ln-card').textContent }; });
      assert.match(top.name, /بيبسي/, 'الأحدث أول وحدة');
      assert.ok(top.top >= top.sw - 1 && top.top < top.h, 'المادة الجديدة لازم تكون ظاهرة تحت خانة البحث: ' + JSON.stringify(top));
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'حذف مادة من الفاتورة بالـ ✕: بيسأل «هل تريد حذف المادة» — لا ما بيحذف، نعم بيحذف',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => { db.items.push({ id: 'it1', code: '1', name: 'سكر', sellPrice: 1000, openQty: 50 }, { id: 'it2', code: '2', name: 'رز', sellPrice: 2000, openQty: 50 }); ensureWalkin(); save(); });
      await p.go('#/invoice/new?type=sale'); await p.click('.pp-item.wk'); await p.waitForTimeout(150);
      await p.fill('#scanIn', 'سكر'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
      await p.fill('#scanIn', 'رز'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
      const n = () => p.locator('.ln-card').count();
      assert.strictEqual(await n(), 2);
      await p.click('.ln-card [data-act=rmLine]'); await p.waitForTimeout(150);
      assert.match(await p.text('#dlg'), /هل تريد حذف المادة رز/);
      assert.match(await p.text('#dlg footer'), /نعم/); assert.match(await p.text('#dlg footer'), /لا/);
      await p.click('#dlg footer [data-close]'); await p.waitForTimeout(150);
      assert.strictEqual(await n(), 2, '«لا» ما بيحذف');
      await p.click('.ln-card [data-act=rmLine]'); await p.waitForTimeout(150);
      await p.click('#dlg footer .btn.pri'); await p.waitForTimeout(150);
      assert.strictEqual(await n(), 1, '«نعم» بيحذف');
      assert.match(await p.text('.ln-card'), /سكر/);
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'باركود من جوّا فاتورة المبيع: مادة جديدة بباركود، وباركود ما إله مادة بيفتح «مادة جديدة» معبّى، والتعديل فيه خانة باركود',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => { db.items.push({ id: 'it1', code: '1', name: 'سكر', sellPrice: 1000, openQty: 50, barcodes: ['5550001'] }); ensureWalkin(); save(); });
      await p.go('#/invoice/new?type=sale'); await p.click('.pp-item.wk'); await p.waitForTimeout(150);
      // 1) مادة جديدة بالاسم + باركود
      await p.fill('#scanIn', 'بيبسي'); await p.dispatchEvent('#scanIn', 'input'); await p.waitForTimeout(150);
      await p.click('.sg-new'); await p.waitForTimeout(150);
      assert.ok(await p.locator('#dlg [name=barcode]').count(), 'لازم يكون في خانة باركود');
      await p.fill('#dlg [name=price]', '400'); await p.fill('#dlg [name=barcode]', '5550001');
      await p.click('#dlg footer .btn.pri'); await p.waitForTimeout(150);
      assert.match(await p.text('#toast'), /الباركود 5550001 مستخدم للمادة: سكر/);
      await p.fill('#dlg [name=barcode]', '6290000000123');
      await p.click('#dlg footer .btn.pri'); await p.waitForTimeout(300);
      assert.deepStrictEqual(await p.evaluate(() => db.items.find(x => x.name === 'بيبسي').barcodes), ['6290000000123']);
      // بالمسح بعدين بتنلقى
      await p.fill('#scanIn', '6290000000123'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
      assert.strictEqual(await p.evaluate(() => [...document.querySelectorAll('.ln-card')].filter(c => /بيبسي/.test(c.textContent)).length), 2);
      // 2) باركود ما إله مادة ← «مادة جديدة» والباركود معبّى
      await p.fill('#scanIn', '7771234567'); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
      assert.strictEqual(await p.inputValue('#dlg [name=barcode]'), '7771234567');
      assert.strictEqual(await p.inputValue('#dlg [name=name]'), '');
      await p.fill('#dlg [name=name]', 'شيبس'); await p.fill('#dlg [name=price]', '500');
      await p.click('#dlg footer .btn.pri'); await p.waitForTimeout(300);
      assert.deepStrictEqual(await p.evaluate(() => db.items.find(x => x.name === 'شيبس').barcodes), ['7771234567']);
      // 3) تعديل المادة من الفاتورة (✏️) فيه خانة الباركودات
      await p.evaluate(() => document.querySelector('[data-act=editItem]').click()); await p.waitForTimeout(200);
      assert.ok(await p.locator('#dlg [name=barcodes]').count(), 'التعديل لازم يكون فيه باركود');
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'الأنواع تحت البند: «بسكوت 1000» فيه أنواع — البحث بالنوع بيضيف البند واسم النوع بيطلع بالفاتورة والطباعة والواتساب',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => { db.settings.waMode = 'text'; window.open = u => { (window.__opened = window.__opened || []).push(decodeURIComponent(u)); }; db.items.push({ id: 'b1', code: '1', name: 'بسكوت 1000', sellPrice: 1000, openQty: 100 }); ensureWalkin(); save(); });
      // الأنواع من بطاقة المادة
      await p.go('#/items'); await p.click('[data-act=edit][data-id=b1]'); await p.waitForTimeout(150);
      await p.fill('#dlg [name=variants]', 'ويفر شوكولا\nكيك فانيلا\nويفر شوكولا');
      await p.click('#dlg footer .btn.pri'); await p.waitForTimeout(200);
      assert.deepStrictEqual(await p.evaluate(() => db.items.find(x => x.id === 'b1').variants), ['ويفر شوكولا', 'كيك فانيلا']);
      await p.go('#/invoice/new?type=sale'); await p.click('.pp-item.wk'); await p.waitForTimeout(150);
      // البحث باسم النوع
      await p.fill('#scanIn', 'ويفر'); await p.dispatchEvent('#scanIn', 'input'); await p.waitForTimeout(150);
      assert.match(await p.text('#sugg'), /ويفر شوكولا ← بسكوت 1000/);
      await p.keyboard.press('Enter'); await p.waitForTimeout(250);
      assert.match(await p.text('.ln-card .ln-name'), /بسكوت 1000 \(ويفر شوكولا\)/);
      // البحث باسم البند بيطلّع البند وأنواعه
      await p.fill('#scanIn', 'بسكوت'); await p.dispatchEvent('#scanIn', 'input'); await p.waitForTimeout(150);
      assert.strictEqual(await p.locator('#sugg .sg[data-i]').count(), 3);
      await p.click('#sugg .sg[data-i="0"]'); await p.waitForTimeout(200);
      // تغيير النوع من السطر نفسه
      assert.strictEqual(await p.locator('.ln-card').first().locator('[data-f=vn]').count(), 1);
      await p.locator('.ln-card').first().locator('[data-f=vn]').selectOption('كيك فانيلا'); await p.waitForTimeout(200);
      assert.match(await p.locator('.ln-card .ln-name').first().innerText(), /بسكوت 1000 \(كيك فانيلا\)/);
      await p.click('[data-act=save]'); await p.waitForTimeout(500);
      const inv = await p.evaluate(() => db.invoices[db.invoices.length - 1]);
      assert.deepStrictEqual(inv.lines.map(l => [l.item, l.vn]).sort(), [['b1', 'كيك فانيلا'], ['b1', 'ويفر شوكولا']].sort());
      // المخزون على بند واحد
      assert.strictEqual(await p.evaluate(() => engine().stock.b1.qty), 98);
      // الطباعة والإيصال والواتساب
      const html = await p.evaluate(id => invoiceHtml(db.invoices.find(x => x.id === id)), inv.id);
      assert.match(html, /بسكوت 1000 \(ويفر شوكولا\)/); assert.match(html, /بسكوت 1000 \(كيك فانيلا\)/);
      assert.match(await p.evaluate(id => waInvoiceText(db.invoices.find(x => x.id === id)), inv.id), /• بسكوت 1000 \(ويفر شوكولا\): 1 × 1,000/);
      const drawn = await p.evaluate(id => { const T = []; const f = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { T.push(String(t)); return f.call(this, t, ...a); }; try { Receipt.build(db.invoices.find(x => x.id === id)); } finally { CanvasRenderingContext2D.prototype.fillText = f; } return T.join('|'); }, inv.id);
      assert.match(drawn, /ويفر/, 'الإيصال لازم يبيّن النوع'); assert.match(drawn, /فانيلا/);
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: '📷 باركود بالكاميرا من «تعديل مادة» جوّا الفاتورة: بتفتح الكاميرا وبينضاف الباركود، وإذا الكاميرا ممنوعة بيبيّن السبب',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await p.evaluate(() => {
        window.__code = '6291234567890';
        window.BarcodeDetector = class { static async getSupportedFormats() { return ['ean_13']; } async detect() { return window.__code ? [{ rawValue: window.__code }] : []; } };
        window.__deny = false;
        navigator.mediaDevices.getUserMedia = async () => { if (window.__deny) { const e = new Error('denied'); e.name = 'NotAllowedError'; throw e; } const c = document.createElement('canvas'); c.width = 8; c.height = 8; return c.captureStream(); };
        HTMLMediaElement.prototype.play = async function () {};
        db.items.push({ id: 'b1', code: '1', name: 'باميلو', sellPrice: 1000, openQty: 100 }); ensureWalkin(); save();
      });
      await p.go('#/invoice/new?type=sale'); await p.click('.pp-item.wk'); await p.waitForTimeout(150);
      await p.fill('#scanIn', 'باميلو'); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
      await p.evaluate(() => document.querySelector('[data-act=editItem]').click()); await p.waitForTimeout(250);
      await p.click('#bcScan'); await p.waitForTimeout(600);
      assert.strictEqual(await p.inputValue('#dlg [name=barcodes]'), '6291234567890', 'الباركود لازم ينضاف للخانة');
      assert.strictEqual(await p.evaluate(() => document.getElementById('dlg').open), true, 'نافذة التعديل لازم تضل مفتوحة');
      assert.strictEqual(await p.evaluate(() => document.getElementById('toast').matches(':popover-open')), true, 'الرسالة لازم تطلع فوق النافذة');
      // الكاميرا ممنوعة ← السبب جوّا نافذة المسح
      await p.evaluate(() => { window.__deny = true; });
      await p.click('#bcScan'); await p.waitForTimeout(400);
      assert.strictEqual(await p.evaluate(() => document.getElementById('scanDlg').open), true);
      assert.match(await p.text('#scanDlg'), /مش مسموحله يستعمل الكاميرا/);
      await p.click('#scanOk'); await p.waitForTimeout(150);
      assert.strictEqual(await p.evaluate(() => document.getElementById('scanDlg').open), false);
      await p.click('#dlg footer .btn.pri'); await p.waitForTimeout(300);
      assert.deepStrictEqual(await p.evaluate(() => db.items.find(x => x.id === 'b1').barcodes), ['6291234567890']);
      assert.deepStrictEqual(p.errors, []);
    },
  },
];
