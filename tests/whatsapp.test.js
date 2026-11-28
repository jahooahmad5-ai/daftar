'use strict';
// واتساب: أول مرة شاشة تأكيد، وبعدها إرسال مباشر على رقم الزبون — للفواتير والسندات وكشف الحساب
const assert = require('assert');
const { page, OWNER, REP } = require('./helpers');

const setup = p => p.evaluate(() => {
  db.settings.waMode = 'text'; // هالفحوصات للإرسال كنص (الصورة إلها فحوصات لحالها تحت)
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
      await p.click('[data-act=share]'); await p.click('#vWa'); await p.waitForTimeout(200);
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
  {
    name: 'المندوب بيختار «من موبايل المدير» ← بتوصل للمدير، وهو بيبعتها من رقمه ومعها رصيد الزبون',
    fn: async base => {
      // موبايل المندوب
      const r = await page(base, { cloud: REP, ls: { daftar_rep_name: 'محمد' } });
      await r.evaluate(() => {
        db.settings.waMode = 'text';
        window.open = u => { (window.__opened = window.__opened || []).push(u); };
        db.accounts.push({ id: 'repbox_1', code: '1113', name: 'صندوق المندوب: محمد', type: 'asset', parent: 'cashGroup', group: false, repBox: 'محمد' },
          { id: 'c1', code: '112001', name: 'أحمد', type: 'asset', parent: 'customers', group: false, phone: '0933123456' });
        db.items.push({ id: 'it1', name: 'سكر', sellPrice: 1000, buyPrice: 900, openQty: 100 });
        db.invoices.push({ id: 'ri1', type: 'sale', no: 3, date: today(), pay: 'credit', cashAcc: '', party: 'c1', cur: 'base', rate: '', lines: [{ item: 'it1', qty: 2, price: 1000 }], discount: 0, rep: 'محمد', created: 1 });
        save();
      });
      await r.go('#/invoice/ri1'); await r.click('[data-act=wa]'); await r.waitForTimeout(200);
      assert.match(await r.text('#dlg'), /من موبايل المدير/); assert.match(await r.text('#dlg'), /من موبايلي/);
      await r.click('#waMgr'); await r.waitForTimeout(300);
      assert.ok(await r.evaluate(() => db.invoices.find(i => i.id === 'ri1').waReq > 0));
      assert.strictEqual((await r.evaluate(() => window.__opened || [])).length, 0, 'ما لازم ينفتح واتساب على موبايل المندوب');
      await r.evaluate(() => Cloud.sync(true)); await r.waitForTimeout(300);
      const pushed = [...r.cloud.pushed].reverse().find(x => x.id === 'ri1'); // آخر نسخة ارتفعت
      assert.ok(pushed && pushed.data.waReq > 0, 'لازم يرتفع للسحابة مع علامة «لتنبعت من المدير»');

      // موبايل المدير: الفاتورة وصلت بالمزامنة
      const o = await page(base, { cloud: OWNER });
      await o.evaluate(d => {
        db.settings.waMode = 'text';
        window.open = u => { (window.__opened = window.__opened || []).push(decodeURIComponent(u)); };
        db.accounts.push({ id: 'repbox_1', code: '1113', name: 'صندوق المندوب: محمد', type: 'asset', parent: 'cashGroup', group: false, repBox: 'محمد' },
          { id: 'c1', code: '112001', name: 'أحمد', type: 'asset', parent: 'customers', group: false, phone: '0933123456' });
        db.items.push({ id: 'it1', name: 'سكر', sellPrice: 1000, buyPrice: 900, openQty: 100 });
        db.invoices.push(d); save(); waSetDirect('c1', '963933123456'); route(); waOutboxBar();
      }, pushed.data);
      assert.match(await o.text(), /1 رسالة من المندوب/);
      assert.strictEqual(await o.locator('#waOutBar').isVisible(), true, 'لازم يطلع شريط للمدير');
      await o.click('#waOutBar'); await o.waitForTimeout(300);
      assert.match(o.url(), /#\/outbox/);
      await o.click('[data-act=send]'); await o.waitForTimeout(700);
      const sent = await o.evaluate(() => window.__opened || []);
      assert.strictEqual(sent.length, 1);
      assert.match(sent[0], /^https:\/\/wa\.me\/963933123456\?text=/);
      assert.match(sent[0], /فاتورة مبيع رقم 3 — مندوب: محمد/);
      assert.match(sent[0], /رصيد الحساب الحالي/, 'من موبايل المدير لازم يكون فيها رصيد الزبون');
      assert.ok(await o.evaluate(() => db.invoices.find(i => i.id === 'ri1').waSent > 0));
      assert.match(await o.text(), /ما في رسائل بانتظار الإرسال/);
    },
  },
  {
    name: 'المندوب «من موبايلي»: بينفتح الواتساب عنده دغري، و«تلقائي» من الإعدادات بيبعت كل قبض للصندوق',
    fn: async base => {
      const r = await page(base, { cloud: REP, ls: { daftar_rep_name: 'محمد' } });
      await r.evaluate(() => {
        db.settings.waMode = 'text';
        window.open = u => { (window.__opened = window.__opened || []).push(decodeURIComponent(u)); };
        db.accounts.push({ id: 'repbox_1', code: '1113', name: 'صندوق المندوب: محمد', type: 'asset', parent: 'cashGroup', group: false, repBox: 'محمد' },
          { id: 'c1', code: '112001', name: 'أحمد', type: 'asset', parent: 'customers', group: false, phone: '0933123456' });
        waSetDirect('c1', '963933123456'); save(); route();
      });
      // قبض عادي ← «من موبايلي»
      await r.click('a[href="#/vouchers?new=receipt"]'); await r.waitForTimeout(300);
      await r.selectOption('#dlg [name=acc]', 'c1'); await r.fill('#dlg [name=amount]', '500'); await r.click('#dlg button.pri'); await r.waitForTimeout(400);
      assert.strictEqual(await r.evaluate(() => !!db.vouchers.slice(-1)[0].waReq), false, 'بلا «تلقائي» ما لازم يروح للصندوق لحاله');
      await r.click('#vWa'); await r.waitForTimeout(200); await r.click('#waMine'); await r.waitForTimeout(200);
      const o = await r.evaluate(() => window.__opened || []);
      assert.strictEqual(o.length, 1); assert.match(o[0], /سند قبض/); assert.doesNotMatch(o[0], /رصيد/);
      // المدير فعّل «تلقائي» ← القبض الجاي بيروح للصندوق لحاله
      await r.evaluate(() => { db.settings.waAuto = '1'; route(); });
      await r.go('#/'); await r.click('a[href="#/vouchers?new=receipt"]'); await r.waitForTimeout(300);
      await r.selectOption('#dlg [name=acc]', 'c1'); await r.fill('#dlg [name=amount]', '700'); await r.click('#dlg button.pri'); await r.waitForTimeout(400);
      assert.strictEqual(await r.evaluate(() => db.vouchers.slice(-1)[0].waReq > 0), true);
    },
  },
  {
    name: 'صورة مباشرة: بتنسخ صورة الفاتورة (PNG عالية الجودة) وبتفتح محادثة الزبون دغري — وأول ٣ مرات شرح كيف تلصقها',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await setup(p);
      await p.evaluate(() => {
        db.settings.waMode = 'img';
        navigator.canShare = () => true; navigator.share = async () => { window.__shared = (window.__shared || 0) + 1; };
        navigator.clipboard.write = async items => {
          const it = items[0], b = await it.getType('image/png'), bm = await createImageBitmap(b);
          (window.__clip = window.__clip || []).push({ types: it.types.join(), type: b.type, size: b.size, w: bm.width, h: bm.height });
        };
      });
      // أول مرة: شاشة تأكيد الرقم ← بتنسخ الصورة ← شرح اللصق ← «افتح المحادثة»
      await p.go('#/invoice/inv1'); await p.click('[data-act=wa]'); await p.waitForTimeout(200);
      assert.match(await p.text('#dlg'), /رح تنسخ الصورة/);
      await p.click('#waGo');
      await p.waitForSelector('#waOpen', { timeout: 10000 });
      let c = await p.evaluate(() => window.__clip);
      assert.strictEqual(c.length, 1); assert.strictEqual(c[0].types, 'image/png'); assert.strictEqual(c[0].type, 'image/png');
      assert.strictEqual(c[0].w, 1152, 'الصورة لازم تكون بالدقة العالية');
      assert.ok(c[0].h > 1000 && c[0].size > 20000, 'الصورة لازم تكون كاملة: ' + JSON.stringify(c[0]));
      assert.match(await p.text('#dlg'), /اكبس عليها/);
      assert.strictEqual((await opened(p)).length, 0, 'المحادثة بتنفتح بس لما يكبس «افتح المحادثة»');
      await p.click('#waOpen'); await p.waitForTimeout(200);
      let o = await opened(p);
      assert.deepStrictEqual(o, ['https://wa.me/963933123456'], 'محادثة الزبون دغري (بلا نص — الصورة فيها كل شي)');
      // بعد ٣ مرات شرح: السند بينسخ وبتنفتح المحادثة دغري بلا ولا شاشة
      await p.evaluate(() => localStorage.setItem('daftar_paste_help', '3'));
      await p.go('#/vouchers'); await p.click('tr[data-id="vr1"]'); await p.waitForTimeout(150); await p.click('[data-act=share]'); await p.click('#vWa');
      await p.waitForFunction(() => (window.__opened || []).length === 2, null, { timeout: 10000 });
      o = await opened(p); c = await p.evaluate(() => window.__clip);
      assert.strictEqual(o[1], 'https://wa.me/963933123456'); assert.strictEqual(c.length, 2); assert.strictEqual(c[1].w, 1152);
      assert.strictEqual(await p.evaluate(() => document.getElementById('dlg').open), false, 'ما لازم تطلع ولا شاشة');
      assert.ok(!(await p.evaluate(() => window.__shared)), 'ما لازم تطلع قائمة المشاركة');
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'صورة مباشرة من صندوق المدير: بتنعلّم «انبعتت» بس لما تنفتح المحادثة فعلاً',
    fn: async base => {
      const o = await page(base, { cloud: OWNER });
      await o.evaluate(() => {
        db.settings.waMode = 'img';
        window.open = u => { (window.__opened = window.__opened || []).push(decodeURIComponent(u)); };
        db.accounts.push({ id: 'c1', code: '112001', name: 'أحمد', type: 'asset', parent: 'customers', group: false, phone: '0933123456' });
        db.items.push({ id: 'it1', name: 'سكر', sellPrice: 1000, buyPrice: 900, openQty: 100 });
        db.invoices.push({ id: 'ri1', type: 'sale', no: 3, date: today(), pay: 'credit', cashAcc: '', party: 'c1', cur: 'base', rate: '', lines: [{ item: 'it1', qty: 2, price: 1000 }], discount: 0, rep: 'محمد', created: 1, waReq: Date.now() });
        save(); waSetDirect('c1', '963933123456');
        navigator.clipboard.write = async items => { await items[0].getType('image/png'); window.__copies = (window.__copies || 0) + 1; };
      });
      await o.go('#/outbox');
      assert.match(await o.text(), /الصورة منسوخة/);
      await o.click('[data-act=send]'); await o.waitForSelector('#waOpen', { timeout: 10000 });
      await o.closeDlg(); await o.waitForTimeout(300);
      assert.ok(!(await o.evaluate(() => db.invoices[0].waSent)), 'سكّر الشرح بلا ما يفتح المحادثة ← لازم تضل بالصندوق');
      await o.click('[data-act=send]'); await o.waitForSelector('#waOpen', { timeout: 10000 });
      await o.click('#waOpen'); await o.waitForTimeout(700);
      assert.deepStrictEqual(await o.evaluate(() => window.__opened), ['https://wa.me/963933123456']);
      assert.strictEqual(await o.evaluate(() => window.__copies), 2);
      assert.ok(await o.evaluate(() => db.invoices[0].waSent > 0));
      assert.match(await o.text(), /ما في رسائل بانتظار الإرسال/);
      assert.deepStrictEqual(o.errors, []);
    },
  },
  {
    name: 'صورة: إذا ما زبط نسخ الصورة (أو «ما زبط اللصق؟») بتطلع قائمة المشاركة — بلا ما تنفتح المحادثة مرتين',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await setup(p);
      await p.evaluate(() => {
        db.settings.waMode = 'img'; waSetDirect('c1', '963933123456');
        navigator.canShare = () => true;
        navigator.share = async data => { (window.__shared = window.__shared || []).push(data.files[0].name); };
        navigator.clipboard.write = async () => { throw new DOMException('denied', 'NotAllowedError'); };
      });
      await p.go('#/invoice/inv1'); await p.click('[data-act=wa]');
      await p.waitForFunction(() => (window.__shared || []).length === 1, null, { timeout: 10000 }); await p.waitForTimeout(200);
      assert.deepStrictEqual(await p.evaluate(() => window.__shared), ['invoice-4.png']);
      assert.strictEqual((await opened(p)).length, 0, 'ما لازم تنفتح المحادثة إذا الصورة ما انسخت');
      // النسخ زبط بس اللصق ما زبط على هالموبايل ← «ما زبط اللصق؟» بالشرح بيفتح قائمة المشاركة
      await p.evaluate(() => { navigator.clipboard.write = async items => { await items[0].getType('image/png'); }; });
      await p.click('[data-act=wa]'); await p.waitForSelector('#waShr', { timeout: 10000 }); await p.click('#waShr');
      await p.waitForFunction(() => (window.__shared || []).length === 2, null, { timeout: 10000 });
      assert.strictEqual((await opened(p)).length, 0);
      // زبون عام (بلا رقم): مشاركة دغري بلا نسخ
      await p.evaluate(() => { db.invoices.find(i => i.id === 'inv1').party = ensureWalkin().id; save(); window.__copied = 0; navigator.clipboard.write = async () => { window.__copied = 1; }; });
      await p.go('#/invoices'); await p.go('#/invoice/inv1'); await p.click('[data-act=wa]');
      await p.waitForFunction(() => (window.__shared || []).length === 3, null, { timeout: 10000 });
      assert.strictEqual(await p.evaluate(() => window.__copied), 0);
      assert.strictEqual((await opened(p)).length, 0);
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'صورة من قائمة المشاركة (موبايل ما بيقدر ينسخ صور): PNG عالية الجودة (عرض 1152) مع سطر تحتها',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await setup(p);
      await p.evaluate(() => {
        db.settings.waMode = 'img'; window.ClipboardItem = undefined;
        navigator.canShare = () => true;
        navigator.share = async data => { const f = data.files[0], bm = await createImageBitmap(f); (window.__shared = window.__shared || []).push({ name: f.name, type: f.type, size: f.size, w: bm.width, h: bm.height, text: data.text }); };
      });
      await p.go('#/invoice/inv1'); await p.click('[data-act=wa]');
      await p.waitForFunction(() => (window.__shared || []).length === 1, null, { timeout: 10000 });
      let sh = await p.evaluate(() => window.__shared);
      assert.strictEqual(sh[0].name, 'invoice-4.png'); assert.strictEqual(sh[0].type, 'image/png');
      assert.strictEqual(sh[0].w, 1152, 'العرض لازم يكون ضعف عرض الإيصال (دقة عالية)');
      assert.ok(sh[0].h > 1000 && sh[0].size > 20000, 'الصورة لازم تكون كاملة: ' + JSON.stringify(sh[0]));
      assert.match(sh[0].text, /فاتورة مبيع رقم 4 — 2,000/);
      assert.strictEqual(await p.evaluate(() => (window.__opened || []).length), 0, 'بوضع الصورة ما بينفتح رابط نص');
      // السند
      await p.go('#/vouchers'); await p.click('tr[data-id="vr1"]'); await p.waitForTimeout(150); await p.click('[data-act=share]'); await p.click('#vWa');
      await p.waitForFunction(() => (window.__shared || []).length === 2, null, { timeout: 10000 });
      sh = await p.evaluate(() => window.__shared);
      assert.strictEqual(sh[1].name, 'receipt-9.png'); assert.strictEqual(sh[1].w, 1152); assert.match(sh[1].text, /سند قبض رقم 9 — 1,500/);
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'صورة من قائمة المشاركة بصندوق المدير: بتنعلّم «انبعتت» بس إذا انبعتت فعلاً (مش إذا لغيت المشاركة)',
    fn: async base => {
      const o = await page(base, { cloud: OWNER });
      await o.evaluate(() => {
        db.settings.waMode = 'img';
        db.accounts.push({ id: 'c1', code: '112001', name: 'أحمد', type: 'asset', parent: 'customers', group: false, phone: '0933123456' });
        db.items.push({ id: 'it1', name: 'سكر', sellPrice: 1000, buyPrice: 900, openQty: 100 });
        db.invoices.push({ id: 'ri1', type: 'sale', no: 3, date: today(), pay: 'credit', cashAcc: '', party: 'c1', cur: 'base', rate: '', lines: [{ item: 'it1', qty: 2, price: 1000 }], discount: 0, rep: 'محمد', created: 1, waReq: Date.now() });
        save(); window.ClipboardItem = undefined;
        navigator.canShare = () => true;
        window.__cancel = true;
        navigator.share = async () => { if (window.__cancel) { const e = new Error('cancel'); e.name = 'AbortError'; throw e; } window.__ok = 1; };
      });
      await o.go('#/outbox'); await o.click('[data-act=send]'); await o.waitForTimeout(800);
      assert.ok(!(await o.evaluate(() => db.invoices[0].waSent)), 'لغيت المشاركة ← لازم تضل بالصندوق');
      await o.evaluate(() => { window.__cancel = false; });
      await o.click('[data-act=send]'); await o.waitForFunction(() => window.__ok === 1, null, { timeout: 10000 }); await o.waitForTimeout(600);
      assert.ok(await o.evaluate(() => db.invoices[0].waSent > 0));
      assert.match(await o.text(), /ما في رسائل بانتظار الإرسال/);
    },
  },
  {
    name: 'صورة على جهاز ما بيدعم مشاركة الصور: بتنزل الصورة وبتنفتح محادثة الزبون',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await setup(p);
      await p.evaluate(() => { db.settings.waMode = 'img'; window.ClipboardItem = undefined; navigator.canShare = undefined; waSetDirect('c1', '963933123456'); });
      const dl = p.waitForEvent('download', { timeout: 10000 });
      await p.go('#/invoice/inv1'); await p.click('[data-act=wa]');
      const d = await dl;
      assert.strictEqual(d.suggestedFilename(), 'invoice-4.png');
      await p.waitForTimeout(300);
      const o = await p.evaluate(() => window.__opened || []);
      assert.strictEqual(o.length, 1); assert.match(o[0], /^https:\/\/wa\.me\/963933123456\?text=/);
    },
  },
  {
    name: 'PDF: الفاتورة والسند بينبعتوا ملف PDF كامل (صفحة 80مم، وفيها صورة الإيصال بدقة عالية)',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await setup(p);
      await p.evaluate(() => {
        db.settings.waMode = 'pdf';
        navigator.canShare = () => true;
        navigator.share = async data => {
          const f = data.files[0], t = new TextDecoder('latin1').decode(new Uint8Array(await f.arrayBuffer()));
          (window.__shared = window.__shared || []).push({ name: f.name, type: f.type, size: f.size, head: t.slice(0, 8), tail: t.trimEnd().slice(-5),
            w: +(/\/Width (\d+)/.exec(t) || [])[1], box: (/\/MediaBox \[0 0 ([\d.]+)/.exec(t) || [])[1], text: data.text });
        };
      });
      await p.go('#/invoice/inv1'); await p.click('[data-act=wa]');
      await p.waitForFunction(() => (window.__shared || []).length === 1, null, { timeout: 10000 });
      let sh = (await p.evaluate(() => window.__shared))[0];
      assert.strictEqual(sh.name, 'invoice-4.pdf'); assert.strictEqual(sh.type, 'application/pdf');
      assert.strictEqual(sh.head, '%PDF-1.4'); assert.strictEqual(sh.tail, '%%EOF');
      assert.strictEqual(sh.w, 1152, 'الصورة جوّا الـ PDF لازم تكون بالدقة العالية');
      assert.strictEqual(Math.round(+sh.box), 227, 'الصفحة لازم تكون بعرض 80مم');
      assert.match(sh.text, /فاتورة مبيع رقم 4/);
      await p.go('#/vouchers'); await p.click('tr[data-id="vr1"]'); await p.waitForTimeout(150); await p.click('[data-act=share]'); await p.click('#vWa');
      await p.waitForFunction(() => (window.__shared || []).length === 2, null, { timeout: 10000 });
      sh = (await p.evaluate(() => window.__shared))[1];
      assert.strictEqual(sh.name, 'receipt-9.pdf'); assert.strictEqual(sh.head, '%PDF-1.4');
      assert.deepStrictEqual(p.errors, []);
    },
  },
  {
    name: 'الأساسي (بلا ما تختار شي بالإعدادات): نص بيروح دغري على رقم الزبون',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await setup(p);
      await p.evaluate(() => { delete db.settings.waMode; navigator.canShare = () => true; navigator.share = async () => { window.__shared = 1; }; waSetDirect('c1', '963933123456'); });
      await p.go('#/invoice/inv1'); await p.click('[data-act=wa]'); await p.waitForTimeout(400);
      const o = await opened(p);
      assert.strictEqual(o.length, 1); assert.match(o[0], /^https:\/\/wa\.me\/963933123456\?text=/); assert.match(o[0], /فاتورة مبيع رقم 4/);
      assert.ok(!(await p.evaluate(() => window.__shared)), 'ما لازم تنبعت صورة إذا ما اخترتها');
      await p.go('#/settings');
      assert.strictEqual(await p.inputValue('[name=waMode]'), 'text', 'بالإعدادات لازم يكون «نص» مختار');
    },
  },
  {
    name: '💵 دفعة من زبون: «حفظ وإرسال عالواتساب» بيحفظ الدفعة وبيبعتها دغري، والدفعة المحفوظة فيها زر «إرسال عالواتساب»',
    fn: async base => {
      const p = await page(base, { cloud: OWNER });
      await setup(p);
      const goWa = async () => { await p.waitForTimeout(250); if (await p.evaluate(() => document.getElementById('dlg').open && !!document.getElementById('waGo'))) { await p.click('#waGo'); await p.waitForTimeout(200); } };
      await p.go('#/voucher/new?type=receipt&mode=cust&acc=c1');
      await p.fill('[name=amount]', '2500'); await p.dispatchEvent('[name=amount]', 'input');
      await p.click('[data-act=saveWa]'); await goWa();
      const v = await p.evaluate(() => db.vouchers.filter(x => x.acc === 'c1' && x.amount === 2500).map(x => x.id));
      assert.strictEqual(v.length, 1, 'الدفعة لازم تنحفظ');
      let o = await opened(p);
      assert.strictEqual(o.length, 1); assert.match(o[0], /^https:\/\/wa\.me\/963933123456\?text=/); assert.match(o[0], /2,500/);
      assert.match(await p.evaluate(() => location.hash), new RegExp('#/voucher/' + v[0]));
      // من الدفعة المحفوظة
      assert.strictEqual(await p.locator('[data-act=saveWa]').count(), 0);
      await p.click('[data-act=wa]'); await goWa();
      o = await opened(p);
      assert.strictEqual(o.length, 2); assert.match(o[1], /2,500/);
      assert.deepStrictEqual(p.errors, []);
    },
  },
];
