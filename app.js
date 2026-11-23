'use strict';
/* =====================================================================
   دفتر — برنامج محاسبة بسيط يعمل في المتصفح (PWA)
   - كل البيانات محفوظة محلياً على الجهاز (localStorage)
   - القيود تتولّد تلقائياً من الفواتير والسندات (قيد مزدوج)
   - المخزون بطريقة الجرد المستمر وكلفة المتوسط المرجّح
   ===================================================================== */
const APP_NAME = 'دفتر';
const APP_VERSION = '6.55';

/* ------------------------- أدوات عامة ------------------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const AR_DIG = '٠١٢٣٤٥٦٧٨٩';
const num = v => {
  const n = parseFloat(String(v ?? '').replace(/[٠-٩]/g, d => AR_DIG.indexOf(d)).replace(/٫/g, '.').replace(/[,،\s]/g, ''));
  return isFinite(n) ? n : 0;
};
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const fmt = n => { const x = r2(n || 0); return (x === 0 ? 0 : x).toLocaleString('en-US', { maximumFractionDigits: 2 }); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isoLocal = d => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const today = () => isoLocal(new Date());
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return isoLocal(d); };
const byCode = (a, b) => String(a.code).localeCompare(String(b.code), 'en', { numeric: true });
const clone = o => JSON.parse(JSON.stringify(o));
const cur = () => db.settings.currency;
/* العملة القديمة (قبل حذف الصفرين): يُعرض المعادل بجانب المبالغ */
const oldOn = () => db.settings.showOld === '1';
const oldF = () => num(db.settings.oldFactor) || 100;
const oldAmt = base => fmt(base * oldF());
const oldTxt = base => (oldOn() && base ? `بالقديم: ${oldAmt(base)}` : '');
/* العملة الثانية (الدولار) وسعر الصرف */
const FX = () => ({ sym: db.settings.currency2 || '$', name: db.settings.currency2Name || 'دولار أمريكي', rate: num(db.settings.rate) });
const docRate = d => (d && d.cur === 'fx' ? num(d.rate) : 1);
const docSym = d => (d && d.cur === 'fx' ? FX().sym : cur());
const docCurName = d => (d && d.cur === 'fx' ? FX().name : db.settings.currencyName);
const curOpts = () => [['base', `${db.settings.currencyName} (${cur()})`], ['fx', `${FX().name} (${FX().sym})`]];
const fxNote = d => (d && d.cur === 'fx' ? ` (${fmt(d.amount ?? invTotals(d).net)} ${FX().sym} × ${fmt(d.rate)})` : '');

function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(t._t); t._t = setTimeout(() => (t.className = ''), 2800);
}

/* تفقيط: تحويل الرقم إلى كلمات عربية */
function tafqeet(value) {
  let n = Math.floor(Math.abs(value));
  const cents = Math.round((Math.abs(value) - n) * 100);
  const ones = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  const tens = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const hund = ['', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'];
  const three = x => {
    const h = Math.floor(x / 100), r = x % 100, p = [];
    if (h) p.push(hund[h]);
    if (r) { if (r < 20) p.push(ones[r]); else { const o = r % 10, t = Math.floor(r / 10); p.push(o ? ones[o] + ' و' + tens[t] : tens[t]); } }
    return p.join(' و');
  };
  const sc = [null, ['ألف', 'ألفان', 'آلاف', 'ألفاً'], ['مليون', 'مليونان', 'ملايين', 'مليوناً'], ['مليار', 'ملياران', 'مليارات', 'ملياراً']];
  if (n === 0) return 'صفر';
  const parts = []; let i = 0;
  while (n > 0 && i < 4) {
    const g = n % 1000;
    if (g) {
      let s;
      if (i === 0) s = three(g);
      else {
        const [one, two, few, many] = sc[i], r = g % 100;
        if (g === 1) s = one; else if (g === 2) s = two;
        else if (r >= 3 && r <= 10) s = three(g) + ' ' + few;
        else if (r >= 11) s = three(g) + ' ' + many;
        else s = three(g) + ' ' + one;
      }
      parts.unshift(s);
    }
    n = Math.floor(n / 1000); i++;
  }
  return parts.join(' و');
}
function moneyWords(value, doc) {
  const cents = Math.round((Math.abs(value) - Math.floor(Math.abs(value))) * 100);
  const sub = doc && doc.cur === 'fx' ? 'سنت' : 'قرش';
  return `فقط ${tafqeet(value)} ${docCurName(doc)}${cents ? ` و${tafqeet(cents)} ${sub}` : ''} لا غير`;
}

/* ------------------------- قاعدة البيانات ------------------------- */
const KEY = 'daftar-db-v1';
const ACC_TYPES = { asset: 'أصول', liability: 'خصوم', equity: 'حقوق ملكية', revenue: 'إيرادات', expense: 'مصاريف' };
const INV_TYPES = { sale: 'فاتورة مبيع', purchase: 'فاتورة شراء', saleReturn: 'مرتجع مبيع', purchaseReturn: 'مرتجع شراء' };
const DEBIT_NATURE = ['asset', 'expense'];

// [id, code, name, type, parent, group]
const DEF_ACCOUNTS = [
  ['assets', '1', 'الأصول', 'asset', null, 1],
  ['curAssets', '11', 'الأصول المتداولة', 'asset', 'assets', 1],
  ['cashGroup', '111', 'النقدية', 'asset', 'curAssets', 1],
  ['cash', '1111', 'الصندوق الرئيسي', 'asset', 'cashGroup'],
  ['bank', '1112', 'البنك', 'asset', 'cashGroup'],
  ['customers', '112', 'العملاء', 'asset', 'curAssets', 1],
  ['inventory', '113', 'المخزون', 'asset', 'curAssets'],
  ['fixedAssets', '12', 'الأصول الثابتة', 'asset', 'assets', 1],
  ['furniture', '121', 'الأثاث والتجهيزات', 'asset', 'fixedAssets'],
  ['liabilities', '2', 'الخصوم', 'liability', null, 1],
  ['suppliers', '21', 'الموردون', 'liability', 'liabilities', 1],
  ['loans', '22', 'القروض', 'liability', 'liabilities'],
  ['equity', '3', 'حقوق الملكية', 'equity', null, 1],
  ['capital', '31', 'رأس المال', 'equity', 'equity'],
  ['owner', '32', 'جاري الشريك', 'equity', 'equity'],
  ['revenue', '4', 'الإيرادات', 'revenue', null, 1],
  ['sales', '41', 'المبيعات', 'revenue', 'revenue'],
  ['otherRev', '42', 'إيرادات أخرى', 'revenue', 'revenue'],
  ['expenses', '5', 'المصاريف', 'expense', null, 1],
  ['cogs', '51', 'تكلفة البضاعة المباعة', 'expense', 'expenses'],
  ['salaries', '52', 'الرواتب والأجور', 'expense', 'expenses'],
  ['rent', '53', 'الإيجار', 'expense', 'expenses'],
  ['utilities', '54', 'كهرباء وماء واتصالات', 'expense', 'expenses'],
  ['general', '55', 'مصاريف عامة', 'expense', 'expenses'],
];

function seed() {
  return {
    version: 1,
    settings: { company: 'اسم المنشأة', address: '', phone: '', currency: 'ل.س', currencyName: 'ليرة سورية', currency2: '$', currency2Name: 'دولار أمريكي', rate: '', showOld: '1', oldFactor: 100, paperWidth: '80', receiptFooter: '', startDate: new Date().getFullYear() + '-01-01' },
    accounts: DEF_ACCOUNTS.map(([id, code, name, type, parent, group]) => ({ id, code, name, type, parent, group: !!group, sys: true })),
    items: [], groups: [], invoices: [], vouchers: [], entries: [], seq: {},
  };
}
function load() {
  try {
    const d = JSON.parse(window.Store ? Store.read() : localStorage.getItem(KEY));
    if (d && Array.isArray(d.accounts)) { const s = seed(); return { ...s, ...d, settings: { ...s.settings, ...d.settings } }; }
  } catch (e) { /* بيانات تالفة */ }
  return seed();
}
let db = load();
let _eng = null;
function save() {
  _eng = null;
  try { const j = JSON.stringify(db); if (window.Store) Store.write(j); else localStorage.setItem(KEY, j); }
  catch (e) { toast('تعذّر الحفظ: مساحة التخزين ممتلئة', 1); }
  $('#coName').textContent = db.settings.company;
  if (window.Cloud) Cloud.track();
}
const nextNo = k => (db.seq[k] = (db.seq[k] || 0) + 1);
// رقم مستند جديد: المحجوز من السيرفر (ما بيتكرر بين الأجهزة)، وإذا ما في (بلا نت) رقم محلي معلّم (nl) بيتصلّح إذا تكرر
const linkedCloud = () => !!(window.Cloud && Cloud.info().linked);
function newNo(k) {
  const n = window.Cloud && Cloud.take ? Cloud.take(k) : 0;
  if (n) { db.seq[k] = Math.max(num(db.seq[k]), n); return { no: n }; }
  const o = { no: nextNo(k) };
  if (linkedCloud()) { o.nl = 1; setTimeout(() => Cloud.reserve(k), 300); }
  return o;
}
const reserveNo = k => { if (window.Cloud && Cloud.reserve) Cloud.reserve(k); };

/* ------------------------- الحسابات ------------------------- */
const acc = id => db.accounts.find(a => a.id === id);
const accName = id => acc(id)?.name || '';
const children = id => db.accounts.filter(a => (a.parent ?? null) === (id ?? null)).sort(byCode);
const isGroup = a => !!a && (a.group || db.accounts.some(x => x.parent === a.id));
const isUnder = (id, root) => { let a = acc(id); while (a) { if (a.id === root) return true; a = acc(a.parent); } return false; };
const descendants = id => { const out = [id]; children(id).forEach(c => out.push(...descendants(c.id))); return out; };
const postable = () => db.accounts.filter(a => !isGroup(a)).sort(byCode);
const cashAccounts = () => postable().filter(a => isUnder(a.id, 'cashGroup'));
const customers = () => postable().filter(a => isUnder(a.id, 'customers'));
const suppliers = () => postable().filter(a => isUnder(a.id, 'suppliers'));
// «زبون عام»: زبون ثابت للبيع المباشر — دايماً نقدي وما بيصير عليه حساب (ما بيكون آجل أبداً)
const WALKIN_NAME = 'زبون عام';
const MAX_UP = 0.10; // أعلى زيادة مسموحة على سعر المبيع ببطاقة المادة
const AUTO_BUY = 0.80; // إذا نسيت سعر الشراء: سعر الشراء = سعر المبيع ناقص 20٪
// تكميل أسعار البطاقة الناقصة: سعر المبيع من سعر فاتورة الزبون، وسعر الشراء من سعر المبيع
// الفرق بين سعر الشراء وسعر المبيع ما بيزيد عن 20٪ من سعر المبيع (بالاتجاهين)
const MAX_GAP = 0.20;
const priceBad = (sell, buy) => num(sell) > 0 && num(buy) > 0 && Math.abs(num(sell) - num(buy)) > num(sell) * MAX_GAP + 0.001;
const priceBadMsg = (name, sell, buy) => `لازم تتعدّل الأسعار${name ? ': ' + name : ''} — سعر الشراء ${fmt(num(buy))} وسعر المبيع ${fmt(num(sell))}، والفرق بينهن لازم ما يزيد عن 20٪ (سعر الشراء بين ${fmt(r2(num(sell) * (1 - MAX_GAP)))} و ${fmt(r2(num(sell) * (1 + MAX_GAP)))})`;
function fillPrices(it, salePrice) {
  let ch = false;
  if (isSeller()) return ch; // المندوب ما بيعدّل بطاقات المواد
  if (!num(it.sellPrice) && num(salePrice) > 0) { it.sellPrice = r2(num(salePrice)); ch = true; }
  if (!num(it.buyPrice) && num(it.sellPrice) > 0) { it.buyPrice = r2(num(it.sellPrice) * AUTO_BUY); ch = true; }
  return ch;
}
const isWalkin = id => { const a = acc(id); return !!a && (a.walkin || a.id === 'walkin'); };
function ensureWalkin() {
  let a = customers().find(x => x.walkin || x.id === 'walkin')
    || customers().find(x => String(x.name || '').replace(/\s+/g, ' ').trim() === WALKIN_NAME);
  if (a) { if (!a.walkin) { a.walkin = true; save(); } return a; }
  const p = acc('customers'); if (!p) return null;
  a = { id: 'walkin', code: nextCode(p), name: WALKIN_NAME, type: p.type, parent: 'customers', group: false, walkin: true, phone: '', address: '', notes: 'زبون البيع المباشر — نقدي دائماً', aliases: [] };
  db.accounts.push(a); save();
  return a;
}
function treeOrder() { const out = []; const walk = (p, d) => children(p).forEach(a => { out.push({ a, d }); walk(a.id, d + 1); }); walk(null, 0); return out; }
function nextCode(p) {
  const kids = children(p.id);
  const w = kids.length ? Math.max(1, kids[0].code.length - p.code.length) : (['customers', 'suppliers'].includes(p.id) || p.code.length >= 3 ? 3 : 1);
  let max = 0;
  kids.forEach(k => { if (k.code.startsWith(p.code)) { const n = parseInt(k.code.slice(p.code.length), 10) || 0; if (n > max) max = n; } });
  return p.code + String(max + 1).padStart(w, '0');
}
function hasMoves(id) {
  return engine().entries.some(e => e.lines.some(l => l.acc === id))
    || db.invoices.some(i => i.party === id || i.cashAcc === id)
    || db.vouchers.some(v => v.acc === id || v.cashAcc === id);
}
const accOpts = (list, empty) => (empty ? [['', empty]] : []).concat(list.map(a => [a.id, a.code + ' - ' + a.name]));

/* ------------------------- محرك الترحيل -------------------------
   يبني كل القيود من: بضاعة أول المدة + الفواتير + السندات + القيود اليدوية
   ويحسب أرصدة المواد وكلفتها بالمتوسط المرجّح                         */
const invTotals = inv => {
  const gross = r2(inv.lines.reduce((s, l) => s + num(l.qty) * num(l.price), 0));
  const disc = r2(num(inv.discount)), add = r2(num(inv.addition));
  return { gross, disc, add, net: r2(gross - disc + add) };
};
function engine() {
  if (_eng) return _eng;
  const E = [], stock = {}, moves = [];
  const S = id => stock[id] || (stock[id] = { qty: 0, avg: 0 });
  const sd = db.settings.startDate;

  let openVal = 0;
  db.items.forEach(it => {
    const q = num(it.openQty), c = num(it.openCost), s = S(it.id);
    s.qty = q; s.avg = c;
    if (q) { moves.push({ item: it.id, date: sd, kind: 'open', label: 'رصيد أول المدة', in: q, out: 0, price: c, val: q * c, cost: q * c }); openVal += q * c; }
  });
  if (r2(openVal)) E.push({ id: 'open-stock', no: '—', date: sd, desc: 'بضاعة أول المدة', src: 'stock', lines: [{ acc: 'inventory', dr: r2(openVal), cr: 0 }, { acc: 'capital', dr: 0, cr: r2(openVal) }] });

  const invs = [...db.invoices].sort((a, b) => a.date.localeCompare(b.date) || (a.created || 0) - (b.created || 0));
  for (const inv of invs) {
    const { gross, net: netDoc } = invTotals(inv);
    const f = gross ? netDoc / gross : 1;
    const k = docRate(inv), net = netDoc * k;
    const party = inv.pay === 'cash' ? (inv.cashAcc || 'cash') : inv.party;
    const label = `${INV_TYPES[inv.type]} رقم ${inv.no}${repTag(inv)}`;
    const L = [];
    const add = (a, dr, cr) => { dr = r2(dr); cr = r2(cr); if (dr < 0) { cr -= dr; dr = 0; } if (cr < 0) { dr -= cr; cr = 0; } if (dr || cr) L.push({ acc: a, dr, cr }); };
    let cost = 0;
    for (const l of inv.lines) {
      const s = S(l.item), q = num(l.qty), val = q * num(l.price) * f * k;
      const mv = { item: l.item, date: inv.date, kind: inv.type, label, ref: inv.id, party: inv.party, in: 0, out: 0, price: num(l.price) * k, val, cost: 0 };
      if (inv.type === 'sale') { mv.cost = q * s.avg; s.qty -= q; mv.out = q; }
      else if (inv.type === 'saleReturn') { mv.cost = q * s.avg; s.qty += q; mv.in = q; }
      else if (inv.type === 'purchaseReturn') { mv.cost = q * s.avg; s.qty -= q; mv.out = q; }
      else if (inv.type === 'purchase') {
        const nq = s.qty + q;
        s.avg = (s.qty > 0 && nq > 0) ? (s.qty * s.avg + val) / nq : (q ? val / q : s.avg);
        s.qty = nq; mv.in = q; mv.cost = val;
      }
      cost += mv.cost; moves.push(mv);
    }
    if (inv.type === 'sale') { add(party, net, 0); add('sales', 0, net); add('cogs', cost, 0); add('inventory', 0, cost); }
    else if (inv.type === 'saleReturn') { add('sales', net, 0); add(party, 0, net); add('inventory', cost, 0); add('cogs', 0, cost); }
    else if (inv.type === 'purchase') { add('inventory', net, 0); add(party, 0, net); }
    else if (inv.type === 'purchaseReturn') { add(party, net, 0); add('inventory', 0, cost); add('cogs', 0, net - cost); }
    E.push({ id: 'inv-' + inv.id, no: inv.no, date: inv.date, desc: label + (inv.party ? ' — ' + accName(inv.party) : '') + fxNote(inv), src: 'invoice', ref: inv.id, lines: L });
  }

  for (const v of db.vouchers) {
    const amt = r2(num(v.amount) * docRate(v));
    const L = v.type === 'receipt'
      ? [{ acc: v.cashAcc, dr: amt, cr: 0 }, { acc: v.acc, dr: 0, cr: amt }]
      : [{ acc: v.acc, dr: amt, cr: 0 }, { acc: v.cashAcc, dr: 0, cr: amt }];
    E.push({ id: 'v-' + v.id, no: v.no, date: v.date, desc: `${v.type === 'receipt' ? 'سند قبض' : 'سند دفع'} رقم ${v.no} — ${accName(v.acc)}${v.note ? ' — ' + v.note : ''}${fxNote(v)}`, src: 'voucher', ref: v.id, lines: L });
  }
  db.entries.forEach(e => E.push({ ...e, src: 'manual' }));
  E.sort((a, b) => a.date.localeCompare(b.date));
  return (_eng = { entries: E, stock, moves });
}
function sums(from, to) {
  const m = {};
  for (const e of engine().entries) {
    if (from && e.date < from) continue;
    if (to && e.date > to) continue;
    for (const l of e.lines) { const x = m[l.acc] || (m[l.acc] = { dr: 0, cr: 0 }); x.dr += l.dr; x.cr += l.cr; }
  }
  return m;
}
function rollup(m) {
  const out = {};
  const calc = a => {
    if (out[a.id]) return out[a.id];
    const s = { dr: m[a.id]?.dr || 0, cr: m[a.id]?.cr || 0 };
    children(a.id).forEach(c => { const t = calc(c); s.dr += t.dr; s.cr += t.cr; });
    return (out[a.id] = s);
  };
  db.accounts.forEach(calc);
  return out;
}
const natural = (a, s) => { s = s || { dr: 0, cr: 0 }; return DEBIT_NATURE.includes(a.type) ? s.dr - s.cr : s.cr - s.dr; };
const balLabel = (a, b) => (DEBIT_NATURE.includes(a.type) ? (b >= 0 ? 'مدين' : 'دائن') : (b >= 0 ? 'دائن' : 'مدين'));

/* ------------------------- واتساب ------------------------- */
/* يحوّل رقم سوري محلي (09xxxxxxxx) إلى صيغة دولية 9639xxxxxxxx */
const waPhone = raw => {
  let d = String(raw || '').replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length >= 9 && d.length <= 11) d = '963' + d.slice(1);   // رقم محلي سوري
  else if (d.length === 9 && d.startsWith('9')) d = '963' + d;
  return d.length >= 9 ? d : '';
};
const partyBal = a => natural(a, rollup(sums())[a.id]);
const balWords = (a, b) => {
  if (!r2(b)) return '*الحساب مسدّد بالكامل* ✅';
  const isCust = a.type === 'asset';
  const owes = isCust ? b > 0 : b < 0;
  const m = Math.abs(b);
  let t = `*${fmt(m)} ${cur()} ${owes ? 'مستحقة عليكم' : 'لكم لدينا'}*`;
  if (oldOn()) t += `\n(بالقديم: ${oldAmt(m)})`;
  if (FX().rate) t += `\n(≈ ${fmt(m / FX().rate)} ${FX().sym})`;
  return t;
};
function waSend(a, text) {
  // شاشة تأكيد: لمين رح تنبعت، والرقم قابل للتعديل، أو اختيار المحادثة من واتساب نفسه
  const canPick = 'contacts' in navigator && 'ContactsManager' in window;
  modal('📤 إرسال على واتساب', `
    ${a ? `<p style="margin-top:0">إلى: <b>${esc(a.name)}</b></p>` : ''}
    <label class="fld"><span>رقم الواتساب${a ? ' (بينحفظ مع الحساب)' : ''}</span>
      <div style="display:flex;gap:6px"><input id="waPh" type="tel" inputmode="tel" dir="ltr" placeholder="09xxxxxxxx" value="${esc((a && a.phone) || '')}" style="flex:1">
      ${canPick ? '<button type="button" class="btn" id="waC" title="من جهات الاتصال">📇</button>' : ''}</div></label>
    <p class="muted" id="waHint" style="font-size:13px;margin:6px 0"></p>
    <div class="rc-ways">
      <button type="button" class="btn wa" id="waGo">✅ ابعت لهالرقم</button>
      <button type="button" class="btn" id="waAny">💬 اختار المحادثة من واتساب</button>
    </div>
    <details style="margin-top:10px"><summary class="muted" style="font-size:13px">شوف الرسالة</summary><pre style="white-space:pre-wrap;font:inherit;font-size:13px;background:#f7faf9;padding:8px;border-radius:8px">${esc(text)}</pre></details>`);
  const d = $('#dlg'), inp = $('#waPh', d), hint = $('#waHint', d);
  const upd = () => { const p = waPhone(inp.value); hint.textContent = inp.value.trim() ? (p ? '✓ الرقم: +' + p : '⚠️ الرقم مو صحيح') : 'ما في رقم — فيك تختار المحادثة من واتساب'; };
  inp.oninput = upd; upd();
  const c = $('#waC', d);
  if (c) c.onclick = async () => { try { const [r] = await navigator.contacts.select(['tel', 'name'], { multiple: false }); if (r && r.tel && r.tel[0]) { inp.value = r.tel[0]; upd(); } } catch (e) {} };
  $('#waGo', d).onclick = () => {
    const ph = waPhone(inp.value);
    if (!ph) { toast('الرقم مو صحيح', 1); inp.focus(); return; }
    if (a && inp.value.trim() !== (a.phone || '')) { a.phone = inp.value.trim(); save(); }
    d.close(); window.open(`https://wa.me/${ph}?text=${encodeURIComponent(text)}`, '_blank');
  };
  $('#waAny', d).onclick = () => { d.close(); window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank'); };
}
const waHead = () => `*${db.settings.company}*`;
function waBalanceText(a) {
  return `${waHead()}\nمرحباً ${a.name} 👋\nرصيد حسابكم بتاريخ ${today()}:\n${balWords(a, partyBal(a))}\nشكراً لتعاملكم معنا 🌹`;
}
function waStatementText(a, from, to, rows, open, bal) {
  const last = rows.slice(-15);
  const lines = last.map(({ e, l }) => `• ${e.date} | ${SRC[e.src]} ${e.no} | ${l.dr ? 'مدين ' + fmt(l.dr) : 'دائن ' + fmt(l.cr)}`).join('\n');
  return `${waHead()}\nكشف حساب: *${a.name}*\nمن ${from} إلى ${to}\n` +
    `الرصيد السابق: ${fmt(Math.abs(open))}\n` +
    (rows.length > last.length ? `(آخر ${last.length} حركة من ${rows.length})\n` : '') +
    (lines ? lines + '\n' : 'لا توجد حركات\n') +
    `————————\nالرصيد النهائي:\n${balWords(a, bal)}`;
}
function waInvoiceText(inv) {
  const t = invTotals(inv), sym = docSym(inv);
  const lines = inv.lines.map(l => { const it = db.items.find(x => x.id === l.item) || {}; return `• ${it.name || ''}: ${fmt(l.qty)} × ${fmt(l.price)} = ${fmt(num(l.qty) * num(l.price))}`; }).join('\n');
  const a = acc(inv.party);
  let s = `${waHead()}\n${INV_TYPES[inv.type]} رقم ${inv.no}${repTag(inv)}\nالتاريخ: ${inv.date}\n${a ? 'السيد: ' + a.name + '\n' : ''}————————\n${lines}\n————————\n`;
  if (t.disc || t.add) s += `الإجمالي: ${fmt(t.gross)}\n${t.disc ? `الحسم: ${fmt(t.disc)}\n` : ''}${t.add ? `إضافة: ${fmt(t.add)}${inv.addNote ? ' (' + inv.addNote + ')' : ''}\n` : ''}`;
  s += `*الصافي: ${fmt(t.net)} ${sym}*\n`;
  if (inv.cur === 'fx') s += `(المعادل: ${fmt(t.net * num(inv.rate))} ${cur()})\n`;
  else if (oldOn()) s += `(بالقديم: ${oldAmt(t.net)})\n`;
  s += `الدفع: ${inv.pay === 'cash' ? 'نقدي' : 'آجل'}\n`;
  if (a && !isSeller()) {
    const B = window.Receipt ? Receipt.balances(inv) : null;
    if (B) {
      const k = docRate(inv), netB = r2(t.net * k), sgn = ['sale', 'purchase'].includes(inv.type) ? 1 : -1;
      const paidB = inv.pay === 'cash' ? netB : db.vouchers.filter(v => v.inv === inv.id).reduce((x, v) => x + num(v.amount), 0);
      const o = x => (oldOn() ? ` (قديم ${oldAmt(x)})` : '');
      s += `————————\nالحساب القديم: ${fmt(B.before)}${o(B.before)}\nكامل الحساب: ${fmt(B.after + paidB * sgn)}${o(B.after + paidB * sgn)}\nالدفعة: ${fmt(paidB)}${o(paidB)}\n*رصيد الحساب الحالي: ${fmt(B.after)}*${o(B.after)}\n`;
    }
  }
  return s + 'شكراً لتعاملكم معنا 🌹';
}

/* ------------------------- واجهة: أدوات ------------------------- */
function field(f, v) {
  v = v ?? '';
  const req = f.req ? 'required' : '';
  let inp;
  if (f.t === 'select') inp = `<select name="${f.k}" ${req}>${f.opts.map(([a, b]) => `<option value="${esc(a)}" ${String(a) === String(v) ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select>`;
  else if (f.t === 'textarea') inp = `<textarea name="${f.k}" rows="2">${esc(v)}</textarea>`;
  else inp = `<input name="${f.k}" type="${f.t || 'text'}" value="${esc(v)}" ${f.t === 'number' ? 'step="any" inputmode="decimal"' : ''} ${f.ph ? `placeholder="${esc(f.ph)}"` : ''} ${req}>`;
  return `<label class="fld ${f.full ? 'full' : ''}"><span>${esc(f.l)}</span>${inp}</label>`;
}
const fields = (arr, vals = {}) => `<div class="grid2">${arr.map(f => field(f, vals[f.k])).join('')}</div>`;
const optsHtml = (opts, v) => opts.map(([a, b]) => `<option value="${esc(a)}" ${String(a) === String(v) ? 'selected' : ''}>${esc(b)}</option>`).join('');
const head = (title, actions = '') => `<div class="ph"><h1>${title}</h1><div class="acts">${actions}</div></div>`;
const kpi = (l, v, c = '') => `<div class="kpi ${c}"><span>${l}</span><b>${v}</b></div>`;
const table = (heads, rows, foot = '', cls = '') => `<div class="tbl"><table class="${cls}"><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${heads.length}" class="empty">لا توجد بيانات</td></tr>`}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ''}</table></div>`;

function modal(title, body, { onSave, saveText = 'حفظ', extra = '' } = {}) {
  const d = $('#dlg');
  d.innerHTML = `<form class="dlg-form" novalidate><header><h3>${esc(title)}</h3><button type="button" class="x" data-close>✕</button></header>
    <div class="dlg-body">${body}</div>
    <footer>${onSave ? `<button class="btn pri">${saveText}</button>` : ''}${extra}<button type="button" class="btn" data-close>إغلاق</button></footer></form>`;
  const f = $('form', d);
  f.onsubmit = e => {
    e.preventDefault();
    if (!f.checkValidity()) { f.reportValidity(); return; }
    if (onSave && onSave(Object.fromEntries(new FormData(f)), f) !== false) d.close();
  };
  $$('[data-close]', d).forEach(b => (b.onclick = () => d.close()));
  d.showModal();
  return f;
}
function onAct(view, map) {
  view.onclick = e => {
    const b = e.target.closest('[data-act]');
    if (!b || !view.contains(b)) return;
    const fn = map[b.dataset.act];
    if (fn) { e.preventDefault(); fn(b.dataset.id, b, e); }
  };
}
function printDoc(html) {
  const s = db.settings;
  $('#print').innerHTML = `<div class="pdoc"><div class="phead"><div><h2>${esc(s.company)}</h2><div>${esc(s.address)}</div><div>${esc(s.phone)}</div></div><div>تاريخ الطباعة: ${today()}</div></div>${html}</div>`;
  window.print();
}

/* ------------------------- الموجّه ------------------------- */
const V = {};
const NAV_MAP = { invoice: 'invoices', entry: 'journal', report: 'reports' };
/* ------------------------- وضع البيّاع (لهالموبايل بس) ------------------------- */
// محفوظ عالجهاز (مش بالمزامنة) — هيك بيتفعّل على موبايل الشب بس
// «وضع البيّاع» القديم (بالرمز السري) انشال: الموبايل يلي كان عليه بيصير موبايل نقطة بيع (بالباركود والتفعيل)
try {
  const old = JSON.parse(localStorage.getItem('daftar_seller') || 'null');
  if (old) {
    const cs = JSON.parse(localStorage.getItem('daftar-cloud-v1') || '{}');
    if (!(cs.session && cs.company && cs.owner)) { // موبايل المدير ما منقفله
      localStorage.setItem('daftar_pos_device', '1');
      if (old.name && !localStorage.getItem('daftar_rep_name')) localStorage.setItem('daftar_rep_name', old.name);
    }
    localStorage.removeItem('daftar_seller');
  }
} catch (e) { /* */ }
// وضع البيّاع: إما متفعّل يدوي عالموبايل، أو تلقائي لأي حساب عضو بالشركة مش صاحبها (المندوب)
const autoSeller = () => !!(window.Cloud && Cloud.info && Cloud.info().member);
const isSeller = () => autoSeller();
const REP_KEY = 'daftar_rep_name';
const repName = () => { try { return localStorage.getItem(REP_KEY) || ''; } catch (e) { return ''; } };
const myRep = () => (isSeller() && (repName() || (window.Cloud && Cloud.info().email) || 'مندوب')) || '';
const repTag = i => (i && i.rep ? ` — مندوب: ${i.rep}` : '');
// صندوق خاص لكل مندوب (بينعمل عند المدير لما يفعّل موبايله، وبيوصل للمندوب بالمزامنة)
const myBox = () => { const n = myRep(); return n ? db.accounts.find(a => a.repBox === n) : null; };
function ensureRepBox(name) {
  name = String(name || '').trim(); const p = acc('cashGroup');
  if (!name || !p || isSeller() || db.accounts.some(a => a.repBox === name)) return false;
  db.accounts.push({ id: 'repbox_' + uid(), code: nextCode(p), name: 'صندوق المندوب: ' + name, type: p.type, parent: 'cashGroup', group: false, repBox: name });
  save(); return true;
}
// أي مندوب إله فواتير أو سندات: منعمله صندوق (للمندوبين يلي انضافوا قبل ميزة الصندوق)
function ensureAllRepBoxes() {
  if (isSeller() || !acc('cashGroup')) return;
  [...new Set([...db.invoices, ...db.vouchers].map(x => x.rep).filter(Boolean))].forEach(n => ensureRepBox(n));
}
function repBoxDialog() {
  modal('💰 صندوق لمندوب', '<p class="muted">اكتب اسم المندوب <b>متل ما بيطلع على فواتيره</b> بالضبط.</p>' + fields([{ k: 'name', l: 'اسم المندوب', req: 1, full: 1 }]), {
    saveText: 'اعمل الصندوق',
    onSave: d => { const n = String(d.name || '').trim(); if (!n) return false; if (!ensureRepBox(n)) { toast('في صندوق لهالمندوب من قبل', 1); return false; } toast('✓ انعمل صندوق ' + n); route(); },
  });
}
const NO_BOX = '💰 صندوقك لسا ما وصل — اكبس 🔄 مزامنة. إذا ضل، خلّي المدير يفتح الإعدادات عنده';
const SELLER_ROUTES = ['home', 'invoices', 'invoice', 'vouchers'];
// موبايل انفتح من رابط/باركود نقطة البيع: بينقفل عليها من أول فتحة (حتى قبل تسجيل الدخول)
const POS_DEV_KEY = 'daftar_pos_device';
// قفل البرنامج: الدفتر الكامل بيفتح بس على موبايل مسجّل دخول بحساب المدير وفاتح الشركة — غير هيك شاشة دخول بس
const needLogin = () => { if (!window.Cloud || isSeller() || posDevice()) return false; const i = Cloud.info(); return !!i.configured && !i.owner; };
const posDevice = () => { try { return localStorage.getItem(POS_DEV_KEY) === '1'; } catch (e) { return false; } };
function applySellerUI() {
  const on = isSeller();
  document.body.classList.toggle('seller', on || posDevice());
  document.body.classList.toggle('locked', needLogin());
  // موبايل المندوب: بيبيّن «نقطة البيع» بس، بلا اسم دفتر ولا قائمة
  const tt = document.getElementById('topTitle');
  if (on || posDevice()) { if (tt) tt.textContent = '🧑‍💼 نقطة البيع'; document.title = 'نقطة البيع' + (myRep() ? ' — ' + myRep() : ''); }
  else { if (tt) tt.textContent = 'دفتر'; document.title = 'دفتر'; }
  const b = document.getElementById('sellerExit'); if (b) b.remove();
}

// مساحة التخزين على هالموبايل: بيانات البرنامج، والمستعمل من المسموح
const mbTxt = b => (b >= 1e9 ? fmt(r2(b / 1e9)) + ' غيغا' : b >= 1e6 ? fmt(r2(b / 1e6)) + ' ميغا' : fmt(Math.max(1, Math.round(b / 1e3))) + ' كيلو');
async function storeUseCard(el) {
  if (!el) return;
  const data = new Blob([JSON.stringify(db)]).size;
  const u = window.Store ? await Store.usage() : null, idb = window.Store && Store.info().idb;
  if (!el.isConnected) return;
  const quota = u && u.quota ? u.quota : (idb ? 0 : 5e6), used = u && u.used ? Math.max(u.used, data) : data;
  const pct = quota ? Math.min(100, used / quota * 100) : 0;
  el.innerHTML = `<p><b>💾 مساحة التخزين على هالموبايل</b></p>
    <div class="su-bar"><i style="width:${Math.max(pct, 0.5).toFixed(2)}%"></i></div>
    <p class="muted" style="margin:6px 0 0">بيانات البرنامج: <b>${mbTxt(data)}</b> (${db.invoices.length} فاتورة، ${db.vouchers.length} سند، ${db.items.length} مادة)<br>
    المستعمل: <b>${mbTxt(used)}</b>${quota ? ` من <b>${mbTxt(quota)}</b> مسموحة (${pct < 0.01 ? 'أقل من 0.01' : fmt(r2(pct))}٪)` : ''}<br>
    ${idb ? '✅ التخزين: IndexedDB (مساحة كبيرة)' : '⚠️ التخزين: القديم (localStorage — حوالي 5 ميغا بس)'}</p>`;
}

/* ---- باركود نقطة البيع: بينطبع وبيتصوّر بكاميرا موبايل المندوب، بيفتح نقطة البيع بس ---- */
function posQR() {
  modal('📷 باركود نقطة البيع', '<p class="muted">اكتب اسم المندوب — بيطلع على فواتيره.</p>' + fields([{ k: 'name', l: 'اسم المندوب', req: 1, full: 1, ph: 'محمد' }]), {
    saveText: 'اعمل الباركود',
    onSave: d => { const n = String(d.name || '').trim(); if (!n) return false; setTimeout(() => posQRShow(n), 0); },
  });
}
function posQRShow(name) {
  if (typeof qrcode !== 'function') return toast('مكتبة الباركود ما تحمّلت — حدّث الصفحة', 1);
  const info = window.Cloud ? Cloud.info() : {};
  if (!info.linked || info.member) return toast('لازم تكون مسجّل دخول بحساب المدير وفاتح الشركة (الإعدادات ← المزامنة السحابية)', 1);
  // الباركود ما فيه أي مفتاح: بس رقم الشركة واسم المندوب. الدخول ما بيصير إلا لما المدير يفعّل
  const url = location.origin + location.pathname + '#/pos?name=' + encodeURIComponent(name) + '&c=' + encodeURIComponent(info.company);
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
  const svg = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
  const box = `<div style="background:#fff;padding:10px;border-radius:12px;max-width:300px;margin:0 auto">${svg}</div>`;
  const f = modal('📷 باركود نقطة البيع — ' + name, `${box}
    <p class="muted" style="margin-top:12px">1. المندوب بيصوّر الباركود بكاميرا موبايله ← بيطلعله «بانتظار تفعيل المدير».<br>2. على موبايلك بيطلع شريط فوق: <b>📲 موبايل «${esc(name)}» بدو يفتح نقطة البيع</b> ← اكبس <b>✓ تفعيل</b>.<br>3. موبايل المندوب بيفتح نقطة البيع لحاله — بلا إيميل ولا كلمة سر.</p>
    <p class="muted">🔒 إذا حدا غريب صوّر الباركود ما بيفوت إلا إذا إنت فعّلته.</p>`,
    { extra: '<button type="button" class="btn pri" id="qrPrint">🖨 طباعة</button>' });
  $('#qrPrint', f).onclick = () => { $('#dlg').close(); printDoc(`<h3 class="ptitle">باركود نقطة البيع — ${esc(name)}</h3><div style="width:260px;margin:20px auto">${svg}</div><p style="text-align:center">صوّر الباركود بكاميرا الموبايل لفتح نقطة البيع</p>`); };
}
// قائمة موبايلات نقطة البيع بالإعدادات (للمدير)
async function posDevsCard(el) {
  if (!el || !window.Cloud) return;
  const info = Cloud.info(); if (!info.linked || info.member) { el.innerHTML = ''; return; }
  let list; try { list = await Cloud.posList(); } catch (e) { el.innerHTML = `<p class="bad">${esc(e.message)}</p>`; return; }
  if (!list.length) { el.innerHTML = '<p class="muted">ما في ولا موبايل نقطة بيع لسا.</p>'; return; }
  list.filter(r => r.approved).forEach(r => ensureRepBox(r.name)); // صندوق لكل مندوب مفعّل
  el.innerHTML = '<p><b>📱 موبايلات نقطة البيع</b></p>' + list.map(r => `<div class="acts" style="align-items:center;margin-bottom:6px"><span>${r.approved ? '🟢' : '⏳'} ${esc(r.name || 'مندوب')}${r.approved ? '' : ' — <small class="muted">بانتظار التفعيل</small>'}</span>
    ${r.approved ? '' : `<button class="btn pri" data-pa="ok" data-u="${r.user_id}">✓ تفعيل</button>`}<button class="btn red" data-pa="no" data-u="${r.user_id}">${r.approved ? '⛔ إيقاف' : '✕ رفض'}</button></div>`).join('');
  el.onclick = async e => {
    const b = e.target.closest('[data-pa]'); if (!b) return;
    if (b.dataset.pa === 'no' && !confirm('أكيد؟ هالموبايل ما عاد يقدر يفتح نقطة البيع.')) return;
    b.disabled = true;
    try { if (b.dataset.pa === 'ok') { await Cloud.posApprove(b.dataset.u); ensureRepBox((list.find(r => r.user_id === b.dataset.u) || {}).name); toast('✓ تفعّلت'); } else { await Cloud.posRevoke(b.dataset.u); toast('✓ توقّفت'); } }
    catch (err) { toast(err.message, 1); }
    Cloud.posNotify(); posDevsCard(el);
  };
}

let keepScrollY = null;
function go(h) { if (location.hash === h) route(); else location.hash = h; }
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const [name, id] = path.split('/');
  const q = Object.fromEntries(new URLSearchParams(qs || ''));
  const view = $('#view');
  view.onclick = view.oninput = view.onchange = view.onsubmit = null;
  view.classList.remove('typing');
  { const tc = $('#topCnt'); if (tc) tc.hidden = true; }
  let key = V[name] ? name : 'home';
  // لسا السحابة ما تحمّلت: ما منفرجي شي لحتى نعرف إذا الموبايل مسموحله (ما في وميض للدفتر)
  if (!window.Cloud && window.DAFTAR_CLOUD && window.DAFTAR_CLOUD.url) { view.innerHTML = '<p class="muted" style="text-align:center;margin-top:40px">⏳</p>'; return; }
  if (isSeller()) {
    const bad = !SELLER_ROUTES.includes(key)
      || (key === 'invoice' && (id === 'new' ? (q.type || 'sale') !== 'sale' : (() => { const iv = db.invoices.find(x => x.id === id); return !iv || iv.type !== 'sale' || iv.rep !== myRep(); })()));
    if (bad) { if (location.hash && location.hash !== '#/') { toast('🔒 هالصفحة مسكّرة بوضع البيّاع', 1); } history.replaceState(null, '', '#/'); key = 'home'; }
  } else if (needLogin() && key !== 'pos' && key !== 'sellersetup') {
    key = 'lock';
  } else if (posDevice() && key !== 'pos' && key !== 'sellersetup') {
    // موبايل نقطة بيع لسا ما سجّل دخول المندوب: ما بيشوف دفتر أبداً، بس صفحة التجهيز
    history.replaceState(null, '', '#/pos'); key = 'pos';
  }
  const nav = NAV_MAP[key] || key;
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === nav));
  document.body.classList.remove('menu-open');
  V[key](id, q, view);
  // بعد «حفظ» منضل بنفس المكان بالصفحة؛ غير هيك منطلع لفوق
  if (keepScrollY != null) { const y = keepScrollY; keepScrollY = null; window.scrollTo(0, y); requestAnimationFrame(() => window.scrollTo(0, y)); }
  else window.scrollTo(0, 0);
}

/* ---- بحث بقائمة الزباين/الموردين: خانة بحث فوق كل قائمة «العميل/المورد» ---- */
function enhancePartySelect(sel) {
  if (sel.dataset.sx) return;
  sel.dataset.sx = '1';
  const box = document.createElement('div'); box.className = 'sx';
  box.innerHTML = '<input class="sx-in" type="search" placeholder="🔎 ابحث عن الاسم أو الهاتف" autocomplete="off" enterkeyhint="search"><div class="sx-list" hidden></div>';
  sel.parentNode.insertBefore(box, sel);
  const inp = box.firstChild, list = box.lastChild;
  let res = [];
  const choose = o => {
    sel.value = o.value;
    sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true }));
    inp.value = ''; list.hidden = true; inp.blur(); toast('✓ ' + o.text);
  };
  const show = () => {
    const qn = normAr(inp.value); if (!qn) { list.hidden = true; return; }
    const ws = qn.split(/\s+/);
    res = [...sel.options].filter(o => o.value).map(o => {
      const a = acc(o.value) || {}, hay = normAr(o.text + ' ' + (a.phone || '') + ' ' + (a.code || ''));
      if (!ws.every(w => hay.includes(w))) return null;
      return [normAr(a.name || o.text).startsWith(qn) ? 0 : 1, o];
    }).filter(Boolean).sort((x, y) => x[0] - y[0]).slice(0, 30).map(x => x[1]);
    const exact = res.some(o => normAr(acc(o.value)?.name || '') === qn);
    list.innerHTML = res.map((o, i) => `<button type="button" data-i="${i}">${esc(o.text)}${acc(o.value)?.phone ? ` <small>${esc(acc(o.value).phone)}</small>` : ''}</button>`).join('')
      + (exact ? '' : `<button type="button" class="sx-add" data-add="1">➕ إضافة «${esc(inp.value.trim())}» ك${kindOf() === 'suppliers' ? 'مورد' : 'زبون'} جديد</button>`);
    list.hidden = false;
  };
  inp.addEventListener('input', show);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (res[0]) choose(res[0]); else if (inp.value.trim()) addNew(); } });
  inp.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 150));
  list.addEventListener('mousedown', e => e.preventDefault());
  // زبون/مورد جديد من نفس المكان
  const kindOf = () => sel.dataset.kind || ([...sel.options].some(o => o.value && isUnder(o.value, 'suppliers')) ? 'suppliers' : 'customers');
  const addNew = () => {
    const name = inp.value.trim(); if (!name) return;
    const parent = kindOf(), p = acc(parent); if (!p) return toast('ما لقيت حساب ' + (parent === 'suppliers' ? 'الموردين' : 'العملاء'), 1);
    const na = { id: uid(), code: nextCode(p), name, type: p.type, parent, group: false, phone: '', address: '', notes: '', aliases: [] };
    db.accounts.push(na); save();
    const o = new Option(na.code + ' - ' + na.name, na.id); sel.add(o);
    choose(o); toast(`✅ انضاف ${parent === 'suppliers' ? 'المورد' : 'الزبون'}: ${name}`);
  };
  list.addEventListener('click', e => {
    if (e.target.closest('[data-add]')) return addNew();
    const b = e.target.closest('button[data-i]'); if (b) choose(res[+b.dataset.i]);
  });
}
new MutationObserver(() => document.querySelectorAll('select[name=party]:not([data-sx])').forEach(enhancePartySelect))
  .observe(document.body, { childList: true, subtree: true });

/* ------------------------- نسخة احتياطية (للدرايف) ------------------------- */
const BK_KEY = 'daftar_last_backup';
const lastBackup = () => { try { return +localStorage.getItem(BK_KEY) || 0; } catch (e) { return 0; } };
const loadXlsx = () => window.XLSX ? Promise.resolve() : new Promise((ok, bad) => {
  const sc = document.createElement('script'); sc.src = 'lib/xlsx.full.min.js'; sc.onload = ok; sc.onerror = () => bad(new Error('ما قدر يحمّل مكتبة Excel')); document.head.appendChild(sc);
});
// كروم عالموبايل بيرفض يشارك ملفات .json و .xlsx («Permission denied») — فمنشارك أنواع مسموحة:
// النسخة الكاملة كـ .txt (منها بترجّع كل شي) + جداول CSV بتنفتح بالإكسل وGoogle Sheets
const toCsv = rows => {
  if (!rows.length) return '\ufeff';
  const cols = Object.keys(rows[0]), q = v => { const t = String(v ?? ''); return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  return '\ufeff' + [cols.map(q).join(','), ...rows.map(r => cols.map(c => q(r[c])).join(','))].join('\r\n');
};
function backupData() {
  const R = rollup(sums()), st = engine().stock, bal = a => r2(natural(a, R[a.id]));
  const partyRows = list => list.map(a => ({ 'الرمز': a.code, 'الاسم': a.name, 'الهاتف': a.phone || '', 'العنوان': a.address || '', 'الرصيد': bal(a) }));
  const items = [...db.items].sort(byCode).map(it => ({ 'الرمز': it.code || '', 'اسم المادة': it.name, 'الباركود': it.barcode || '', 'الوحدة': it.unit || '', 'المجموعة': it.group || '', 'سعر الشراء': num(it.buyPrice), 'سعر المبيع': num(it.sellPrice), 'سعر المستهلك': num(it.consumerPrice), 'الكمية الحالية': r2(st[it.id]?.qty || 0) }));
  const invs = [...db.invoices].sort((a, b) => (a.date < b.date ? 1 : -1)).map(i => ({ 'النوع': INV_TYPES[i.type] || i.type, 'الرقم': i.no, 'التاريخ': i.date, 'الطرف': i.party ? accName(i.party) : '', 'الدفع': i.pay === 'cash' ? 'نقدي' : 'آجل', 'الصافي': invTotals(i).net, 'عدد المواد': i.lines.length, 'ملاحظة': i.note || '' }));
  const lines = []; db.invoices.forEach(i => i.lines.forEach(l => lines.push({ 'التاريخ': i.date, 'النوع': INV_TYPES[i.type] || i.type, 'رقم الفاتورة': i.no, 'الطرف': i.party ? accName(i.party) : '', 'المادة': db.items.find(x => x.id === l.item)?.name || '', 'الكمية': num(l.qty), 'السعر': num(l.price), 'المجموع': r2(num(l.qty) * num(l.price)) })));
  return { 'الزباين': partyRows(customers()), 'الموردين': partyRows(suppliers()), 'المواد': items, 'الفواتير': invs, 'تفاصيل الفواتير': lines };
}
/* ---- النسخة الاحتياطية الأوتوماتيكية: كل يوم نسخة على هالموبايل (آخر 7 أيام)، وبترجعلها بكبسة ---- */
const AUTO_DAYS = 7;
const bkOk = () => !!(window.Store && Store.info().idb) && !isSeller();
async function autoBackup(force) {
  if (!bkOk()) return;
  try {
    const key = 'bak:' + today(), have = await Store.keys('bak:');
    if (!have.includes(key) || force) await Store.put(key, JSON.stringify({ at: Date.now(), db }));
    const days = (await Store.keys('bak:')).filter(k => /^bak:\d{4}-\d\d-\d\d$/.test(k)).sort().reverse();
    for (const k of days.slice(AUTO_DAYS)) await Store.del(k);
  } catch (e) { /* ما منوقّف البرنامج إذا ما زبطت النسخة */ }
}
async function autoBackupList() {
  if (!bkOk()) return [];
  const ks = (await Store.keys('bak:')).sort().reverse();
  const out = [];
  for (const k of ks) {
    const raw = await Store.get(k); if (!raw) continue;
    let o = null; try { o = JSON.parse(raw); } catch (e) { continue; }
    out.push({ k, at: o.at, size: raw.length, inv: (o.db.invoices || []).length, vch: (o.db.vouchers || []).length, items: (o.db.items || []).length, raw });
  }
  return out;
}
async function autoBackupCard(el) {
  if (!el) return;
  if (!bkOk()) { el.innerHTML = window.Store && !Store.info().idb ? '<p class="muted">النسخ الأوتوماتيكية بتحتاج تخزين IndexedDB، وهالموبايل ما بيدعمه.</p>' : ''; return; }
  const list = await autoBackupList(); if (!el.isConnected) return;
  const row = b => {
    const t = new Date(b.at), when = b.k === 'bak:pre' ? '↩️ قبل آخر رجوع' : '📅 ' + b.k.slice(4) + ' ' + t.toTimeString().slice(0, 5);
    return `<div class="bk-row"><div><b>${when}</b><br><small class="muted">${b.inv} فاتورة، ${b.vch} سند، ${b.items} مادة — ${mbTxt(b.size)}</small></div>
      <div class="acts"><button class="btn" data-bk="back" data-k="${b.k}">↩️ رجوع</button><button class="btn" data-bk="dl" data-k="${b.k}">⬇️</button></div></div>`;
  };
  el.innerHTML = `<p style="margin-top:12px"><b>🗓 النسخ الأوتوماتيكية على هالموبايل</b> <small class="muted">(نسخة كل يوم، آخر ${AUTO_DAYS} أيام)</small></p>` +
    (list.length ? list.map(row).join('') : '<p class="muted">لسا ما في — أول نسخة بتنعمل هلق.</p>');
  el.onclick = async e => {
    const b = e.target.closest('[data-bk]'); if (!b) return;
    const it = list.find(x => x.k === b.dataset.k); if (!it) return;
    if (b.dataset.bk === 'dl') {
      const f = new File([it.raw.length ? JSON.stringify(JSON.parse(it.raw).db, null, 1) : ''], `دفتر-نسخة-${it.k.slice(4)}.json`, { type: 'application/json' });
      const u = URL.createObjectURL(f), a = document.createElement('a'); a.href = u; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 3000);
      return;
    }
    const label = it.k === 'bak:pre' ? 'الحالة يلي كانت قبل آخر رجوع' : 'يوم ' + it.k.slice(4);
    if (!confirm(`رح يرجع كل شي متل ما كان ${label}:\n${it.inv} فاتورة، ${it.vch} سند، ${it.items} مادة.\n\nأي شي انعمل بعدها رح ينمسح — كمان من السحابة وموبايلات المندوبين.\n(الحالة الحالية بتنحفظ أول، وفيك ترجعلها)\n\nمتابعة؟`)) return;
    b.disabled = true;
    try {
      if (it.k !== 'bak:pre') await Store.put('bak:pre', JSON.stringify({ at: Date.now(), db }));
      const d = JSON.parse(it.raw).db, sd = seed();
      db = { ...sd, ...d, settings: { ...sd.settings, ...d.settings } }; save();
      toast('✓ رجعت البيانات ل' + label); go('#/');
    } catch (err) { toast('ما زبط الرجوع: ' + (err && err.message || err), 1); b.disabled = false; }
  };
}
// كل ما ينفتح البرنامج أو يرجع للواجهة: إذا اليوم لسا ما انعملت نسخة منعملها
setTimeout(() => autoBackup(), 4000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(() => autoBackup(), 2000); });

function backupShare() {
  const stamp = today(), data = backupData();
  const full = new File([JSON.stringify(db, null, 1)], `دفتر-نسخة-كاملة-${stamp}.txt`, { type: 'text/plain' });
  const csvs = Object.entries(data).map(([n, rows]) => new File([toCsv(rows)], `دفتر-${n}-${stamp}.csv`, { type: 'text/csv' }));
  const files = [full, ...csvs];
  const done = msg => { try { localStorage.setItem(BK_KEY, String(Date.now())); } catch (e) { /* */ } toast(msg); if (/^#?\/?$/.test(location.hash)) route(); };
  const download = async () => {
    // بديل: تنزيل الملفات عالموبايل (النسخة الكاملة + ملف إكسل واحد فيه كل الجداول)
    const out = [new File([full], `دفتر-نسخة-كاملة-${stamp}.json`, { type: 'application/json' })];
    try {
      await loadXlsx();
      const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
      Object.entries(data).forEach(([n, rows]) => { const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ '': 'لا توجد بيانات' }]); ws['!views'] = [{ RTL: true }]; XLSX.utils.book_append_sheet(wb, ws, n); });
      out.push(new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], `دفتر-${stamp}.xlsx`));
    } catch (e) { out.push(...csvs); }
    out.forEach((f, k) => setTimeout(() => { const u = URL.createObjectURL(f), a = document.createElement('a'); a.href = u; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 3000); }, k * 500));
    done('✓ نزلت ملفات النسخة الاحتياطية بالتنزيلات — ارفعها عالدرايف');
  };
  // المشاركة لازم تبلّش فوراً بعد الكبسة (بلا انتظار) وإلا كروم بيرفض
  if (navigator.share && navigator.canShare && navigator.canShare({ files })) {
    navigator.share({ files, title: 'نسخة احتياطية — دفتر' })
      .then(() => done('✓ انحفظت النسخة الاحتياطية'))
      .catch(e => { if (e && e.name === 'AbortError') return; download(); });
    return;
  }
  download();
}

/* ------------------------- صفحة تجهيز موبايل المندوب (من الباركود الخاص فيه) ------------------------- */
V.pos = V.sellersetup = (id, q, view) => {
  const name = (q.name || '').trim();
  if (name) try { localStorage.setItem(REP_KEY, name); } catch (e) { /* */ }
  const info = window.Cloud ? Cloud.info() : {};
  if (info.member) return go('#/'); // حساب المندوب: دغري نقطة البيع
  // باركود نقطة البيع (أو موبايل بعت طلب من قبل): منبعت طلب تفعيل ومنستنى المدير
  const company = q.c || (info.posReq && info.posReq.company);
  if (company && window.Cloud && !(info.linked && !info.member)) {
    try { localStorage.setItem(POS_DEV_KEY, '1'); } catch (e) { /* */ }
    applySellerUI();
    const repN = name || (info.posReq && info.posReq.name) || repName() || 'مندوب';
    if (q.c) history.replaceState(null, '', '#/pos');
    const show = (html) => { if (/^#\/(pos|sellersetup)/.test(location.hash)) view.innerHTML = head(`🧑‍💼 نقطة البيع — ${esc(repN)}`) + `<div class="card" style="text-align:center">${html}</div>`; };
    const waitHtml = `<p style="font-size:42px;margin:6px 0">⏳</p><p><b>بانتظار تفعيل المدير</b></p><p class="muted">خلّي المدير يكبس «✓ تفعيل» من موبايله.<br>أول ما يفعّل بتفتح نقطة البيع لحالها.</p><div class="acts" style="justify-content:center"><button class="btn pri" id="posChk">🔄 تحقّق هلق</button></div>`;
    const check = async () => {
      try {
        if (!Cloud.info().posReq || q.c) { await Cloud.posJoin(company, repN); q.c = ''; }
        const r = await Cloud.posCheck();
        if (r === 'ok') { clearInterval(window._posPoll); history.replaceState(null, '', '#/'); route(); toast('✓ تفعّلت نقطة البيع'); return; }
        if (r === 'rejected') {
          clearInterval(window._posPoll);
          show(`<p style="font-size:42px;margin:6px 0">⛔</p><p><b>نقطة البيع مش مفعّلة على هالموبايل</b></p><p class="muted">المدير رفض الطلب أو وقّف هالموبايل.</p><div class="acts" style="justify-content:center"><button class="btn pri" id="posAgain">📲 ابعت طلب تفعيل من جديد</button></div>`);
          const a = $('#posAgain', view); if (a) a.onclick = async () => { a.disabled = true; try { await Cloud.posJoin(company, repN); } catch (e) { toast(e.message, 1); } route(); };
          return;
        }
        show(waitHtml); const b = $('#posChk', view); if (b) b.onclick = check;
      } catch (e) {
        show(`<p class="bad">${esc(e.message)}</p><p class="muted">تأكد إنه في إنترنت.</p><div class="acts" style="justify-content:center"><button class="btn pri" id="posChk">🔄 جرّب مرة تانية</button></div>`);
        const b = $('#posChk', view); if (b) b.onclick = check;
      }
    };
    show('<p>⏳ لحظة…</p>');
    clearInterval(window._posPoll);
    window._posPoll = setInterval(() => { if (!/^#\/(pos|sellersetup)/.test(location.hash) || Cloud.info().member) return clearInterval(window._posPoll); check(); }, 6000);
    check();
    return;
  }
  const ownerIn = info.linked && !info.member;
  if (!ownerIn) try { localStorage.setItem(POS_DEV_KEY, '1'); } catch (e) { /* */ }
  applySellerUI();
  view.innerHTML = head(`🧑‍💼 تجهيز نقطة البيع${name ? ' — ' + esc(name) : ''}`) + `
  <div class="card">
    ${ownerIn ? `<p class="bad"><b>⚠️ هالموبايل مسجّل دخول بحساب المدير (${esc(info.email || '')}).</b><br>لحتى يصير نقطة بيع: اكبس «تسجيل الخروج» تحت، وبعدين سجّل دخول بإيميل المندوب.</p>${posDevice() ? `<p><button class="btn" id="posUnlock">↩️ هاد موبايل المدير — رجّع دفتر كامل</button></p>` : ''}` :
    `<p><b>📷 الأسهل:</b> من موبايل المدير ← الإعدادات ← «باركود نقطة البيع» ← صوّر الباركود بهالموبايل، والمدير بيفعّله.</p>
    <p class="muted">أو: سجّل دخول بإيميل المندوب وكلمة سره ← <b>دخول</b> (أو «إنشاء حساب جديد» إذا أول مرة). بعدين اكبس <b>📂 فتح</b> على اسم الشركة.<br>⚠️ <b>لا تكبس «إنشاء ورفع بياناتي»</b>.<br>إذا ما طلعت الشركة: من موبايل المدير ← الإعدادات ← 👤 إضافة مستخدم ← إيميل المندوب، وارجع لهون.</p>`}
    <div id="cloudCard"></div></div>`;
  if (window.Cloud) Cloud.card($('#cloudCard', view)); else $('#cloudCard', view).remove();
  const ul = $('#posUnlock', view);
  if (ul) ul.onclick = () => { localStorage.removeItem(POS_DEV_KEY); applySellerUI(); toast('✓ رجع دفتر كامل على هالموبايل'); go('#/'); };
};

/* ------------------------- شاشة القفل (أي موبايل مش مسجّل بحساب المدير) ------------------------- */
V.lock = (id, q, view) => {
  applySellerUI();
  view.innerHTML = `<div class="card" style="max-width:460px;margin:30px auto;text-align:center"><p style="font-size:46px;margin:4px 0">🔒</p><h2 style="margin:0 0 6px">دفتر</h2><p class="muted">البرنامج مقفول. سجّل دخول بإيميل المدير وكلمة سره ← بعدين اكبس <b>📂 فتح</b> على اسم الشركة.</p></div><div class="card" id="cloudCard" style="max-width:460px;margin:0 auto"></div>`;
  Cloud.card($('#cloudCard', view), { gate: true });
};

/* ------------------------- الرئيسية ------------------------- */
function sellerHome(view) {
  const t = today(), mine = db.invoices.filter(i => i.type === 'sale' && i.date === t && i.rep === myRep());
  const tot = mine.reduce((s2, i) => s2 + invTotals(i).net * docRate(i), 0);
  view.innerHTML = head(`🧑‍💼 نقطة البيع — ${esc(myRep())}`, `<button class="btn pri sync-btn" id="homeSync" data-act="sync">🔄 مزامنة</button><span class="muted">${t}</span>`) + `
  <div class="quick">
    <a href="#/invoice/new?type=sale" class="q"><i>🧾</i>فاتورة مبيع</a>
    <a href="#/invoices?t=sale" class="q"><i>📋</i>فواتيري</a>
    <a href="#/vouchers?new=receipt" class="q"><i>📥</i>قبض من زبون</a>
    <a href="#/vouchers" class="q"><i>🧾</i>سنداتي</a>
  </div>
  <div class="kpis">${kpi('مبيعات اليوم', fmt(r2(tot)) + ' ' + esc(cur()))}${kpi('عدد فواتير اليوم', mine.length)}${kpi('مقبوضات اليوم', fmt(r2(db.vouchers.filter(v => v.type === 'receipt' && v.date === t && v.rep === myRep() && !v.inv).reduce((x, v) => x + num(v.amount) * docRate(v), 0))) + ' ' + esc(cur()))}</div>
  ${myBox() ? `<p class="muted" style="text-align:center">💰 ${esc(myBox().name)}</p>` : `<p class="bad" style="text-align:center">${NO_BOX}</p>`}
  <p class="muted" style="text-align:center;margin-top:14px">الإصدار ${APP_VERSION}${window.Cloud && Cloud.info().email && !/@pos\.daftar\.app$/.test(Cloud.info().email) ? ` — ${esc(Cloud.info().email)}` : ''}</p>
  <p style="text-align:center;margin-top:4px"><button class="btn" style="font-size:12px;opacity:.7" data-act="boss">🔑 دخول المدير</button></p>`;
  if (window.Cloud && !Cloud.info().linked) { const c = document.createElement('div'); c.className = 'card'; view.appendChild(c); Cloud.card(c); }
  if (!repName()) {
    modal('🧑‍💼 اسم المندوب', '<p class="muted">اكتب اسمك مرة وحدة — بيطلع على كل فواتيرك.</p>' + fields([{ k: 'name', l: 'اسم المندوب', req: 1, full: 1 }]), {
      saveText: 'حفظ', onSave: d => { const n = String(d.name || '').trim(); if (!n) return false; localStorage.setItem(REP_KEY, n); route(); },
    });
  }
  onAct(view, {
    sync: async () => { if (!window.Cloud || !Cloud.info().linked) return toast('المزامنة مش مربوطة — سجّل دخول من تحت', 1); await Cloud.sync(true); route(); },
    boss: () => {
      if (!window.Cloud) return;
      modal('🔑 دخول المدير', '<p class="muted">إيميل وكلمة سر <b>صاحب الشركة</b> — بيرجع هالموبايل دفتر كامل.</p>' + fields([{ k: 'email', l: 'الإيميل', t: 'email', req: 1, full: 1 }, { k: 'pw', l: 'كلمة السر', t: 'password', req: 1, full: 1 }]), {
        saveText: 'دخول',
        onSave: (d, f) => {
          const b = $('button.pri', f); b.disabled = true;
          Cloud.ownerSwitch(String(d.email).trim(), d.pw).then(() => $('#dlg').close()).catch(e => { toast(e.message, 1); b.disabled = false; });
          return false;
        },
      });
    },
  });
  if (window.Cloud) Cloud.pill();
}

V.home = (id, q, view) => {
  if (isSeller()) return sellerHome(view);
  ensureAllRepBoxes();
  const R = rollup(sums());
  const bal = i => natural(acc(i), R[i]);
  const mo = today().slice(0, 7), y = today().slice(0, 4);
  const MS = sums(mo + '-01');
  const monthSales = (MS.sales?.cr || 0) - (MS.sales?.dr || 0);
  const YR = rollup(sums(y + '-01-01'));
  const profit = natural(acc('revenue'), YR.revenue) - natural(acc('expenses'), YR.expenses);
  const st = engine().stock;
  const low = db.items.filter(i => num(i.minQty) > 0 && (st[i.id]?.qty || 0) <= num(i.minQty));
  const recent = [...db.invoices].sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0)).slice(0, 8);

  view.innerHTML = head('الرئيسية', `<button class="btn pri sync-btn" id="homeSync" data-act="sync">🔄 مزامنة</button>${(() => { const lb = lastBackup(), old = Date.now() - lb > 864e5; return `<button class="btn sync-btn ${old ? 'warn pri' : 'ok'}" data-act="backup">💾 نسخة احتياطية${lb ? (old ? ' — صرلها أكتر من يوم' : ' — اليوم ✓') : ' — ما في ولا نسخة'}</button>`; })()}<span class="muted">${today()}</span>`) + `
  <div class="quick">
    <a href="#/invoice/new?type=sale"><i>🧾</i>فاتورة مبيع</a>
    <a href="#/invoice/new?type=purchase"><i>🛒</i>فاتورة شراء</a>
    <a href="#/vouchers?new=receipt"><i>📥</i>سند قبض</a>
    <a href="#/vouchers?new=payment"><i>📤</i>سند دفع</a>
    <a href="#/entry/new"><i>📝</i>قيد يومية</a>
    <a href="#/reports"><i>📊</i>التقارير</a>
  </div>
  ${(() => { const bx = postable().filter(a => a.repBox); return bx.length ? `<div class="card"><h3>💰 صناديق المندوبين</h3>${table(['الصندوق', 'الرصيد', ''], bx.map(a => `<tr><td>${esc(a.name)}</td><td class="n">${fmt(bal(a.id))} ${esc(cur())}</td><td><button class="btn pri" data-act="takeBox" data-id="${a.id}">📥 استلام</button></td></tr>`).join(''))}</div>` : ''; })()}
  <div class="cols2">
    <div class="card"><h3>آخر الفواتير</h3>${table(['الرقم', 'النوع', 'التاريخ', 'الطرف', 'الصافي'],
      recent.map(i => `<tr data-act="open" data-id="${i.id}"><td>${i.no}</td><td><span class="badge ${i.type}">${INV_TYPES[i.type]}</span></td><td class="n">${i.date}</td><td>${esc(accName(i.party) || 'نقدي')}</td><td class="n">${fmt(invTotals(i).net)} <small class="muted">${esc(docSym(i))}</small></td></tr>`).join(''))}</div>
    <div class="card"><h3>مواد وصلت للحد الأدنى</h3>${table(['المادة', 'الكمية', 'الحد الأدنى'],
      low.map(i => `<tr><td>${esc(i.name)}</td><td class="n"><span class="badge low">${fmt(st[i.id]?.qty || 0)}</span></td><td class="n">${fmt(i.minQty)}</td></tr>`).join(''))}
      ${!db.items.length ? `<p class="muted">لا توجد بيانات بعد. ابدأ بإضافة <a href="#/items">المواد</a> و<a href="#/parties">العملاء</a>، أو جرّب <a href="#/settings">البيانات التجريبية</a>.</p>` : ''}</div>
  </div>
  <h3 class="dash-title">📊 لوحة التحكم</h3>
  <div class="kpis">
    ${kpi('النقدية (صندوق + بنك)', fmt(bal('cashGroup')) + ' ' + cur(), 'p')}
    ${kpi('ذمم العملاء (لنا)', fmt(bal('customers')), 'g')}
    ${kpi('ذمم الموردين (علينا)', fmt(bal('suppliers')), 'r')}
    ${kpi('قيمة المخزون', fmt(bal('inventory')), 'a')}
    ${kpi('مبيعات هذا الشهر', fmt(monthSales), 'g')}
    ${kpi(`سعر صرف ${FX().name}`, `<button class="mini" data-act="rate" style="float:left">تعديل</button>${FX().rate ? fmt(FX().rate) + ' ' + cur() : '<span class="bad" style="font-size:15px">غير محدد</span>'}`, 'a')}
    ${kpi('صافي ربح السنة', `<span class="${profit < 0 ? 'neg' : 'pos'}">${fmt(profit)}</span>`, 'p')}
  </div>`;
  onAct(view, {
    open: id => go('#/invoice/' + id), rate: () => rateDialog(),
    takeBox: id => takeFromRep(id, bal(id)),
    backup: () => backupShare(),
    sync: async () => {
      if (!window.Cloud || !Cloud.info().linked) { toast('المزامنة مش مربوطة — اربطها من الإعدادات', 1); return go('#/settings'); }
      await Cloud.sync(true);
      if (/^#\/?$/.test(location.hash) || location.hash === '') route();
    },
  });
  if (window.Cloud) Cloud.pill();
};
// استلام مصاري من المندوب: قيد من صندوق المندوب للصندوق الرئيسي (أو أي صندوق)
function takeFromRep(boxId, balance) {
  const box = acc(boxId); if (!box) return;
  const to = cashAccounts().filter(a => !a.repBox);
  modal('📥 استلام من ' + box.name.replace('صندوق المندوب: ', 'المندوب '), fields([
    { k: 'amount', l: `المبلغ المستلم (${cur()})`, t: 'number', req: 1 },
    { k: 'to', l: 'إلى الصندوق', t: 'select', opts: accOpts(to), req: 1 },
    { k: 'date', l: 'التاريخ', t: 'date', req: 1 },
    { k: 'note', l: 'ملاحظة', full: 1 },
  ], { amount: balance > 0 ? r2(balance) : '', to: to[0]?.id, date: today() }) + `<p class="muted">رصيد صندوقه هلق: <b>${fmt(balance)} ${esc(cur())}</b></p>`, {
    saveText: 'استلام',
    onSave: d => {
      const amt = r2(num(d.amount));
      if (amt <= 0) { toast('أدخل مبلغاً صحيحاً', 1); return false; }
      if (amt > r2(balance) && !confirm(`المبلغ أكبر من رصيد صندوقه (${fmt(balance)}). متابعة؟`)) return false;
      db.entries.push({ id: uid(), no: newNo('entry').no, date: d.date, desc: 'استلام من ' + box.name + (d.note ? ' — ' + d.note : ''),
        lines: [{ acc: d.to, dr: amt, cr: 0, note: '' }, { acc: box.id, dr: 0, cr: amt, note: '' }] });
      save(); toast(`✓ استلمت ${fmt(amt)} ${cur()}`); route();
    },
  });
}
function rateDialog() {
  modal(`سعر صرف ${FX().name}`, fields([{ k: 'rate', l: `كم ${cur()} مقابل 1 ${FX().sym}؟`, t: 'number', req: 1, full: 1 }], { rate: db.settings.rate }) +
    '<p class="muted">يُستخدم كقيمة افتراضية للفواتير والسندات الجديدة بالدولار. الفواتير القديمة تحتفظ بسعرها.</p>', {
    onSave: d => { const r = num(d.rate); if (r <= 0) { toast('أدخل سعراً صحيحاً', 1); return false; } db.settings.rate = r; save(); toast('تم تحديث سعر الصرف'); route(); },
  });
}

/* ------------------------- دليل الحسابات ------------------------- */
function accountForm(a, parentId) {
  const isNew = !a, p = acc(a ? a.parent : parentId);
  const vals = a ? { ...a, group: a.group ? '1' : '0' } : { code: p ? nextCode(p) : String(children(null).length + 1), type: p?.type || 'asset', group: '0' };
  const fl = [
    { k: 'code', l: 'رمز الحساب', req: 1 },
    { k: 'name', l: 'اسم الحساب', req: 1 },
  ];
  if (!p) fl.push({ k: 'type', l: 'نوع الحساب', t: 'select', opts: Object.entries(ACC_TYPES) });
  if (!a?.sys) fl.push({ k: 'group', l: 'الصفة', t: 'select', opts: [['0', 'حساب فرعي (يقبل حركات)'], ['1', 'حساب تجميعي (رئيسي)']] });
  fl.push({ k: 'phone', l: 'الهاتف' }, { k: 'notes', l: 'ملاحظات', t: 'textarea', full: 1 });
  modal(isNew ? (p ? `حساب جديد تحت: ${p.name}` : 'حساب رئيسي جديد') : 'تعديل حساب', fields(fl, vals), {
    onSave: d => {
      d.code = d.code.trim(); d.name = d.name.trim();
      if (db.accounts.some(x => x.code === d.code && x !== a)) { toast('رمز الحساب مستخدم مسبقاً', 1); return false; }
      const grp = d.group === '1';
      if (a) {
        if (grp && !a.group && hasMoves(a.id)) { toast('لا يمكن تحويل حساب عليه حركات إلى تجميعي', 1); return false; }
        Object.assign(a, { code: d.code, name: d.name, phone: d.phone, notes: d.notes });
        if (!a.sys) a.group = grp;
        if (!p && d.type) a.type = d.type;
      } else {
        db.accounts.push({ id: uid(), code: d.code, name: d.name, type: p ? p.type : d.type, parent: p ? p.id : null, group: grp, phone: d.phone, notes: d.notes });
      }
      save(); toast('تم الحفظ'); route();
    },
  });
}
function canAddChild(a) {
  if (a.sys && !a.group) return false; // حسابات النظام الفرعية مقفلة
  if (!isGroup(a) && hasMoves(a.id)) return false;
  return true;
}
V.accounts = (id, q, view) => {
  const R = rollup(sums());
  const rows = treeOrder().map(({ a, d }) => {
    const b = natural(a, R[a.id]);
    return `<tr class="${isGroup(a) ? 'grp' : ''}"><td class="n">${esc(a.code)}</td>
      <td style="padding-inline-start:${10 + d * 18}px">${esc(a.name)}</td>
      <td>${ACC_TYPES[a.type]}</td>
      <td class="n">${fmt(Math.abs(b))} <small class="muted">${b ? balLabel(a, b) : ''}</small></td>
      <td class="ac"><a class="mini" href="#/report/statement?acc=${a.id}">كشف</a>${canAddChild(a) ? `<button class="mini" data-act="child" data-id="${a.id}">+ فرعي</button>` : ''}<button class="mini" data-act="edit" data-id="${a.id}">تعديل</button>${!a.sys ? `<button class="mini red" data-act="del" data-id="${a.id}">حذف</button>` : ''}</td></tr>`;
  }).join('');
  view.innerHTML = head('دليل الحسابات', `<button class="btn pri" data-act="root">+ حساب رئيسي</button>`) +
    `<div class="card">${table(['الرمز', 'اسم الحساب', 'النوع', 'الرصيد', ''], rows)}</div>`;
  onAct(view, {
    root: () => accountForm(null, null),
    child: id => accountForm(null, id),
    edit: id => accountForm(acc(id)),
    del: id => {
      const a = acc(id);
      if (children(id).length) return toast('احذف الحسابات الفرعية أولاً', 1);
      if (hasMoves(id)) return toast('لا يمكن حذف حساب عليه حركات', 1);
      if (!confirm(`حذف الحساب "${a.name}"؟`)) return;
      db.accounts = db.accounts.filter(x => x.id !== id); save(); route();
    },
  });
};

/* ------------------------- العملاء والموردون ------------------------- */
function partyForm(a, kind) {
  const parent = kind === 'c' ? 'customers' : 'suppliers';
  const fl = [
    { k: 'name', l: 'الاسم', req: 1 }, { k: 'phone', l: 'الهاتف' },
    { k: 'address', l: 'العنوان' }, { k: 'code', l: 'الرمز' },
  ];
  if (!a) fl.push({ k: 'openBal', l: kind === 'c' ? 'رصيد افتتاحي (له علينا ← اكتب بالسالب)' : 'رصيد افتتاحي (لنا عليه ← اكتب بالسالب)', t: 'number', full: 1 });
  fl.push({ k: 'aliases', l: 'أسماء تانية (متل ما بتحكيه أو بتكتبه — كل اسم بسطر)', t: 'textarea', full: 1 });
  fl.push({ k: 'notes', l: 'ملاحظات', t: 'textarea', full: 1 });
  const vals = a ? { ...a, aliases: (a.aliases || []).join('\n') } : { code: nextCode(acc(parent)) };
  modal(a ? 'تعديل' : (kind === 'c' ? 'عميل جديد' : 'مورد جديد'), fields(fl, vals), {
    onSave: d => {
      const code = (d.code || '').trim() || nextCode(acc(parent));
      if (db.accounts.some(x => x.code === code && x !== a)) { toast('الرمز مستخدم مسبقاً', 1); return false; }
      const aliases = String(d.aliases || '').split(/\n+/).map(x => x.trim()).filter(Boolean);
      if (a) Object.assign(a, { name: d.name.trim(), phone: d.phone, address: d.address, notes: d.notes, code, aliases });
      else {
        const na = { id: uid(), code, name: d.name.trim(), type: acc(parent).type, parent, group: false, phone: d.phone, address: d.address, notes: d.notes, aliases };
        db.accounts.push(na);
        const ob = r2(num(d.openBal));
        if (ob) {
          const dr = kind === 'c' ? ob > 0 : ob < 0, v = Math.abs(ob);
          db.entries.push({ id: uid(), no: nextNo('entry'), date: db.settings.startDate, desc: 'رصيد افتتاحي — ' + na.name,
            lines: [{ acc: na.id, dr: dr ? v : 0, cr: dr ? 0 : v, note: '' }, { acc: 'capital', dr: dr ? 0 : v, cr: dr ? v : 0, note: '' }] });
        }
      }
      save(); toast('تم الحفظ'); route();
    },
  });
}
V.parties = (id, q, view) => {
  const k = q.t === 's' && !isSeller() ? 's' : 'c';
  const list = k === 'c' ? customers() : suppliers();
  const R = rollup(sums());
  let total = 0;
  const rows = list.map(a => {
    const b = natural(a, R[a.id]); total += b;
    return `<tr data-name="${esc(a.name + ' ' + (a.phone || ''))}"><td class="n">${esc(a.code)}</td><td>${esc(a.name)}</td><td class="n">${esc(a.phone || '')}</td>
    <td class="n ${b > 0 ? (k === 'c' ? 'pos' : 'neg') : ''}">${fmt(b)}</td>
    <td class="ac"><a class="mini" href="#/report/statement?acc=${a.id}">كشف حساب</a>
      <button class="mini wa" data-act="wa" data-id="${a.id}">واتساب</button>
      <a class="mini" href="#/vouchers?new=${k === 'c' ? 'receipt' : 'payment'}&acc=${a.id}">${k === 'c' ? 'قبض' : 'دفع'}</a>
      <button class="mini" data-act="edit" data-id="${a.id}">تعديل</button><button class="mini red" data-act="del" data-id="${a.id}">حذف</button></td></tr>`;
  }).join('');
  view.innerHTML = head('العملاء والموردون', `<button class="btn" data-act="import">📥 استيراد Excel</button><button class="btn pri" data-act="add">+ ${k === 'c' ? 'عميل' : 'مورد'} جديد</button>`) + `
    <div class="tabs"><a href="#/parties?t=c" class="${k === 'c' ? 'on' : ''}">العملاء (${customers().length})</a><a href="#/parties?t=s" class="${k === 's' ? 'on' : ''}">الموردون (${suppliers().length})</a></div>
    <div class="card"><input class="search" id="q" placeholder="🔎 بحث بالاسم أو الهاتف" style="margin-bottom:10px">
    ${table(['الرمز', 'الاسم', 'الهاتف', k === 'c' ? 'الرصيد (لنا عليه)' : 'الرصيد (له علينا)', ''], rows,
      `<tr><td colspan="3">الإجمالي</td><td class="n">${fmt(total)}</td><td></td></tr>`)}</div>`;
  $('#q', view).oninput = e => { const s = e.target.value.trim(); $$('tbody tr[data-name]', view).forEach(tr => (tr.style.display = tr.dataset.name.includes(s) ? '' : 'none')); };
  onAct(view, {
    add: () => partyForm(null, k),
    import: () => window.ItemImport && ItemImport.openParties(k),
    edit: id => partyForm(acc(id), k),
    wa: id => { const a = acc(id); waSend(a, waBalanceText(a)); },
    del: id => {
      if (hasMoves(id)) return toast('لا يمكن الحذف: يوجد حركات على هذا الحساب', 1);
      if (!confirm('تأكيد الحذف؟')) return;
      db.accounts = db.accounts.filter(x => x.id !== id); save(); route();
    },
  });
};

/* ------------------------- المواد والمستودع ------------------------- */
/* ---------- الباركود ---------- */
const parseCodes = txt => [...new Set(String(txt || '').split(/[\n,،;\s]+/).map(x => x.trim()).filter(Boolean))];
const itemCodes = i => [i.code, ...(i.barcodes || [])].filter(Boolean);
const findByCode = c => { c = String(c || '').trim(); return c ? db.items.find(i => itemCodes(i).includes(c)) : null; };
const canScan = () => 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
/* مسح باركود بكاميرا الموبايل (Chrome على أندرويد) */
async function scanBarcode(onCode) {
  if (!canScan()) return toast('المسح بالكاميرا غير مدعوم على هذا المتصفح — استخدم Chrome على أندرويد أو قارئ باركود', 1);
  let d = document.getElementById('scanDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'scanDlg'; document.body.appendChild(d); }
  d.innerHTML = `<div class="dlg-form"><header><h3>📷 امسح الباركود</h3><button type="button" class="x" id="scanX">✕</button></header>
    <div class="dlg-body" style="padding:0;position:relative;background:#000"><video id="scanV" playsinline muted style="width:100%;display:block;max-height:60vh;object-fit:cover"></video>
    <div style="position:absolute;inset:35% 10%;border:3px solid #14b8a6;border-radius:12px;pointer-events:none"></div></div>
    <footer><span class="muted">وجّه الكاميرا على الباركود</span></footer></div>`;
  let stream = null, timer = null, done = false;
  const stop = () => { done = true; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); if (d.open) d.close(); };
  d.onclose = stop; $('#scanX', d).onclick = stop;
  d.showModal();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    const v = $('#scanV', d); v.srcObject = stream; await v.play();
    let formats; try { formats = await BarcodeDetector.getSupportedFormats(); } catch (e) { /* */ }
    const det = new BarcodeDetector(formats && formats.length ? { formats } : undefined);
    const tick = async () => {
      if (done) return;
      try {
        const r = await det.detect(v);
        if (r.length && r[0].rawValue) { const code = r[0].rawValue.trim(); stop(); navigator.vibrate?.(80); onCode(code); return; }
      } catch (e) { /* */ }
      timer = setTimeout(tick, 250);
    };
    tick();
  } catch (e) { stop(); toast('تعذّر فتح الكاميرا — اسمح للمتصفح باستخدامها', 1); }
}

function nextItemCode() { const m = db.items.reduce((x, i) => Math.max(x, parseInt(i.code, 10) || 0), 0); return String(m + 1).padStart(3, '0'); }
/* ------------------------- مجموعات المواد (رئيسية ← فرعية) ------------------------- */
const grp = id => db.groups.find(g => g.id === id);
const grpKids = id => db.groups.filter(g => (g.parent || null) === (id || null)).sort(byCode);
const grpDesc = id => { const out = [id]; grpKids(id).forEach(k => out.push(...grpDesc(k.id))); return out; };
const grpTree = () => { const out = []; const walk = (p, d) => grpKids(p).forEach(g => { out.push({ g, d }); walk(g.id, d + 1); }); walk(null, 0); return out; };
const grpPath = id => { const p = []; let g = grp(id), n = 0; while (g && n++ < 20) { p.unshift(g.name); g = grp(g.parent); } return p.join(' › '); };
const grpOpts = (empty = '— بدون مجموعة —') => [['', empty], ...grpTree().map(({ g, d }) => [g.id, '   '.repeat(d) + (d ? '↳ ' : '') + g.code + ' ' + g.name])];
const grpItems = id => { const ids = new Set(grpDesc(id)); return db.items.filter(i => ids.has(i.group)); };
function nextGrpCode(parentId) {
  const p = grp(parentId), prefix = p ? p.code : '', w = p ? 2 : 3;
  let max = 0;
  grpKids(parentId).forEach(s => { if (s.code.startsWith(prefix)) { const n = parseInt(s.code.slice(prefix.length), 10) || 0; if (n > max) max = n; } });
  return prefix + String(max + 1).padStart(w, '0');
}
function groupForm(g, parentId) {
  const parent = g ? g.parent : parentId;
  const banned = g ? new Set(grpDesc(g.id)) : new Set();
  const pOpts = grpOpts('— مجموعة رئيسية —').filter(([id]) => !banned.has(id));
  modal(g ? 'تعديل مجموعة' : (parent ? `مجموعة فرعية تحت: ${grp(parent).name}` : 'مجموعة رئيسية جديدة'),
    fields([{ k: 'code', l: 'الرمز' }, { k: 'name', l: 'اسم المجموعة', req: 1 }, { k: 'parent', l: 'تتبع لـ', t: 'select', opts: pOpts, full: 1 }],
      g || { code: nextGrpCode(parent), parent: parent || '' }), {
    onSave: d => {
      const code = (d.code || '').trim() || nextGrpCode(d.parent || null);
      if (db.groups.some(x => x.code === code && x !== g)) { toast('رمز المجموعة مستخدم مسبقاً', 1); return false; }
      const o = { code, name: d.name.trim(), parent: d.parent || null };
      if (g) Object.assign(g, o); else db.groups.push({ id: uid(), ...o });
      save(); toast('تم الحفظ'); route();
    },
  });
}
const groupsOpen = new Set();
V.groups = (id, q, view) => {
  const card = (g, d) => {
    const kids = grpKids(g.id), direct = db.items.filter(i => i.group === g.id).length, all = grpItems(g.id).length, open = groupsOpen.has(g.id);
    return `<div class="g-card ${d ? 'sub' : ''}" style="margin-inline-start:${d * 14}px">
      <button class="g-tog" data-act="tog" data-id="${g.id}" ${kids.length ? '' : 'style="visibility:hidden"'}>${open ? '▴' : '▾'}</button>
      <div class="g-main" data-act="items" data-id="${g.id}">
        <div><span class="g-code">${esc(g.code)}</span> <b>${esc(g.name)}</b></div>
        <small>المواد ${all}${all !== direct ? ` (مباشرة ${direct})` : ''}${kids.length ? ` · المجموعات الفرعية ${kids.length}` : ''}</small>
      </div>
      <button class="g-menu" data-act="menu" data-id="${g.id}" aria-label="خيارات">⋮</button>
    </div>${open ? kids.map(k => card(k, d + 1)).join('') : ''}`;
  };
  const roots = grpKids(null), none = db.items.filter(i => !i.group || !grp(i.group)).length;
  view.innerHTML = head('مجموعات المواد', `<a class="btn" href="#/items">📦 المواد</a>`) + `
    <div class="g-list">${roots.length ? roots.map(g => card(g, 0)).join('') : `<div class="empty card">لا توجد مجموعات بعد. أنشئ مجموعة رئيسية (مثلاً اسم الشركة أو نوع البضاعة)، ثم أضف تحتها مجموعات فرعية.</div>`}
    ${none ? `<div class="g-card none"><span class="g-tog" style="visibility:hidden">▾</span><div class="g-main" data-act="items" data-id="none"><b>مواد بدون مجموعة</b><small>المواد ${none}</small></div></div>` : ''}</div>
    <button class="fab" data-act="new">＋ إنشاء</button>`;
  onAct(view, {
    tog: id => { groupsOpen.has(id) ? groupsOpen.delete(id) : groupsOpen.add(id); route(); },
    items: id => go('#/items?g=' + id),
    new: () => groupForm(null, null),
    menu: id => {
      const g = grp(id);
      const f = modal(`${g.code} ${g.name}`, `<div class="menu-list">
        <button type="button" class="btn" data-m="items">📦 عرض المواد</button>
        <button type="button" class="btn" data-m="addItem">＋ مادة جديدة بهالمجموعة</button>
        <button type="button" class="btn" data-m="sub">📂 مجموعة فرعية جديدة</button>
        <button type="button" class="btn" data-m="edit">✏️ تعديل</button>
        <button type="button" class="btn red" data-m="del">🗑 حذف</button></div>`);
      f.onclick = e => {
        const m = e.target.closest('[data-m]')?.dataset.m; if (!m) return;
        $('#dlg').close();
        if (m === 'items') go('#/items?g=' + id);
        else if (m === 'addItem') itemForm(null, id);
        else if (m === 'sub') { groupsOpen.add(id); groupForm(null, id); }
        else if (m === 'edit') groupForm(g);
        else if (m === 'del') {
          if (grpKids(id).length) return toast('احذف المجموعات الفرعية أولاً', 1);
          if (db.items.some(i => i.group === id)) return toast('لا يمكن الحذف: يوجد مواد بهذه المجموعة — انقلها لمجموعة أخرى أولاً', 1);
          if (!confirm(`حذف المجموعة "${g.name}"؟`)) return;
          db.groups = db.groups.filter(x => x !== g); save(); route();
        }
      };
    },
  });
};

/* «بسكوت 1000 12ق» ← «بسكوت 10 12ق»: يقسم الأرقام الكبيرة المدوّرة بالاسم، وما بيلمس التعبئة والأوزان (400 مل، 12ق) */
function zeroName(name, f) {
  const unit = /^\s*(?:مل|ملل|مليلتر|غ|غرام|غم|جرام|كغ|كغم|كيلو|كيلوغرام|ل|لتر|ليتر|ق|قطعه|قطعة|حبه|حبة|سم|م|g|gr|kg|ml|l|cm|%)(?![\u0600-\u06FF\w])/i;
  return String(name).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\d+/g, (m, off, str) => {
    const n = +m;
    if (n < f || n % f) return m;
    if (unit.test(str.slice(off + m.length))) return m;
    return String(n / f);
  });
}
/* حذف صفرين (أو أكتر) من أسعار المواد — للي دخّل الأسعار بالعملة القديمة */
function zerosForm(gf) {
  const F = [['buyPrice', 'سعر الشراء'], ['sellPrice', 'سعر المبيع'], ['consumerPrice', 'سعر المستهلك'], ['openCost', 'كلفة أول المدة']];
  const UNDO = 'daftar-zeros-undo';
  let undo = null; try { undo = JSON.parse(localStorage.getItem(UNDO) || 'null'); } catch (e) {}
  const scope = () => { const g = $('#zG').value; if (!g) return db.items; const ids = new Set(grpDesc(g)); return db.items.filter(i => ids.has(i.group)); };
  modal('✂️ حذف صفرين من الأسعار', `
    <p class="muted" style="margin-top:0">بيقسم الأسعار على الرقم اللي بتختاره (100 = حذف صفرين). مثلاً 250,000 بتصير 2,500.</p>
    <div class="grid2">
      <label class="fld"><span>اقسم على</span><select id="zF"><option value="100">100 (حذف صفرين)</option><option value="10">10 (حذف صفر)</option><option value="1000">1000 (حذف 3 أصفار)</option></select></label>
      <label class="fld"><span>المواد</span><select id="zG">${optsHtml(grpOpts('— كل المواد —'), gf && gf !== 'none' ? gf : '')}</select></label>
    </div>
    <div style="margin:10px 0">${F.map(([k, l]) => `<label style="display:inline-flex;gap:6px;align-items:center;margin-left:14px"><input type="checkbox" data-zk="${k}" ${k !== 'openCost' ? 'checked' : ''}> ${l}</label>`).join('')}</div>
    <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="zOnlyBig" checked> بس الأسعار الكبيرة (≥ 1000) — مشان ما يقسم شي انصلح قبل</label>
    <label style="display:flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" id="zNames"> كمان الأرقام اللي بأسماء المواد (بسكوت 1000 ← بسكوت 10)</label>
    <div id="zPrev" class="card" style="margin-top:10px;padding:10px"></div>
    ${undo ? `<p class="muted" style="font-size:13px">آخر تعديل: ${esc(undo.when)} (${undo.items.length} مادة) <button type="button" class="mini" id="zUndo">↩️ تراجع عنه</button></p>` : ''}`,
    { onSave: () => {
      const f = num($('#zF').value), ks = $$('[data-zk]').filter(x => x.checked).map(x => x.dataset.zk), big = $('#zOnlyBig').checked;
      const list = scope();
      if (!confirm(`رح تنقسم أسعار ${list.length} مادة على ${f}. متأكد؟`)) return false;
      const doNames = $('#zNames').checked;
      if (!ks.length && !doNames) { toast('اختار شي لتعدّله', 1); return false; }
      const backup = { when: new Date().toLocaleString('ar-SY'), items: list.map(i => ({ id: i.id, name: i.name, aliases: i.aliases, aliasKeys: i.aliasKeys, ...Object.fromEntries(F.map(([k]) => [k, i[k]])) })) };
      try { localStorage.setItem(UNDO, JSON.stringify(backup)); } catch (e) {}
      let n = 0;
      let nn = 0;
      list.forEach(i => {
        let ch = 0; ks.forEach(k => { const v = num(i[k]); if (v && (!big || v >= 1000)) { i[k] = r2(v / f); ch = 1; } }); n += ch;
        if (doNames) {
          const nm = zeroName(i.name, f);
          if (nm !== i.name) {
            // الاسم القديم بيصير «اسم تاني» مشان طلبيات الواتس اللي فيها الأرقام القديمة تضل تنفهم
            i.aliases = [...new Set([...(i.aliases || []), i.name])];
            if (window.OrderPaste) i.aliasKeys = [...new Set([...(i.aliasKeys || []), OrderPaste.keyOfText(i.name)].filter(Boolean))];
            i.name = nm; nn++;
          }
        }
      });
      save(); toast(`تعدّلت أسعار ${n} مادة${doNames ? ` وأسماء ${nn} مادة` : ''}`); route();
    }, saveText: '✂️ نفّذ' });
  const prev = () => {
    const f = num($('#zF').value), ks = $$('[data-zk]').filter(x => x.checked).map(x => x.dataset.zk), big = $('#zOnlyBig').checked, list = scope();
    const ex = list.filter(i => ks.some(k => num(i[k]) && (!big || num(i[k]) >= 1000)));
    $('#zPrev').innerHTML = `<b>${ex.length}</b> مادة رح تتعدّل أسعارها${ex.length ? ':' : ''}<br>` + ex.slice(0, 4).map(i => `<small>${esc(i.name)}: ${ks.filter(k => num(i[k])).map(k => `${fmt(i[k])} ← <b>${fmt((!big || num(i[k]) >= 1000) ? num(i[k]) / f : i[k])}</b>`).join(' ، ')}</small>`).join('<br>') + (ex.length > 4 ? '<br><small class="muted">…</small>' : '');
    if ($('#zNames').checked) {
      const rn = list.map(i => [i.name, zeroName(i.name, f)]).filter(([a, b]) => a !== b);
      $('#zPrev').innerHTML += `<hr style="border:0;border-top:1px solid var(--line);margin:8px 0"><b>${rn.length}</b> اسم رح يتعدّل${rn.length ? ':' : ''}<br>` + rn.slice(0, 8).map(([a, b]) => `<small>${esc(a)} ← <b>${esc(b)}</b></small>`).join('<br>') + (rn.length > 8 ? '<br><small class="muted">…</small>' : '') +
        `<br><small class="muted">الأسماء القديمة بتنحفظ كـ«أسماء تانية»، فطلبيات الواتس بالأرقام القديمة بتضل تنفهم.</small>`;
    }
  };
  $$('#dlg select, #dlg input[type=checkbox]').forEach(x => (x.onchange = prev)); prev();
  const u = $('#zUndo');
  if (u) u.onclick = () => {
    if (!confirm('ترجيع الأسعار متل ما كانت قبل آخر تعديل؟')) return;
    undo.items.forEach(b => { const i = db.items.find(x => x.id === b.id); if (i) { F.forEach(([k]) => (i[k] = b[k])); if (b.name) { i.name = b.name; i.aliases = b.aliases; i.aliasKeys = b.aliasKeys; } } });
    localStorage.removeItem(UNDO); save(); $('#dlg').close(); toast('رجعت الأسعار'); route();
  };
}
function itemForm(it, defGroup, after) {
  const fl = [
    { k: 'code', l: 'رمز المادة' }, { k: 'name', l: 'اسم المادة', req: 1 },
    { k: 'group', l: 'المجموعة', t: 'select', opts: grpOpts(), full: 1 },
    { k: 'unit', l: 'الوحدة', ph: 'قطعة، كيلو، علبة…' }, { k: 'minQty', l: 'الحد الأدنى للتنبيه', t: 'number' },
    { k: 'buyPrice', l: 'سعر الشراء', t: 'number' }, { k: 'sellPrice', l: 'سعر المبيع', t: 'number' },
    { k: 'consumerPrice', l: 'سعر المستهلك', t: 'number', full: 1 },
    { k: 'openQty', l: 'كمية أول المدة', t: 'number' }, { k: 'openCost', l: 'كلفة الوحدة أول المدة', t: 'number' },
    { k: 'barcodes', l: 'الباركودات (كل باركود بسطر — يمكن إضافة أكثر من باركود)', t: 'textarea', full: 1 },
    { k: 'aliases', l: 'أسماء تانية (متل ما بتنكتب بطلبيات الواتس — كل اسم بسطر)', t: 'textarea', full: 1 },
  ];
  const vals = it ? { ...it, barcodes: (it.barcodes || []).join('\n'), aliases: (it.aliases || []).join('\n') } : { code: nextItemCode(), unit: 'قطعة', group: defGroup && defGroup !== 'none' ? defGroup : '' };
  const f = modal(it ? 'تعديل مادة' : 'مادة جديدة', fields(fl, vals) +
    (canScan() ? `<button type="button" class="btn" id="bcScan" style="margin-top:8px">📷 إضافة باركود بالكاميرا</button>` : '') +
    `<p class="muted" style="font-size:13px;margin:8px 0 0">بقارئ الباركود: اضغط داخل خانة الباركودات وامسح، كل مسحة بسطر جديد.</p>`, {
    onSave: d => {
      const code = (d.code || '').trim();
      const barcodes = parseCodes(d.barcodes).filter(b => b !== code);
      for (const c of [code, ...barcodes]) {
        if (!c) continue;
        const other = db.items.find(x => x !== it && itemCodes(x).includes(c));
        if (other) { toast(`الرمز/الباركود ${c} مستخدم للمادة: ${other.name}`, 1); return false; }
      }
      const aliases = String(d.aliases || '').split(/\n+/).map(x => x.trim()).filter(Boolean);
      const aliasKeys = window.OrderPaste ? [...new Set(aliases.map(OrderPaste.keyOfText).filter(Boolean))] : [];
      const o = { code, barcodes, aliases, aliasKeys, group: d.group || null, name: d.name.trim(), unit: d.unit.trim(), minQty: num(d.minQty), buyPrice: num(d.buyPrice), sellPrice: num(d.sellPrice), consumerPrice: num(d.consumerPrice), openQty: num(d.openQty), openCost: num(d.openCost) };
      fillPrices(o);
      if (priceBad(o.sellPrice, o.buyPrice)) { toast(priceBadMsg('', o.sellPrice, o.buyPrice), 1); return false; }
      if (it) Object.assign(it, o); else db.items.push({ id: uid(), ...o });
      save(); toast('تم الحفظ');
      if (after) after(it); else route();
    },
  });
  const ta = $('[name=barcodes]', f);
  ta.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ta.value = ta.value.replace(/\s*$/, '') + '\n'; } });
  const sb = $('#bcScan', f);
  if (sb) sb.onclick = () => scanBarcode(c => { const cur = parseCodes(ta.value); if (!cur.includes(c)) ta.value = [...cur, c].join('\n'); toast('تمت إضافة الباركود ' + c); });
}
V.items = (id, q, view) => {
  const st = engine().stock;
  const gf = q.g || '';
  let list = [...db.items].sort(byCode);
  if (gf === 'none') list = list.filter(i => !i.group || !grp(i.group));
  else if (gf) { const ids = new Set(grpDesc(gf)); list = list.filter(i => ids.has(i.group)); }
  let tv = 0;
  const rows = list.map(i => {
    const s = st[i.id] || { qty: num(i.openQty), avg: num(i.openCost) }, v = s.qty * s.avg; tv += v;
    const low = num(i.minQty) > 0 && s.qty <= num(i.minQty);
    const bcs = i.barcodes || [], gp = i.group && grp(i.group) ? grpPath(i.group) : '';
    return `<tr data-name="${esc(normAr(itemCodes(i).join(' ') + ' ' + i.name + ' ' + gp))}"><td class="n">${esc(i.code)}</td><td>${esc(i.name)}${gp ? `<br><small class="muted">📂 ${esc(gp)}</small>` : ''}${bcs.length ? `<br><small class="muted">▮▯▮ ${bcs.length === 1 ? esc(bcs[0]) : bcs.length + ' باركود'}</small>` : ''}</td><td>${esc(i.unit || '')}</td>
      <td class="n">${low ? `<span class="badge low">${fmt(s.qty)}</span>` : fmt(s.qty)}</td><td class="n">${fmt(s.avg)}</td><td class="n">${fmt(v)}</td><td class="n">${fmt(i.sellPrice)}${oldOn() && i.sellPrice ? `<br><small class="muted">${oldAmt(i.sellPrice)} قديم</small>` : ''}</td><td class="n">${i.consumerPrice ? fmt(i.consumerPrice) + (oldOn() ? `<br><small class="muted">${oldAmt(i.consumerPrice)} قديم</small>` : '') : ''}</td>
      <td class="ac"><a class="mini" href="#/report/itemcard?item=${i.id}">الحركة</a><button class="mini" data-act="edit" data-id="${i.id}">تعديل</button><button class="mini red" data-act="del" data-id="${i.id}">حذف</button></td></tr>`;
  }).join('');
  const gOpts = [['', '📂 كل المجموعات'], ...grpOpts().slice(1), ['none', '— مواد بدون مجموعة —']];
  view.innerHTML = head(gf && gf !== 'none' && grp(gf) ? `المواد: ${esc(grpPath(gf))}` : 'المواد والمستودع',
    `<a class="btn" href="#/groups">📂 المجموعات</a><button class="btn" data-act="import">📥 استيراد Excel</button><button class="btn" data-act="zeros">✂️ حذف صفرين</button><button class="btn pri" data-act="add">+ مادة جديدة</button>`) + `
    <div class="card"><div class="filters" style="margin-bottom:10px"><select id="gf" style="flex:1;min-width:160px">${optsHtml(gOpts, gf)}</select>
    <input class="search" id="q" placeholder="🔎 بحث بالاسم أو الرمز أو الباركود" style="flex:2;min-width:180px"></div>
    ${table(['الرمز', 'المادة', 'الوحدة', 'الكمية', 'متوسط الكلفة', 'قيمة المخزون', 'سعر المبيع', 'سعر المستهلك', ''], rows,
      `<tr><td colspan="5">إجمالي قيمة المخزون (${list.length} مادة)</td><td class="n">${fmt(tv)}</td><td colspan="3"></td></tr>`)}</div>`;
  $('#q', view).oninput = e => { const s = normAr(e.target.value); $$('tbody tr[data-name]', view).forEach(tr => (tr.style.display = tr.dataset.name.includes(s) ? '' : 'none')); };
  $('#gf', view).onchange = e => go('#/items' + (e.target.value ? '?g=' + e.target.value : ''));
  onAct(view, {
    add: () => itemForm(null, gf),
    import: () => window.ItemImport && ItemImport.open(),
    zeros: () => zerosForm(gf),
    edit: id => itemForm(db.items.find(i => i.id === id)),
    del: id => {
      if (db.invoices.some(inv => inv.lines.some(l => l.item === id))) return toast('لا يمكن حذف مادة مستخدمة في فواتير', 1);
      if (!confirm('حذف المادة؟')) return;
      db.items = db.items.filter(i => i.id !== id); save(); route();
    },
  });
};

/* ------------------------- الفواتير ------------------------- */
V.invoices = (id, q, view) => {
  const t = isSeller() ? 'sale' : (q.t || 'all');
  // فلتر حسب المندوب: الكل / فواتيري / مندوب فلان
  const reps = [...new Set(db.invoices.map(i => i.rep).filter(Boolean))];
  const rf = isSeller() ? myRep() : (q.rep || '');
  const list = db.invoices.filter(i => (t === 'all' || i.type === t) && (isSeller() ? i.rep === rf : !rf ? true : rf === '-' ? !i.rep : i.rep === rf)).sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0));
  let tot = 0;
  const rows = list.map(i => {
    const n = invTotals(i).net; tot += n * docRate(i);
    return `<tr data-act="open" data-id="${i.id}" data-name="${esc(i.no + ' ' + accName(i.party))}"><td class="n">${i.no}</td><td><span class="badge ${i.type}">${INV_TYPES[i.type]}</span></td><td class="n">${i.date}</td>
      <td>${esc(accName(i.party) || '—')}${i.rep && !isSeller() ? `<br><small class="badge rep">مندوب: ${esc(i.rep)}</small>` : ''}</td><td>${i.pay === 'cash' ? 'نقدي' : 'آجل'}</td><td class="n">${fmt(n)} <small class="muted">${esc(docSym(i))}</small></td></tr>`;
  }).join('');
  const tab = (k, l) => `<a href="#/invoices?t=${k}${rf ? '&rep=' + encodeURIComponent(rf) : ''}" class="${t === k ? 'on' : ''}">${l}</a>`;
  const rtab = (k, l) => `<a href="#/invoices?t=${t}${k ? '&rep=' + encodeURIComponent(k) : ''}" class="${rf === k ? 'on' : ''}">${l}</a>`;
  const repTabs = !isSeller() && reps.length ? `<div class="tabs rep-tabs">${rtab('', 'كل الفواتير')}${rtab('-', 'فواتيري')}${reps.map(r => rtab(r, '🧑‍💼 مندوب: ' + esc(r))).join('')}</div>` : '';
  view.innerHTML = head(isSeller() ? `فواتيري — مندوب: ${esc(myRep())}` : 'الفواتير', Object.entries(INV_TYPES).map(([k, l]) => `<a class="btn ${k === 'sale' ? 'pri' : ''}" href="#/invoice/new?type=${k}">+ ${l}</a>`).join('')) + `
    ${repTabs}<div class="tabs">${tab('all', 'الكل')}${Object.entries(INV_TYPES).map(([k, l]) => tab(k, l)).join('')}</div>
    <div class="card"><input class="search" id="q" placeholder="🔎 بحث برقم الفاتورة أو الاسم" style="margin-bottom:10px">
    ${table(['الرقم', 'النوع', 'التاريخ', 'الطرف', 'الدفع', 'الصافي'], rows, t !== 'all' ? `<tr><td colspan="5">المجموع (بـ ${esc(cur())})</td><td class="n">${fmt(tot)}</td></tr>` : '')}</div>`;
  $('#q', view).oninput = e => { const s = e.target.value.trim(); $$('tbody tr[data-name]', view).forEach(tr => (tr.style.display = tr.dataset.name.includes(s) ? '' : 'none')); };
  onAct(view, { open: id => go('#/invoice/' + id) });
};

function invoiceHtml(inv) {
  const t = invTotals(inv), sideSale = ['sale', 'saleReturn'].includes(inv.type), sym = docSym(inv);
  const hasCp = db.settings.receiptCp !== '0';
  const rows = inv.lines.map((l, i) => {
    const it = db.items.find(x => x.id === l.item) || {}, cp = num(l.cp) || num(it.consumerPrice);
    return `<tr><td>${i + 1}</td><td>${esc(it.name || '')}</td><td>${esc(it.unit || '')}</td><td>${fmt(l.qty)}</td><td>${fmt(l.price)}</td>${hasCp ? `<td>${cp ? fmt(cp) : ''}</td>` : ''}<td>${fmt(num(l.qty) * num(l.price))}</td></tr>`;
  }).join('');
  const cs = hasCp ? 6 : 5;
  return `<h3 class="ptitle">${INV_TYPES[inv.type]} رقم ${inv.no}${repTag(inv)}</h3>
    <div class="pmeta"><span>التاريخ: ${inv.date}</span><span>${sideSale ? 'العميل' : 'المورد'}: ${esc(accName(inv.party) || 'نقدي')}</span><span>الدفع: ${inv.pay === 'cash' ? 'نقدي' : 'آجل'}</span><span>العملة: ${esc(docCurName(inv))}${inv.cur === 'fx' ? ` — سعر الصرف: ${fmt(inv.rate)}` : ''}</span></div>
    <table><thead><tr><th>#</th><th>المادة</th><th>الوحدة</th><th>الكمية</th><th>السعر</th>${hasCp ? '<th>سعر المستهلك</th>' : ''}<th>الإجمالي</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td colspan="${cs}">الإجمالي</td><td>${fmt(t.gross)}</td></tr>${t.disc ? `<tr><td colspan="${cs}">الحسم</td><td>${fmt(t.disc)}</td></tr>` : ''}${t.add ? `<tr><td colspan="${cs}">إضافة${inv.addNote ? ' — ' + esc(inv.addNote) : ''}</td><td>${fmt(t.add)}</td></tr>` : ''}<tr><td colspan="${cs}">الصافي (${esc(sym)})</td><td>${fmt(t.net)}</td></tr>
    ${inv.cur === 'fx' ? `<tr><td colspan="${cs}">المعادل بـ ${esc(db.settings.currencyName)}</td><td>${fmt(t.net * num(inv.rate))}</td></tr>` : ''}
    ${oldOn() ? `<tr><td colspan="${cs}">الصافي بالعملة القديمة</td><td>${oldAmt(t.net * docRate(inv))}</td></tr>` : ''}</tfoot></table>
    <div class="words">${esc(moneyWords(t.net, inv))}</div>
    ${inv.note ? `<p>ملاحظات: ${esc(inv.note)}</p>` : ''}<div class="psign"><span>توقيع المستلم</span><span>توقيع المحاسب</span></div>`;
}

/* تطبيع النص العربي للبحث: أ إ آ ← ا، ة ← ه، ى ← ي، وإزالة التشكيل */
const normAr = s => String(s || '').toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[٠-٩]/g, d => AR_DIG.indexOf(d)).trim();
const canVoice = () => 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;

V.invoice = (id, q, view) => {
  const orig = id === 'new' ? null : db.invoices.find(x => x.id === id);
  if (id !== 'new' && !orig) return go('#/invoices');
  const inv = orig ? clone(orig) : { id: null, type: INV_TYPES[q.type] ? q.type : 'sale', date: today(), pay: 'cash', cashAcc: isSeller() ? (myBox()?.id || '') : (cashAccounts()[0]?.id || ''), party: '', cur: 'base', rate: db.settings.rate || '', lines: [], discount: 0, note: '' };
  // مسودة الفاتورة الجديدة: بتنحفظ أول بأول حتى ما يضيع شي إذا انسكّر البرنامج أو عمل تحديث
  // الفاتورة الجديدة إلها مسودة، والفاتورة المحفوظة إلها مسودة تعديلات لحالها
  const DRAFT = orig ? 'daftar_draft_edit_' + orig.id : 'daftar_draft_' + inv.type;
  let draftPay = 0, restored = false;
  {
    try {
      let d = JSON.parse(localStorage.getItem(DRAFT) || 'null');
      // مسودة الفاتورة الجديدة بتنتسى بعد 3 ساعات (ما بتضل تطلع كل ما تفتح فاتورة)
      if (d && !orig && !(Date.now() - num(d.at) < 3 * 3600e3)) { localStorage.removeItem(DRAFT); d = null; }
      if (d && Array.isArray(d.lines) && d.lines.length) {
        Object.assign(inv, d.inv, { lines: d.lines.filter(l => db.items.some(x => x.id === l.item)) });
        draftPay = num(d.payment); restored = orig ? true : inv.lines.length > 0;
      }
    } catch (e) { /* */ }
  }
  const dropDraft = () => { try { localStorage.removeItem(DRAFT); } catch (e) { /* */ } };
  // منحجز رقم الفاتورة (ورقم سند الدفعة) من السيرفر من هلق، حتى الحفظ يكون فوري
  if (!orig) { const sfx = isSeller() ? '@' + myRep() : ''; reserveNo(inv.type + sfx); reserveNo((['sale', 'purchaseReturn'].includes(inv.type) ? 'receipt' : 'payment') + sfx); }
  // لمعرفة إذا في تغييرات على الفاتورة المحفوظة لسا ما انحفظت
  const sigOf = (lines, f) => JSON.stringify([lines.map(l => [l.item, num(l.qty), num(l.price), num(l.cp)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    f.date, f.pay, f.party || '', num(f.discount), num(f.addition), String(f.note || ''), f.pay === 'credit' ? num(f.payment) : 0]);
  const baseSig = orig ? sigOf(orig.lines, { ...orig, payment: db.vouchers.filter(v => v.inv === orig.id).reduce((x, v) => x + num(v.amount), 0) }) : '';
  inv.lines = inv.lines.filter(l => l.item);
  if (!inv.cur) inv.cur = 'base';
  if (!inv.rate) inv.rate = db.settings.rate || '';
  const sideSale = ['sale', 'saleReturn'].includes(inv.type);
  const wk = sideSale ? ensureWalkin() : null;
  const parties = sideSale ? [...(wk ? [wk] : []), ...customers().filter(a => a !== wk)] : suppliers();
  setTimeout(() => { const ps = $('[name=party]', view); if (ps) ps.dataset.kind = sideSale ? 'customers' : 'suppliers'; });
  const st = engine().stock;
  const items = [...db.items].sort(byCode);
  const itemById = id => items.find(x => x.id === id);
  const stockOf = it => (st[it.id] ? st[it.id].qty : num(it.openQty));

  view.innerHTML = head(INV_TYPES[inv.type] + (orig ? ` رقم ${orig.no}${repTag(orig)}` : ' جديدة' + (isSeller() ? ` — مندوب: ${myRep()}` : '')),
    `${orig ? `<button class="btn wa" data-act="wa">واتساب</button><button class="btn" data-act="receipt">🧾 إيصال</button><button class="btn" data-act="print">🖨 طباعة</button><button class="btn red" data-act="del">حذف</button><a class="btn" href="#/invoices">رجوع</a>` : ''}`) + `
  ${orig && q.saved ? `<div class="saved-ok">✅ الفاتورة رقم ${orig.no} محفوظة — ${orig.lines.length} مادة، ${fmt(orig.lines.reduce((s, l) => s + num(l.qty), 0))} قطعة</div>` : ''}
  <div class="inv-count-d">القطع: <b id="cntPcs">0</b></div>
  <div id="dirtyNote" class="dirty-note" hidden>⚠️ في تغييرات على هالفاتورة <b>لسا ما انحفظت</b> — كبّس «💾 حفظ التعديلات» تحت</div>
  ${restored ? (orig ? '<div class="draft-note">↩️ رجّعتلك التعديلات اللي ما كانت محفوظة على هالفاتورة. <button class="btn" data-act="discard">تراجع عنها</button></div>'
    : '<div class="draft-note">↩️ رجّعتلك الفاتورة اللي ما كانت محفوظة. <button class="btn red" data-act="clearAll">🗑 بلّش من جديد</button></div>') : ''}
  <div class="search-wrap">
    <div class="scan-row">
      ${canScan() ? '<button class="sq-btn" data-act="cam" title="مسح بالكاميرا">▮▯▮</button>' : ''}
      <input id="scanIn" type="search" enterkeyhint="search" autocomplete="off" placeholder="ادخل اسم المادة أو الباركود لإضافتها للفاتورة">
      ${canVoice() ? '<button class="sq-btn round" data-act="mic" title="بحث صوتي">🎤</button>' : ''}
    </div>
    <div id="sugg" class="sugg" hidden></div>
  </div>
  <div id="lastAdd" class="last-add" hidden></div>
  <div id="ln" class="ln-list"></div>
  <div class="card">
    <div class="grid4">
      ${field({ k: 'date', l: 'التاريخ', t: 'date', req: 1 }, inv.date)}
      ${field({ k: 'pay', l: 'طريقة الدفع', t: 'select', opts: [['cash', 'نقدي'], ['credit', 'آجل (على الحساب)']] }, inv.pay)}
      <div id="cashWrap">${field({ k: 'cashAcc', l: 'الصندوق', t: 'select', opts: accOpts(isSeller() ? [myBox()].filter(Boolean) : cashAccounts()) }, inv.cashAcc)}</div>
      ${field({ k: 'party', l: sideSale ? 'العميل' : 'المورد', t: 'select', opts: accOpts(parties, sideSale ? '— اختر العميل —' : '— بدون —') }, inv.party)}
      ${field({ k: 'cur', l: 'عملة الفاتورة', t: 'select', opts: curOpts() }, inv.cur)}
      <div id="rateWrap">${field({ k: 'rate', l: `سعر الصرف (${cur()} لكل 1 ${FX().sym})`, t: 'number' }, inv.rate)}</div>
    </div>
    ${!items.length ? `<p class="bad">لا توجد مواد. <a href="#/items">أضف مواد أولاً</a>.</p>` : ''}
  </div>
  <div class="card">
    <div class="inv-foot">
      ${field({ k: 'note', l: 'ملاحظات', t: 'textarea' }, inv.note)}
      <div class="tot-box">
        <div><span>الإجمالي</span><b id="tGross" class="n">0</b></div>
        <div><span>➖ حسم</span><input name="discount" type="number" step="any" inputmode="decimal" placeholder="0" value="${esc(inv.discount || '')}"></div>
        <div><span>➕ إضافة</span><input name="addition" type="number" step="any" inputmode="decimal" placeholder="0" value="${esc(inv.addition || '')}"></div>
        <input name="addNote" placeholder="سبب الإضافة/الحسم (أجور نقل…) — اختياري" value="${esc(inv.addNote || '')}" style="width:100%;font-size:13px">
        <div class="net"><span>الصافي</span><b id="tNet" class="n">0</b></div>
        <div id="tEq" class="muted" style="font-size:14px"></div>
        <div id="tOld" class="old-eq"></div>
        <small class="muted" id="tWords"></small>
        <div id="payRow"><span>💵 دفعة</span><input name="payment" type="number" step="any" inputmode="decimal" placeholder="0" value=""></div>
        <div id="tRest" class="old-eq"></div>
        <div id="tBal" class="old-eq"></div>
      </div>
    </div>
  </div>
  <div class="inv-bar">
    <div class="inv-bar-sum"><small id="barInfo"></small><small id="prnPill" class="prn-pill"></small><b id="barNet">0</b><small id="barOld" class="old-bar"></small></div>
    ${orig ? '' : '<button class="btn" data-act="saveNew">＋ حفظ وجديد</button>'}
    <button class="btn pri" data-act="save">${orig ? '💾 حفظ التعديلات' : '💾 حفظ'}</button>
    <button class="btn prt" data-act="savePrint">🖨 حفظ وطباعة</button>
  </div>`;

  const val = n => $(`[name="${n}"]`, view).value;
  const rate = () => num(val('rate'));
  const toggles = () => {
    const ps = $('[name=pay]', view), wkSel = sideSale && isWalkin(val('party'));
    if (wkSel && ps.value !== 'cash') ps.value = 'cash';
    const co = [...ps.options].find(o => o.value === 'credit'); if (co) co.disabled = wkSel;
    $('#cashWrap', view).style.visibility = val('pay') === 'cash' ? 'visible' : 'hidden';
    $('#payRow', view).style.display = $('#tRest', view).style.display = val('pay') === 'credit' ? '' : 'none';
    $('#rateWrap', view).style.visibility = inv.cur === 'fx' ? 'visible' : 'hidden';
  };
  const totals = () => {
    const g = inv.lines.reduce((s, l) => s + num(l.qty) * num(l.price), 0), n = g - num(val('discount')) + num(val('addition')), sym = docSym(inv);
    $('#tGross', view).textContent = fmt(g) + ' ' + sym; $('#tNet', view).textContent = fmt(n) + ' ' + sym;
    const eq = $('#tEq', view), R = inv.cur === 'fx' ? rate() : FX().rate;
    eq.textContent = !n || !R ? '' : inv.cur === 'fx' ? `المعادل: ${fmt(n * R)} ${cur()}` : `المعادل: ${fmt(n / R)} ${FX().sym}`;
    $('#tWords', view).textContent = n > 0 ? moneyWords(n, inv) : '';
    const nb = inv.cur === 'fx' ? n * rate() : n;
    $('#tOld', view).textContent = oldOn() && nb ? `الصافي بالعملة القديمة: ${oldAmt(nb)} ${cur()}` : '';
    $('#barOld', view).textContent = oldTxt(nb);
    const pv = num(val('payment')), tr = $('#tRest', view);
    if (tr) tr.textContent = pv ? `الباقي على الحساب: ${fmt(n - pv)} ${sym}${oldOn() ? ` — الدفعة بالقديم: ${oldAmt(pv)}` : ''}` : '';
    // رصيد الزبون الحالي وبعد الفاتورة (بالجديد والقديم)
    const tb = $('#tBal', view), pa = acc(val('party'));
    if (tb) {
      if (!pa || isWalkin(pa.id) || isSeller()) tb.innerHTML = '';
      else {
        const sg = ['sale', 'purchase'].includes(inv.type) ? 1 : -1;
        let cb = partyBal(pa);
        if (orig && orig.party === pa.id) {
          const op = db.vouchers.filter(v => v.inv === orig.id).reduce((x, v) => x + num(v.amount), 0);
          cb -= ((orig.pay === 'credit' ? invTotals(orig).net * docRate(orig) : 0) - op) * sg;
        }
        const paidS = val('pay') === 'credit' ? pv : nb, kamel = cb + nb * sg, after = kamel - paidS * sg;
        const o = x => (oldOn() ? ` <small>(بالقديم ${oldAmt(x)})</small>` : '');
        tb.innerHTML = `<table class="acc-sum">${oldOn() ? '<tr><th></th><th>جديد</th><th>قديم</th></tr>' : ''}` +
          [['مجموع الفاتورة', nb], ['الحساب القديم', cb], ['كامل الحساب', kamel], ['الدفعة', paidS], ['رصيد الحساب الحالي', after]]
            .map(([l, v], i) => `<tr class="${i === 4 ? 'last' : i === 2 ? 'mid' : ''}"><td>${l}</td><td class="n">${fmt(v)}</td>${oldOn() ? `<td class="n">${oldAmt(v)}</td>` : ''}</tr>`).join('') + '</table>';
      }
    }
    const cnt = inv.lines.reduce((s, l) => s + num(l.qty), 0);
    const fields = { date: val('date'), pay: val('pay'), cashAcc: val('cashAcc'), party: val('party'), cur: inv.cur, rate: val('rate'), discount: val('discount'), addition: val('addition'), addNote: val('addNote'), note: val('note') };
    const dirty = orig ? sigOf(inv.lines, { ...fields, payment: val('payment') }) !== baseSig : inv.lines.length > 0;
    if (orig) {
      $('#dirtyNote', view).hidden = !dirty;
      const ok = $('.saved-ok', view); if (ok && dirty) ok.hidden = true;
      $('[data-act=save]', view).classList.toggle('pulse', dirty);
    }
    {
      try {
        if (!dirty) localStorage.removeItem(DRAFT);
        else localStorage.setItem(DRAFT, JSON.stringify({ lines: inv.lines, payment: val('payment'), inv: fields, at: Date.now() }));
      } catch (e) { /* */ }
    }
    // عدد القطع: صغير فوق عاليسار (بشريط البرنامج)، وبالكمبيوتر جنب العنوان
    $('#cntPcs', view).textContent = fmt(cnt);
    const tc = $('#topCnt'); if (tc) { tc.hidden = false; tc.textContent = fmt(cnt) + ' قطعة'; }
    $('#barNet', view).textContent = fmt(n) + ' ' + sym;
    $('#barInfo', view).textContent = `${fmt(cnt)} قطعة${val('pay') === 'credit' ? ' — آجل' : ' — نقدي'}`;
  };
  const toBase = x => (inv.cur === 'fx' ? num(x) * rate() : num(x));
  const lineOld = l => (oldOn() && num(l.price) ? `بالقديم: الإفرادي ${oldAmt(toBase(l.price))} — الإجمالي ${oldAmt(toBase(num(l.qty) * num(l.price)))}${num(l.cp) ? ` — المستهلك ${oldAmt(toBase(l.cp))}` : ''}` : '');
  const lineHtml = (l, i) => {
    const it = itemById(l.item) || { name: '(مادة محذوفة)' };
    const s = it.id ? stockOf(it) : 0, low = it.id && (s <= 0 || (num(it.minQty) > 0 && s <= num(it.minQty)));
    return `<div class="ln-card" data-i="${i}">
      <div class="ln-head">
        <button class="qb" data-act="inc" data-id="${i}" aria-label="زيادة">＋</button>
        <button class="qb minus" data-act="dec" data-id="${i}" aria-label="إنقاص">−</button>
        <span class="ln-no">${i + 1}</span><b class="ln-name">${esc(it.name)}</b>
        ${it.id ? `<button class="qb edit" data-act="editItem" data-id="${i}" aria-label="تعديل المادة" title="تعديل المادة">✏️</button>` : ''}
        <button class="qb del" data-act="rmLine" data-id="${i}" aria-label="حذف">✕</button>
      </div>
      <div class="ln-row">
        <label><span>الكمية</span><input data-f="qty" type="number" step="any" inputmode="decimal" value="${esc(l.qty)}"></label>
        <label class="unit"><span>الوحدة</span><b>${esc(it.unit || '—')}</b></label>
        <label><span>الإفرادي</span><input data-f="price" type="number" step="any" inputmode="decimal" value="${esc(l.price)}"></label>
        <label><span>المستهلك</span><input data-f="cp" type="number" step="any" inputmode="decimal" value="${esc(l.cp ?? '')}"></label>
        <label class="tot"><span>الإجمالي</span><b data-tot>${fmt(num(l.qty) * num(l.price))}</b></label>
      </div>
      <small class="old-eq" data-old>${lineOld(l)}</small>
      ${it.id ? `<small class="${low ? 'bad' : 'muted'}">المتوفر: ${fmt(s)} ${esc(it.unit || '')}${low ? (s <= 0 ? ' — نفدت المادة' : ' — قاربت المادة على النفاد') : ''}</small>` : ''}
    </div>`;
  };
  const draw = hl => {
    // الأحدث فوق: آخر مادة انضافت بتطلع أول شي، والقديم بينزل لتحت
    $('#ln', view).innerHTML = inv.lines.length ? inv.lines.map(lineHtml).reverse().join('')
      : `<div class="empty card">ابحث عن مادة بالاسم أو امسح الباركود لإضافتها للفاتورة</div>`;
    totals();
    if (hl != null && hl >= 0) { const c = $(`.ln-card[data-i="${hl}"]`, view); if (c) c.classList.add('flash'); }
  };
  // شريط واضح تحت البحث: شو آخر شي انضاف، وإذا انضاف على مادة موجودة من قبل
  const noteAdd = (it, merged, q) => {
    const b = $('#lastAdd', view); if (!b) return;
    b.hidden = false; b.className = 'last-add' + (merged ? ' merged' : '');
    b.innerHTML = merged
      ? `⚠️ انضاف: <b>${esc(it.name)}</b> × ${fmt(q)} — <b>مكررة</b>، موجودة كمان بالسطر رقم ${merged}`
      : `✓ انضاف: <b>${esc(it.name)}</b> × ${fmt(q)} — صار المجموع <b>${fmt(inv.lines.reduce((s, l) => s + num(l.qty), 0))}</b> قطعة`;
  };
  // تحويل سعر من الليرة إلى عملة الفاتورة الحالية
  const toDoc = base => (inv.cur === 'fx' && rate() ? r2(base / rate()) : base);
  // سعر المبيع: آخر سعر بعناه لهالزبون بنفس المادة، وإذا ما في منرجع لسعر بطاقة المادة
  // سياسة التسعير: آخر سعر مبيع لهالزبون بهالمادة — وإذا ما في (أو «زبون عام») سعر بطاقة المادة
  // (مرتجع المبيع بياخد آخر سعر مبيع للزبون)
  const lastFor = (party, itemId) => {
    if (!sideSale || !party || isWalkin(party)) return 0;
    let best = null;
    for (const d of db.invoices) {
      if (d.type !== 'sale' || d.party !== party || (orig && d.id === orig.id)) continue;
      const l = d.lines.find(x => x.item === itemId); if (!l || !num(l.price)) continue;
      const k = (d.date || '') + String(d.created || 0).padStart(15, '0');
      if (!best || k > best.k) best = { k, p: num(l.price) * docRate(d) };
    }
    return best ? r2(best.p) : 0;
  };
  const basePrice = it => (sideSale ? (lastFor(val('party'), it.id) || num(it.sellPrice)) : (num(it.buyPrice) || r2(st[it.id]?.avg || 0)));
  // إضافة مادة: إذا كانت موجودة بالفاتورة تزيد الكمية
  // lastBase: كم كان عدد المادة قبل آخر إضافة — حتى «عدد 2» بعد تكرار الصنف تنضاف على القديم وما تمسحه
  let lastId = null, lastBase = 0;
  // فاتورة المبيع: لازم تختار العميل قبل ما تنزل أي مادة
  const needParty = () => sideSale && !val('party');
  let picking = false;
  const pickParty = then => {
    if (picking) return; picking = true;
    const list = parties;
    modal('👤 اختار العميل أولاً', `<input class="search" id="ppQ" placeholder="🔎 ابحث بالاسم أو الهاتف" autocomplete="off" style="margin-bottom:8px">
      <div id="ppList" class="pp-list">${list.map(a => `<button type="button" class="pp-item${isWalkin(a.id) ? ' wk' : ''}" data-id="${a.id}" data-name="${esc(normAr((a.name || '') + ' ' + (a.phone || '')))}"><b>${esc(a.name)}</b>${isWalkin(a.id) ? '<small>نقدي — بيع مباشر</small>' : a.phone ? `<small>${esc(a.phone)}</small>` : ''}</button>`).join('') || '<p class="muted">ما في عملاء — ضيفهم من صفحة العملاء</p>'}</div>`);
    const d = $('#dlg'), q = $('#ppQ', d);
    const done = () => { picking = false; d.removeEventListener('close', done); };
    d.addEventListener('close', done);
    q.oninput = () => { const t = normAr(q.value.trim()); $$('.pp-item', d).forEach(b => (b.style.display = !t || b.dataset.name.includes(t) ? '' : 'none')); };
    q.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const f = $$('.pp-item', d).find(b => b.style.display !== 'none'); if (f) f.click(); } };
    $('#ppList', d).onclick = e => {
      const b = e.target.closest('.pp-item'); if (!b) return;
      const sel = $('[name="party"]', view);
      if (![...sel.options].some(o => o.value === b.dataset.id)) sel.add(new Option(accName(b.dataset.id), b.dataset.id));
      sel.value = b.dataset.id; sel.dispatchEvent(new Event('change', { bubbles: true }));
      d.close(); toast('👤 ' + accName(b.dataset.id));
      if (then) setTimeout(then, 50);
    };
    setTimeout(() => q.focus(), 100);
  };
  const addItem = it => {
    if (needParty()) { scanIn.value = ''; sugg.hidden = true; return pickParty(() => addItem(it)); }
    lastId = it.id;
    // الصنف المكرر بينضاف بسطر جديد لحاله (ما بيندمج مع القديم)
    const ex = inv.lines.find(l => l.item === it.id);
    lastBase = 0;
    inv.lines.push({ item: it.id, qty: 1, price: toDoc(basePrice(it)), cp: it.consumerPrice ? toDoc(num(it.consumerPrice)) : '' });
    draw(inv.lines.length - 1);
    navigator.vibrate?.(ex ? [40, 60, 40] : 40);
    noteAdd(it, ex ? inv.lines.indexOf(ex) + 1 : 0, 1); toast((ex ? '⚠️ ' : '✓ ') + it.name + (ex ? ' — مكررة بسطر جديد' : ''), !!ex);
  };
  let payNow = 0;
  if (orig) payNow = db.vouchers.filter(v => v.inv === orig.id).reduce((x, v) => x + num(v.amount), 0);
  const showPay = () => { $('[name=payment]', view).value = payNow || ''; if (payNow && val('pay') !== 'credit') { $('[name=pay]', view).value = 'credit'; toggles(); } totals(); };
  const fromPaste = r => {
    if (!r.party && needParty()) return pickParty(() => fromPaste(r));
    if (r.party) {
      const sel = $('[name="party"]', view);
      if (![...sel.options].some(o => o.value === r.party)) sel.add(new Option(accName(r.party), r.party));
      sel.value = r.party; $('[name="pay"]', view).value = sideSale && isWalkin(r.party) ? 'cash' : 'credit'; toggles();
    }
    let hl = null;
    r.lines.forEach(({ item, qty }) => {
      lastId = item;
      const it = db.items.find(x => x.id === item); if (!it) return;
      const ex = inv.lines.find(l => l.item === item);
      lastBase = 0;
      inv.lines.push({ item, qty, price: toDoc(basePrice(it)), cp: it.consumerPrice ? toDoc(num(it.consumerPrice)) : '' });
      if (r.lines.length === 1) { hl = inv.lines.length - 1; noteAdd(it, ex ? inv.lines.indexOf(ex) + 1 : 0, qty); }
    });
    payNow = r.pay || 0; showPay(); draw(hl);
    if (r.lines.length > 1 || r.skipped) toast(`انضاف ${r.lines.length} مادة${r.skipped ? ` — ${r.skipped} سطر ما انضاف` : ''}`);
  };
  const addByCode = code => { const it = findByCode(code); if (it) addItem(it); else toast('لا توجد مادة بهذا الباركود: ' + code, 1); };

  /* ---- البحث مع الاقتراحات ---- */
  const scanIn = $('#scanIn', view), sugg = $('#sugg', view);
  let matches = [];
  const search = txt => {
    const qn = normAr(txt);
    if (!qn) return [];
    // كل كلمة لازم تكون بالاسم (حتى لو بلا فراغات: «12ق» = «12 ق»)، والأقرب بيطلع أول — ومنعرض لحد 40 نتيجة مش 8
    const words = qn.split(/\s+/), qc = qn.replace(/\s+/g, ''), code = txt.trim();
    const out = [];
    for (const it of items) {
      const nm = normAr(it.name), nc = nm.replace(/\s+/g, '');
      let sc = -1;
      if (code && itemCodes(it).some(c => c.startsWith(code))) sc = itemCodes(it).includes(code) ? 1000 : 500;
      else if (words.every(w => nm.includes(w) || nc.includes(w))) {
        sc = 0;
        if (nm === qn || nc === qc) sc += 400;
        else if (nm.startsWith(qn) || nc.startsWith(qc)) sc += 200;
        else if (nm.includes(qn) || nc.includes(qc)) sc += 100;
        const nw = nm.split(/\s+/);
        words.forEach(w => { if (nw.some(x => x.startsWith(w))) sc += 10; });
      }
      if (sc >= 0) out.push([sc, nm.length, it]);
    }
    return out.sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, 40).map(x => x[2]);
  };
  const showSugg = () => {
    matches = search(scanIn.value);
    if (!scanIn.value.trim()) { sugg.hidden = true; return; }
    sugg.hidden = false; requestAnimationFrame(fitSugg);
    sugg.innerHTML = matches.length ? matches.map((it, i) => {
      const s = stockOf(it), low = s <= 0 || (num(it.minQty) > 0 && s <= num(it.minQty));
      return `<button type="button" class="sg" data-i="${i}">
        <b>${esc(it.name)}</b>
        <span class="sg-meta"><span>💰 ${fmt(toDoc(basePrice(it)))}${oldOn() ? ` <small class="muted">(${oldAmt(basePrice(it))} قديم)</small>` : ''}${sideSale && lastFor(val('party'), it.id) ? ' <small class="muted">· آخر سعر إله</small>' : ''}</span><span class="${s <= 0 ? 'bad' : ''}">📦 ${fmt(s)} ${esc(it.unit || '')}</span></span>
        ${low ? `<small class="bad">${s <= 0 ? 'نفدت المادة' : 'قاربت المادة على النفاد'}</small>` : ''}
      </button>`;
    }).join('') + newBtn() : smartHtml() + newBtn();
  };
  // ➕ مادة جديدة من نفس البحث: «اسم المادة» أو «اسم المادة عدد 3»
  const newSplit = t => { const m = String(t).trim().match(/^(.*?)\s*عدد\s*(\d+(?:\.\d+)?)\s*$/); return m ? { name: m[1].trim(), qty: +m[2] } : { name: String(t).trim(), qty: 1 }; };
  const newBtn = () => {
    const { name } = newSplit(scanIn.value);
    if (!name || /^\d+$/.test(name) || db.items.some(x => normAr(x.name) === normAr(name))) return '';
    return `<button type="button" class="sg sg-new" data-new="1"><b>➕ مادة جديدة: «${esc(name)}»</b><small class="muted">بتنضاف عالمواد وعالفاتورة فوراً</small></button>`;
  };
  const quickNew = () => {
    if (isSeller()) { sugg.hidden = true; return toast('🔒 إضافة مواد جديدة مسكّرة بوضع البيّاع — خلّي المدير يضيفها', 1); }
    const { name, qty } = newSplit(scanIn.value); sugg.hidden = true;
    const pk = sideSale ? 'sellPrice' : 'buyPrice';
    modal('➕ مادة جديدة', fields([
      { k: 'name', l: 'اسم المادة', req: 1, full: 1 },
      { k: 'price', l: sideSale ? 'سعر المبيع' : 'سعر الشراء', t: 'number' },
      { k: 'other', l: sideSale ? 'سعر الشراء' : 'سعر المبيع', t: 'number' },
      { k: 'consumerPrice', l: 'سعر المستهلك', t: 'number' },
      { k: 'unit', l: 'الوحدة' }, { k: 'qty', l: 'العدد بالفاتورة', t: 'number' },
    ], { name, unit: 'قطعة', qty }), {
      saveText: '➕ إضافة',
      onSave: d => {
        const nm = d.name.trim(); if (!nm) return false;
        if (db.items.some(x => normAr(x.name) === normAr(nm))) { toast('في مادة بنفس الاسم', 1); return false; }
        const R = inv.cur === 'fx' && rate() ? rate() : 1;
        const it = { id: uid(), code: nextItemCode(), barcodes: [], aliases: [], aliasKeys: [], group: null, name: nm, unit: (d.unit || '').trim(), minQty: 0,
          buyPrice: 0, sellPrice: 0, consumerPrice: r2(num(d.consumerPrice) * R), openQty: 0, openCost: 0 };
        it[pk] = r2(num(d.price) * R);
        it[sideSale ? 'buyPrice' : 'sellPrice'] = r2(num(d.other) * R);
        fillPrices(it);
        if (priceBad(it.sellPrice, it.buyPrice)) { toast(priceBadMsg('', it.sellPrice, it.buyPrice), 1); return false; }
        db.items.push(it); items.push(it); save();
        scanIn.value = '';
        fromPaste({ party: '', lines: [{ item: it.id, qty: num(d.qty) || 1 }], pay: payNow });
        toast('✅ انضافت المادة: ' + nm);
        setTimeout(() => scanIn.focus(), 300);
      },
    });
    setTimeout(() => { const pi = $('#dlg [name=price]'); if (pi) pi.focus(); }, 80);
  };
  // بحث ذكي: «بسكوت الالف 12 قطعه عدد 3» ← يفهم الأرقام والتعبئة والتسميات المحفوظة
  let smartRes = null;
  const smart = txt => {
    if (!window.OrderPaste || !window.Voice) return null;
    const line = OrderPaste.parseLine(Voice.spokenNums(txt));
    if (!line || line.kind === 'pay') return null;
    OrderPaste.reset();
    const ln = OrderPaste.asItem(line);
    return { ln, qty: line.qty || 1, m: OrderPaste.best(ln, items) };
  };
  const smartHtml = () => {
    smartRes = smart(scanIn.value);
    const it = smartRes && smartRes.m.it && !smartRes.m.weak ? smartRes.m.it : null;
    return `${it ? `<button type="button" class="sg" data-smart="1"><b>🤖 قصدك: ${esc(it.name)} × ${fmt(smartRes.qty)}</b><span class="sg-meta"><span>💰 ${fmt(toDoc(basePrice(it)))}</span><span>📦 ${fmt(stockOf(it))}</span></span></button>` : '<div class="muted" style="padding:10px 12px">ما لقيت مادة بهالاسم</div>'}
      <button type="button" class="sg" data-teach="1"><b>❓ ${it ? 'لأ مو هي، ' : ''}علّمني شو هي</b><small class="muted">بتختارها مرة وبحفظ هالتسمية</small></button>`;
  };
  const addSmart = it => { const q = smartRes ? smartRes.qty : 1; const txt = scanIn.value; scanIn.value = ''; sugg.hidden = true; fromPaste({ party: '', lines: [{ item: it.id, qty: q }], pay: payNow }); toast(`✓ ${it.name} × ${fmt(q)}`); return txt; };
  const teach = () => { const r = smartRes || smart(scanIn.value); const raw = scanIn.value.trim(); if (!r) return; sugg.hidden = true; Voice.askItem(r.ln, raw.replace(/\s*عدد.*$/, '')).then(it => { if (it) { smartRes = r; addSmart(it); } }); };
  const pick = it => { scanIn.value = ''; sugg.hidden = true; addItem(it); scanIn.focus(); };
  // الكبس على اقتراح ما بيشيل التركيز عن البحث — هيك الكيبورد بيضل مفتوح للمادة الجاية
  sugg.addEventListener('mousedown', e => e.preventDefault());
  // أزرار ＋ − ✕ ما بتشيل التركيز (الكيبورد بيضل متل ما هو)
  view.addEventListener('mousedown', e => { if (e.target.closest('.ln-card .qb')) e.preventDefault(); });
  // تثبيت الصفحة عالمادة يلي عم تعدّلها: لما تكبس ＋ − أو تغيّر العدد والكيبورد مفتوح ما بتنط الصفحة لفوق
  let lineActAt = 0;
  const anchorCard = card => {
    if (!card) return;
    lineActAt = Date.now();
    const top0 = card.getBoundingClientRect().top;
    const fix = () => { if (!card.isConnected) return; const d = card.getBoundingClientRect().top - top0; if (Math.abs(d) > 2) window.scrollBy(0, d); };
    requestAnimationFrame(fix); [120, 300, 600, 900].forEach(t => setTimeout(fix, t));
  };
  view.addEventListener('pointerdown', e => { const c = e.target.closest('.ln-card'); if (c && e.target.closest('.qb:not(.edit), input')) lineActAt = Date.now(); }, true);
  // أزرار + و − بالمادة: ما منخلّي الكبسة تنقل التركيز (الكيبورد بيتسكّر بهدوء)،
  // وإذا الموبايل نطّ بالصفحة لفوق خلال ثانيتين منرجّعها لنفس المكان
  view.addEventListener('pointerdown', e => {
    const b = e.target.closest('.ln-card .qb:not(.edit)'); if (!b) return;
    e.preventDefault();
    const ae = document.activeElement; if (ae && ae !== document.body && ae.matches('input, textarea, select')) ae.blur();
    const y0 = window.scrollY; if (y0 < 250) return;
    const until = Date.now() + 2000;
    const guard = () => {
      if (Date.now() > until) return window.removeEventListener('scroll', guard);
      if (window.scrollY < y0 - 200) window.scrollTo(0, y0);
    };
    window.addEventListener('scroll', guard, { passive: true });
    [150, 400, 800, 1300, 1900].forEach(t => setTimeout(guard, t));
    setTimeout(() => window.removeEventListener('scroll', guard), 2100);
  }, true);
  // لما تكبس على خانة رقم (كمية، سعر) بيتحدّد الرقم كله — بتكتب الجديد دغري بداله
  view.addEventListener('focusin', e => {
    const t = e.target; if (!t.matches || !t.matches('.ln-card input[type=number]')) return;
    setTimeout(() => { try { t.select(); } catch (er) { /* */ } }, 30);
  });
  scanIn.addEventListener('input', showSugg);
  // قائمة الاقتراحات ما لازم تنزل تحت الكيبورد: منطلّع البحث لفوق ومنحدد طول القائمة حسب المساحة الظاهرة
  function fitSugg() {
    if (!view.contains(sugg) || sugg.hidden) return;
    const vv = window.visualViewport, bottom = vv ? vv.height + vv.offsetTop : window.innerHeight;
    sugg.style.maxHeight = Math.max(140, bottom - sugg.getBoundingClientRect().top - 8) + 'px';
  }
  const toTop = () => {
    if (!view.contains(scanIn)) return;
    const tb = $('.top'), off = tb && getComputedStyle(tb).display !== 'none' ? tb.offsetHeight : 0;
    window.scrollTo({ top: Math.max(0, $('.search-wrap', view).getBoundingClientRect().top + window.scrollY - off - 6) });
    fitSugg();
  };
  // وقت الكتابة منخبّي شريط المجموع تحت حتى ما يغطّي الاقتراحات
  // (بس طول ما قائمة الاقتراحات ظاهرة — أول ما تختفي برجع الشريط وزر الحفظ)
  new MutationObserver(() => view.classList.toggle('typing', !sugg.hidden)).observe(sugg, { attributes: true, attributeFilter: ['hidden'] });
  // منطلّع البحث لفوق بس إذا إنت كبست عالبحث — مش إذا كنت عم تعدّل عدد مادة
  const toTopSafe = () => { if (Date.now() - lineActAt > 1500) toTop(); };
  // الكيبورد مفتوح على البحث (الخانة ثابتة فوق) وبلّشت تنزل بإصبعك: منسكّر الكيبورد هلق
  // — هيك لما تكبس + تحت ما بيرجع الموبايل يطلّعك لخانة البحث فوق
  const blurOnScroll = () => {
    if (!view.contains(scanIn)) return window.removeEventListener('touchmove', blurOnScroll);
    if (document.activeElement === scanIn && sugg.hidden) scanIn.blur();
  };
  window.addEventListener('touchmove', blurOnScroll, { passive: true });
  scanIn.addEventListener('focus', () => { if (Date.now() - lineActAt < 1500) return; setTimeout(toTopSafe, 300); setTimeout(toTopSafe, 700); });
  if (window.visualViewport) {
    const onVV = () => { if (!view.contains(scanIn)) return window.visualViewport.removeEventListener('resize', onVV); fitSugg(); };
    window.visualViewport.addEventListener('resize', onVV);
  }
  scanIn.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const c = scanIn.value.trim(); if (!c) return;
    const qm = window.Voice && normAr(Voice.spokenNums(c)).match(/^(?:عدد|العدد|كميه)\s*(\d+(?:\.\d+)?)$/);
    if (qm) { const it = InvHook.setQty(+qm[1]); scanIn.value = ''; sugg.hidden = true; return it ? toast(it.base ? `⚠️ ${it.name}: ${fmt(it.base)} + ${fmt(+qm[1])} = ${fmt(it.total)}` : `✓ ${it.name} × ${fmt(+qm[1])}`) : toast('ما في مادة بالفاتورة', 1); }
    // «اسم المادة كامل + رقم» (حتى لو بالاسم أرقام متل بسكوت 1000 دبل 3) — الرقم الأخير هو العدد
    const nm = c.match(/^(.+?)\s+(?:عدد\s*)?(\d+(?:\.\d+)?)$/);
    const byName = nm && db.items.find(x => normAr(x.name) === normAr(nm[1]));
    if (byName && !findByCode(c) && !db.items.some(x => normAr(x.name) === normAr(c))) {
      fromPaste({ party: '', lines: [{ item: byName.id, qty: +nm[2] }], pay: payNow });
      scanIn.value = ''; sugg.hidden = true; scanIn.focus(); return;
    }
    const exact = findByCode(c);
    if (exact) pick(exact);
    else if (matches.length === 1) pick(matches[0]);
    else if (matches.length > 1) { sugg.hidden = false; toast(`في ${matches.length} مواد بهالاسم — اختار وحدة من القائمة`, 1); }
    else if (!matches.length) {
      smartRes = smart(c);
      if (smartRes && smartRes.m.it && smartRes.m.sure) addSmart(smartRes.m.it);
      else if (smartRes && smartRes.m.it && !smartRes.m.weak) showSugg();
      else if (smartRes && !/^\d+$/.test(c)) teach();
      else { toast('لا توجد مادة بهذا الاسم أو الباركود: ' + c, 1); scanIn.value = ''; sugg.hidden = true; }
    }
    scanIn.focus(); // لقارئ الباركود: يبقى المؤشر جاهزاً للمسحة التالية
  });
  sugg.addEventListener('click', e => {
    const b = e.target.closest('.sg'); if (!b) return;
    if (b.dataset.smart) return addSmart(smartRes.m.it);
    if (b.dataset.teach) return teach();
    if (b.dataset.new) return quickNew();
    pick(matches[+b.dataset.i]);
  });
  const outside = e => { if (!view.contains(scanIn)) return document.removeEventListener('click', outside); if (!e.target.closest('.search-wrap')) sugg.hidden = true; };
  document.addEventListener('click', outside);

  /* ---- البحث الصوتي ---- */
  const voice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR(); r.lang = 'ar-SY'; r.interimResults = false; r.maxAlternatives = 1;
    toast('🎤 احكِ اسم المادة…');
    r.onresult = ev => { scanIn.value = ev.results[0][0].transcript; showSugg(); scanIn.focus(); };
    r.onerror = () => toast('تعذّر التعرف على الصوت', 1);
    r.start();
  };

  view.oninput = e => {
    const card = e.target.closest('.ln-card');
    if (card && e.target.dataset.f) {
      lineActAt = Date.now();
      const l = inv.lines[card.dataset.i]; l[e.target.dataset.f] = e.target.value;
      $('[data-tot]', card).textContent = fmt(num(l.qty) * num(l.price)); $('[data-old]', card).textContent = lineOld(l); totals();
    } else if (e.target.name === 'payment') { payNow = num(e.target.value); totals(); }
    else if (['discount', 'addition', 'rate'].includes(e.target.name)) totals();
    else if (e.target.name === 'party') totals();
  };
  view.onchange = e => {
    if (e.target.name === 'pay') {
      if (e.target.value === 'credit' && sideSale && isWalkin(val('party'))) toast('«زبون عام» دايماً نقدي — للآجل اختار اسم الزبون', 1);
      toggles(); totals();
    }
    else if (e.target.name === 'party' && sideSale) {
      if (isWalkin(e.target.value)) { const wasCredit = val('pay') !== 'cash'; toggles(); totals(); if (wasCredit) toast('«زبون عام» = نقدي'); }
      // زبون باسمه: آجل افتراضياً (وفيك ترجّعه نقدي من «طريقة الدفع»)
      else if (e.target.value) { $('[name=pay]', view).value = 'credit'; toggles(); totals(); }
      else toggles();
      if (!inv.lines.length) return;
      let n = 0;
      inv.lines.forEach(l => { const it = db.items.find(x => x.id === l.item); if (!it) return; const np = toDoc(basePrice(it)); if (np && np !== num(l.price)) { l.price = np; n++; } });
      if (n) { draw(); toast(`💰 تغيّر سعر ${n} مادة حسب ${e.target.value && !isWalkin(e.target.value) ? 'آخر بيع لـ' + accName(e.target.value) : 'بطاقة المادة'}`); }
    }
    else if (e.target.name === 'cur') {
      const to = e.target.value, R = rate();
      if (to === 'fx' && !R) { toast('أدخل سعر الصرف أولاً (من الإعدادات أو من الرئيسية)', 1); }
      if (R && to !== inv.cur && inv.lines.some(l => num(l.price)) && confirm('تحويل الأسعار المدخلة إلى العملة الجديدة حسب سعر الصرف؟')) {
        const c = x => (num(x) ? r2(to === 'fx' ? num(x) / R : num(x) * R) : x);
        inv.lines.forEach(l => { l.price = c(l.price); l.cp = c(l.cp); });
        ['discount', 'addition'].forEach(k => { const d = $(`[name=${k}]`, view); d.value = c(d.value) || ''; });
      }
      inv.cur = to; toggles(); draw();
    }
  };
  let savedAt = 0, skipStock = false;
  const doSave = (andNew, print) => {
    if (Date.now() - savedAt < 2000) return; // منع الحفظ المكرر بكبستين ورا بعض
    const lines = inv.lines.filter(l => l.item && num(l.qty) > 0).map(l => ({ item: l.item, qty: num(l.qty), price: num(l.price), cp: num(l.cp) }));
    if (!lines.length) return toast('أضف مادة واحدة على الأقل بكمية صحيحة', 1);
    const pay = val('pay'), party = val('party'), cashAcc = val('cashAcc');
    if (sideSale && !party) { const ps = $('[name=party]', view); ps.focus(); ps.scrollIntoView({ block: 'center' }); return toast(`لازم تختار اسم العميل قبل الحفظ (للبيع المباشر اختار «${WALKIN_NAME}»)`, 1); }
    if (sideSale && isWalkin(party) && pay !== 'cash') return toast(`«${WALKIN_NAME}» دايماً نقدي — ما بينفع آجل`, 1);
    if (pay === 'credit' && !party) return toast(`الفاتورة الآجلة تحتاج ${sideSale ? 'عميلاً' : 'مورداً'}`, 1);
    if (isSeller() && (pay === 'cash' || num(val('payment')) > 0) && !myBox()) return toast(NO_BOX, 1);
    if (pay === 'cash' && !cashAcc) return toast('اختر الصندوق', 1);
    if (!val('date')) return toast('أدخل التاريخ', 1);
    if (inv.cur === 'fx' && rate() <= 0) return toast('أدخل سعر الصرف للفاتورة', 1);
    // سعر المبيع ما بيزيد أكتر من 10٪ عن سعر المبيع ببطاقة المادة
    if (inv.type === 'sale') {
      const bad = inv.lines.findIndex(l => {
        const it = l.item && num(l.qty) > 0 && db.items.find(x => x.id === l.item), sp = it ? num(it.sellPrice) : 0;
        // آخر سعر بعناه لهالزبون مقبول دايماً (سياسة التسعير حسب الزبون)
        const lp = it ? lastFor(party, it.id) : 0;
        if (lp && toBase(l.price) <= lp + 0.001) return false;
        return sp > 0 && toBase(l.price) > r2(sp * (1 + MAX_UP)) + 0.001;
      });
      if (bad >= 0) {
        const l = inv.lines[bad], it = db.items.find(x => x.id === l.item);
        const card = $(`.ln-card[data-i="${bad}"]`, view);
        if (card) { card.scrollIntoView({ block: 'center' }); card.classList.add('ln-bad'); setTimeout(() => card.classList.remove('ln-bad'), 4000); }
        return toast(`يجب تعديل سعر مبيع المادة أولاً: ${it.name} — سعرها بالبطاقة ${fmt(num(it.sellPrice))}، وأعلى سعر مسموح ${fmt(r2(num(it.sellPrice) * (1 + MAX_UP)))}`, 1);
      }
    }
    // الكمية بالمستودع ما بتكفي: تنبيه واضح وبتقرر (ما منمنع — ممكن البضاعة موجودة وفاتورة شرائها لسا ما انسجّلت)
    if (['sale', 'purchaseReturn'].includes(inv.type) && !skipStock) {
      const need = {}, back = {};
      lines.forEach(l => { need[l.item] = (need[l.item] || 0) + l.qty; });
      if (orig && ['sale', 'purchaseReturn'].includes(orig.type)) orig.lines.forEach(l => { back[l.item] = (back[l.item] || 0) + num(l.qty); });
      const short = Object.keys(need).map(id => {
        const it = itemById(id); if (!it) return null;
        const av = r2(stockOf(it) + (back[id] || 0));
        return need[id] > av + 1e-9 ? { it, need: need[id], av } : null;
      }).filter(Boolean);
      if (short.length) {
        modal('⚠️ الكمية بالمستودع ما بتكفي', `<p class="muted">هالمواد كميتها بالفاتورة أكتر من الموجود. إذا كمّلت، المستودع بيصير بالسالب والكلفة والأرباح بتطلع تقريبية لحتى تسجّل فاتورة الشراء.</p>
          <table class="acc-sum"><tr><th>المادة</th><th>بالفاتورة</th><th>الموجود</th></tr>${short.map(x => `<tr><td>${esc(x.it.name)}</td><td class="n">${fmt(x.need)}</td><td class="n bad">${fmt(x.av)}</td></tr>`).join('')}</table>`, {
          saveText: 'احفظ هيك', onSave: () => { skipStock = true; setTimeout(() => doSave(andNew, print), 0); },
        });
        return;
      }
    }
    skipStock = false;
    // مواد بلا سعر مبيع ببطاقتها: بياخد سعرها من فاتورة الزبون (وسعر الشراء = المبيع − 20٪ إذا ناقص)
    if (inv.type === 'sale') {
      const badI = inv.lines.findIndex(l => {
        const it = l.item && num(l.qty) > 0 && db.items.find(x => x.id === l.item); if (!it) return false;
        const t = { sellPrice: it.sellPrice, buyPrice: it.buyPrice }; fillPrices(t, toBase(l.price));
        return priceBad(t.sellPrice, t.buyPrice);
      });
      if (badI >= 0) {
        const l = inv.lines[badI], it = db.items.find(x => x.id === l.item), t = { sellPrice: it.sellPrice, buyPrice: it.buyPrice }; fillPrices(t, toBase(l.price));
        const card = $(`.ln-card[data-i="${badI}"]`, view);
        if (card) { card.scrollIntoView({ block: 'center' }); card.classList.add('ln-bad'); setTimeout(() => card.classList.remove('ln-bad'), 4000); }
        return toast(priceBadMsg(it.name, t.sellPrice, t.buyPrice) + ' — كبّس ✏️ جنب المادة', 1);
      }
      lines.forEach(l => { const it = db.items.find(x => x.id === l.item); if (it) fillPrices(it, toBase(l.price)); });
    }
    const out = { ...inv, date: val('date'), pay, party, cashAcc: pay === 'cash' ? cashAcc : '', cur: inv.cur, rate: inv.cur === 'fx' ? rate() : '', discount: num(val('discount')), addition: num(val('addition')), addNote: val('addNote').trim(), note: val('note'), lines };
    if (!orig) {
      // فواتير المندوب: معزولة بترقيم لحالها واسمه عليها
      if (isSeller()) out.rep = myRep();
      delete out.nl; out.id = uid(); Object.assign(out, newNo(out.type + (out.rep ? '@' + out.rep : ''))); out.created = Date.now(); db.invoices.push(out);
    }
    else {
      // منلاقي الفاتورة برقمها (id) مش بالكائن — حتى لو المزامنة جدّدتها بالخلفية ما يضيع الحفظ
      const ix = db.invoices.findIndex(x => x.id === orig.id);
      if (ix >= 0) db.invoices[ix] = out; else db.invoices.push(out);
    }
    // الدفعة مع الفاتورة = سند قبض/دفع مربوط فيها
    const pv = pay === 'credit' && party ? r2(num(val('payment'))) : 0;
    const linked = db.vouchers.filter(v => v.inv === out.id);
    if (pv > 0) {
      const vt = ['sale', 'purchaseReturn'].includes(out.type) ? 'receipt' : 'payment';
      const o = { date: out.date, acc: party, amount: pv, note: `دفعة على ${INV_TYPES[out.type]} رقم ${out.no}`, cur: 'base', rate: '' };
      if (linked[0]) Object.assign(linked[0], o, { type: vt });
      else db.vouchers.push({ id: uid(), type: vt, ...newNo(vt + (out.rep ? '@' + out.rep : '')), cashAcc: (isSeller() ? myBox()?.id : null) || cashAccounts()[0]?.id || 'cash', created: Date.now() + 1, inv: out.id, ...(out.rep ? { rep: out.rep } : {}), ...o });
    }
    const keep = pv > 0 ? linked[0] : null;
    if (linked.some(v => v !== keep)) db.vouchers = db.vouchers.filter(v => v.inv !== out.id || v === keep);
    savedAt = Date.now();
    dropDraft();
    // سعر المستهلك ثابت للكل: أي تعديل عليه بالفاتورة بينحفظ ببطاقة المادة
    lines.forEach(l => { const it = db.items.find(x => x.id === l.item); if (it && num(l.cp)) { const b = r2(num(l.cp) * docRate(out)); if (b !== num(it.consumerPrice)) it.consumerPrice = b; } });
    save(); navigator.vibrate?.([60, 40, 60]); toast(`✅ انحفظت الفاتورة رقم ${out.no} — ${lines.length} مادة`);
    // حفظ وطباعة ← منرجع عالرئيسية | حفظ / حفظ التعديلات ← منضل بنفس الفاتورة وبنفس المكان
    if (print) go('#/');
    else if (andNew) go('#/invoice/new?type=' + out.type);
    else { keepScrollY = window.scrollY; go('#/invoice/' + out.id + '?saved=1'); }
    if (print && window.Receipt) Receipt.printDirect(out);
  };
  const step = (i, d) => {
    const l = inv.lines[+i]; const nq = r2(num(l.qty) + d);
    if (nq <= 0) { inv.lines.splice(+i, 1); draw(); return; }
    l.qty = nq;
    const card = $(`.ln-card[data-i="${i}"]`, view);
    anchorCard(card);
    $('[data-f=qty]', card).value = nq; $('[data-tot]', card).textContent = fmt(nq * num(l.price)); $('[data-old]', card).textContent = lineOld(l); totals();
  };
  onAct(view, {
    cam: () => scanBarcode(addByCode),
    paste: () => window.OrderPaste && OrderPaste.open({ sideSale, onDone: fromPaste }),
    mic: () => (window.Voice ? Voice.listen() : voice()),
    inc: i => step(i, 1),
    dec: i => step(i, -1),
    rmLine: i => { inv.lines.splice(+i, 1); draw(); },
    // ✏️ تعديل بطاقة المادة من جوّا الفاتورة — بلا ما نطلع منها ولا تضيع المواد
    editItem: i => {
      const l = inv.lines[+i], it = l && db.items.find(x => x.id === l.item); if (!it) return;
      const old = { sellPrice: num(it.sellPrice), buyPrice: num(it.buyPrice), consumerPrice: num(it.consumerPrice) };
      itemForm(it, null, () => {
        const pk = sideSale ? 'sellPrice' : 'buyPrice', pc = num(it[pk]) !== old[pk], cc = num(it.consumerPrice) !== old.consumerPrice;
        inv.lines.forEach(x => {
          if (x.item !== it.id) return;
          if (pc && num(it[pk])) x.price = toDoc(num(it[pk]));
          if (cc) x.cp = num(it.consumerPrice) ? toDoc(num(it.consumerPrice)) : '';
        });
        items.sort(byCode); draw(+i);
      });
    },
    discard: () => { dropDraft(); route(); },
    clearAll: () => { if (inv.lines.length && !confirm('تفريغ الفاتورة ومسح كل المواد اللي فيها؟')) return; dropDraft(); inv.lines = []; route(); },
    save: () => doSave(false),
    saveNew: () => doSave(true),
    savePrint: () => doSave(false, true),
    print: () => printDoc(invoiceHtml(orig)),
    wa: () => waSend(acc(orig.party), waInvoiceText(orig)),
    receipt: () => window.Receipt && Receipt.open(orig),
    del: () => { if (isSeller()) return toast('🔒 الحذف مسكّر بوضع البيّاع', 1); if (!confirm('حذف الفاتورة نهائياً؟ سيتم عكس أثرها على الحسابات والمستودع.')) return; db.invoices = db.invoices.filter(x => x.id !== orig.id); db.vouchers = db.vouchers.filter(v => v.inv !== orig.id); save(); toast('تم الحذف'); go('#/invoices'); },
  });
  if (draftPay) payNow = draftPay;
  $('[name=payment]', view).value = payNow || '';
  toggles(); draw();
  if (sideSale && !orig && needParty()) setTimeout(() => pickParty(), 60);
  scanIn.addEventListener('focus', () => { if (needParty()) { scanIn.blur(); pickParty(); } });
  // للأوامر الصوتية
  window.InvHook = {
    addSpoken: (t, raw) => {
      OrderPaste.reset();
      const line = OrderPaste.parseLine(t);
      if (!line || line.kind === 'pay') return toast('ما فهمت: ' + raw, 1);
      const ln = OrderPaste.asItem(line);
      const m = OrderPaste.best(ln, items);
      const add = it => { fromPaste({ party: '', lines: [{ item: it.id, qty: line.qty || 1 }], pay: payNow }); toast(`🎤 ${it.name} × ${fmt(line.qty || 1)}${m.it && !m.sure ? ' (تأكد منها)' : ''}`); };
      if (m.it && !m.weak) return add(m.it);
      Voice.askItem(ln, raw.replace(/\s*عدد.*$/, '')).then(it => it && add(it));
    },
    setParty: id => fromPaste({ party: id, lines: [], pay: payNow }),
    setPay: n => { payNow = n; showPay(); },
    setQty: q => {
      const l = inv.lines[inv.lines.length - 1]; // آخر سطر انضاف
      if (!l || !(q > 0)) return null;
      const base = l.item === lastId ? lastBase : 0;
      l.qty = base + q;
      const it = db.items.find(x => x.id === l.item);
      draw(inv.lines.indexOf(l)); if (it) { const ex = inv.lines.find(x => x !== l && x.item === l.item); noteAdd(it, ex ? inv.lines.indexOf(ex) + 1 : 0, l.qty); }
      return it && { name: it.name, base, total: l.qty };
    },
    setAdj: (k, v) => { $(`[name=${k}]`, view).value = v || ''; totals(); },
    save: () => doSave(false),
    undo: () => { inv.lines.pop(); draw(); },
  };
  if (window.Voice) Voice.invReady();
  if (window.Receipt) { Receipt.pill(); const w = Receipt.warm(); if (w) w.then(() => Receipt.pill()); }
};

/* ------------------------- السندات ------------------------- */
function voucherForm(v, type, preAcc) {
  type = v ? v.type : type;
  const isR = type === 'receipt';
  const others = postable().filter(a => !isUnder(a.id, 'cashGroup') && a.id !== 'inventory' && (!isWalkin(a.id) || (v && v.acc === a.id)));
  const vals = v ? { cur: 'base', ...v } : { date: today(), acc: preAcc || '', cashAcc: cashAccounts()[0]?.id, amount: '', cur: 'base', rate: db.settings.rate || '' };
  if (!vals.rate) vals.rate = db.settings.rate || '';
  if (!v) reserveNo(type);
  const fl = [
    { k: 'date', l: 'التاريخ', t: 'date', req: 1 },
    { k: 'amount', l: 'المبلغ', t: 'number', req: 1 },
    { k: 'cur', l: 'العملة', t: 'select', opts: curOpts() },
    { k: 'rate', l: `سعر الصرف (${cur()} لكل 1 ${FX().sym})`, t: 'number' },
    { k: 'acc', l: isR ? 'مقبوض من (الحساب)' : 'مدفوع إلى (الحساب)', t: 'select', opts: accOpts(others, '— اختر الحساب —'), req: 1, full: 1 },
    { k: 'cashAcc', l: isR ? 'إلى الصندوق' : 'من الصندوق', t: 'select', opts: accOpts(cashAccounts()), req: 1 },
    { k: 'note', l: 'البيان', full: 1 },
  ];
  const f = modal((isR ? 'سند قبض' : 'سند دفع') + (v ? ' رقم ' + v.no : ' جديد'), fields(fl, vals) + '<p class="muted" id="vEq"></p>', {
    extra: v ? `${navigator.bluetooth ? '<button type="button" class="btn" id="vBt">🔵 بلوتوث</button>' : ''}<button type="button" class="btn" id="vRc">🧾 إيصال</button><button type="button" class="btn" id="vPrint">🖨 طباعة</button><button type="button" class="btn red" id="vDel">حذف</button>` : '',
    onSave: d => {
      const amount = r2(num(d.amount)), R = num(d.rate);
      if (amount <= 0) { toast('أدخل مبلغاً صحيحاً', 1); return false; }
      if (!d.acc) { toast('اختر الحساب', 1); return false; }
      if (d.cur === 'fx' && R <= 0) { toast('أدخل سعر الصرف', 1); return false; }
      const o = { date: d.date, amount, acc: d.acc, cashAcc: d.cashAcc, note: d.note, cur: d.cur, rate: d.cur === 'fx' ? R : '' };
      let nv = null;
      if (v) Object.assign(v, o); else db.vouchers.push(nv = { id: uid(), type, ...newNo(type), created: Date.now(), ...o });
      save(); toast('تم حفظ السند'); go('#/vouchers?t=' + type);
      if (nv) setTimeout(() => voucherPrintAsk(nv, true), 80);
    },
  });
  const rateFld = $('[name=rate]', f).closest('.fld');
  const upd = () => {
    const fx = $('[name=cur]', f).value === 'fx', a = num($('[name=amount]', f).value), R = num($('[name=rate]', f).value);
    rateFld.style.visibility = fx ? 'visible' : 'hidden';
    const base = fx ? a * R : a;
    $('#vEq').textContent = ''; // المعادل صار تحت خانة المبلغ
  };
  f.oninput = f.onchange = upd; upd(); amountOldHint(f);
  if (v) {
    $('#vDel').onclick = () => { if (isSeller()) return toast('🔒 الحذف مسكّر بوضع البيّاع', 1); if (!confirm('حذف السند؟')) return; db.vouchers = db.vouchers.filter(x => x.id !== v.id); save(); $('#dlg').close(); route(); };
    $('#vPrint').onclick = () => { $('#dlg').close(); printDoc(voucherHtml(v)); };
    const bt = $('#vBt'); if (bt) bt.onclick = () => { $('#dlg').close(); Receipt.printDirect(v); };
    $('#vRc').onclick = () => { $('#dlg').close(); Receipt.open(v); };
  }
}
function voucherHtml(v) {
  const isR = v.type === 'receipt';
  return `<h3 class="ptitle">${isR ? 'سند قبض' : 'سند دفع'} رقم ${v.no}${repTag(v)}</h3>
  <table><tbody><tr><th>التاريخ</th><td>${v.date}</td></tr><tr><th>${isR ? 'استلمنا من' : 'دفعنا إلى'}</th><td>${esc(accName(v.acc))}</td></tr>
  <tr><th>المبلغ</th><td>${fmt(v.amount)} ${esc(docSym(v))} — بالعملة القديمة: ${oldAmt(v.amount * docRate(v))}</td></tr><tr><th>المبلغ كتابةً</th><td>${esc(moneyWords(v.amount, v))}</td></tr>
  ${v.cur === 'fx' ? `<tr><th>سعر الصرف</th><td>${fmt(v.rate)} — المعادل: ${fmt(v.amount * num(v.rate))} ${esc(cur())}</td></tr>` : ''}
  <tr><th>البيان</th><td>${esc(v.note || '')}</td></tr><tr><th>${isR ? 'إلى الصندوق' : 'من الصندوق'}</th><td>${esc(accName(v.cashAcc))}</td></tr></tbody></table>
  <div class="psign"><span>${isR ? 'توقيع الدافع' : 'توقيع المستلم'}</span><span>توقيع المحاسب</span></div>`;
}
function sellerVouchers(q, view) {
  const list = db.vouchers.filter(v => v.type === 'receipt' && v.rep === myRep()).sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0));
  const rows = list.map(v => `<tr data-act="open" data-id="${v.id}"><td class="n">${v.no}</td><td class="n">${v.date}</td><td>${esc(accName(v.acc))}</td><td class="n">${fmt(v.amount)} <small class="muted">${esc(docSym(v))}</small></td></tr>`).join('');
  view.innerHTML = head('📥 سندات القبض — ' + esc(myRep()), '<button class="btn pri" data-act="new">📥 قبض من زبون</button>') +
    `<div class="card">${table(['الرقم', 'التاريخ', 'الزبون', 'المبلغ'], rows)}</div>`;
  onAct(view, {
    new: () => sellerReceipt(),
    open: id => { const v = list.find(x => x.id === id); if (v) voucherPrintAsk(v); },
  });
  if (q.new) { history.replaceState(null, '', '#/vouchers'); sellerReceipt(); }
}
// تحت خانة المبلغ: المعادل بالعملة القديمة (وبالليرة إذا المبلغ بالدولار) — بيتحدّث وإنت عم تكتب
function amountOldHint(f) {
  const am = $('[name=amount]', f); if (!am) return () => {};
  const h = document.createElement('div'); h.className = 'amt-old'; am.closest('.fld').appendChild(h);
  const upd = () => {
    const a = num(am.value), fx = ($('[name=cur]', f) || {}).value === 'fx', R = num(($('[name=rate]', f) || {}).value);
    const base = fx ? a * R : a;
    h.textContent = !a ? '' : fx && !R ? 'اكتب سعر الصرف' : `${fx ? `= ${fmt(r2(base))} ${cur()} — ` : ''}بالعملة القديمة: ${oldAmt(base)}`;
  };
  f.addEventListener('input', upd); f.addEventListener('change', upd); upd();
  return upd;
}
// طباعة السند: بلوتوث مباشر (إيصال حراري بالجديد والقديم) أو طرق تانية
function voucherPrintAsk(v, fresh) {
  const f = modal((fresh ? '✓ انحفظ ' : '') + (v.type === 'receipt' ? 'سند قبض' : 'سند دفع') + ' رقم ' + v.no, voucherHtml(v),
    { extra: `${navigator.bluetooth ? '<button type="button" class="btn pri" id="vBt">🔵 طباعة بلوتوث</button>' : ''}<button type="button" class="btn${navigator.bluetooth ? '' : ' pri'}" id="vRc">🧾 إيصال (طرق تانية)</button><button type="button" class="btn" id="vA4">🖨 A4</button>` });
  const bt = $('#vBt', f); if (bt) bt.onclick = () => { $('#dlg').close(); Receipt.printDirect(v); };
  $('#vRc', f).onclick = () => { $('#dlg').close(); Receipt.open(v); };
  $('#vA4', f).onclick = () => { $('#dlg').close(); printDoc(voucherHtml(v)); };
}
// قبض من زبون (المندوب): المصاري بتنزل بصندوقه، وبلا ما يشوف رصيد الزبون
function sellerReceipt() {
  const box = myBox(); if (!box) return toast(NO_BOX, 1);
  reserveNo('receipt@' + myRep());
  const cs = customers().filter(a => !isWalkin(a.id));
  const f = modal('📥 قبض من زبون', fields([
    { k: 'acc', l: 'الزبون', t: 'select', opts: accOpts(cs, '— اختر الزبون —'), req: 1, full: 1 },
    { k: 'amount', l: 'المبلغ', t: 'number', req: 1 },
    { k: 'cur', l: 'العملة', t: 'select', opts: curOpts() },
    { k: 'rate', l: `سعر الصرف (${cur()} لكل 1 ${FX().sym})`, t: 'number' },
    { k: 'note', l: 'البيان', full: 1 },
  ], { cur: 'base', rate: db.settings.rate || '' }) + `<p class="muted">💰 بتنزل بـ: <b>${esc(box.name)}</b></p>`, {
    saveText: 'حفظ القبض',
    onSave: d => {
      const amount = r2(num(d.amount)), R = num(d.rate);
      if (!d.acc) { toast('اختر الزبون', 1); return false; }
      if (amount <= 0) { toast('أدخل مبلغاً صحيحاً', 1); return false; }
      if (d.cur === 'fx' && R <= 0) { toast('أدخل سعر الصرف', 1); return false; }
      const rp = myRep();
      const v = { id: uid(), type: 'receipt', ...newNo('receipt@' + rp), date: today(), acc: d.acc, cashAcc: box.id, amount, cur: d.cur, rate: d.cur === 'fx' ? R : '', note: d.note || '', rep: rp, created: Date.now() };
      db.vouchers.push(v); save(); toast('✓ انحفظ سند القبض');
      setTimeout(() => { route(); voucherPrintAsk(v, true); }, 50);
    },
  });
  const sel = $('[name=acc]', f); if (typeof enhancePartySelect === 'function') enhancePartySelect(sel);
  amountOldHint(f);
  const rateFld = $('[name=rate]', f).closest('.fld');
  const upd = () => { rateFld.style.visibility = $('[name=cur]', f).value === 'fx' ? 'visible' : 'hidden'; };
  f.onchange = upd; upd();
}
V.vouchers = (id, q, view) => {
  if (isSeller()) return sellerVouchers(q, view);
  const t = isSeller() ? 'receipt' : q.t === 'payment' ? 'payment' : q.t === 'receipt' ? 'receipt' : 'all';
  const list = db.vouchers.filter(v => t === 'all' || v.type === t).sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0));
  const rows = list.map(v => `<tr data-act="open" data-id="${v.id}"><td class="n">${v.no}</td><td><span class="badge ${v.type === 'receipt' ? 'sale' : 'purchaseReturn'}">${v.type === 'receipt' ? 'قبض' : 'دفع'}</span></td>
    <td class="n">${v.date}</td><td>${esc(accName(v.acc))}</td><td>${esc(v.note || '')}</td><td class="n">${fmt(v.amount)} <small class="muted">${esc(docSym(v))}</small></td></tr>`).join('');
  const tab = (k, l) => `<a href="#/vouchers?t=${k}" class="${t === k ? 'on' : ''}">${l}</a>`;
  view.innerHTML = head('سندات القبض والدفع', `<button class="btn pri" data-act="new" data-id="receipt">📥 سند قبض</button><button class="btn" data-act="new" data-id="payment">📤 سند دفع</button>`) +
    `<div class="tabs">${tab('all', 'الكل')}${tab('receipt', 'سندات القبض')}${tab('payment', 'سندات الدفع')}</div>
    <div class="card">${table(['الرقم', 'النوع', 'التاريخ', 'الحساب', 'البيان', 'المبلغ'], rows)}</div>`;
  onAct(view, {
    new: type => voucherForm(null, isSeller() ? 'receipt' : type),
    open: id => { const v = db.vouchers.find(x => x.id === id); if (isSeller() && v && v.type !== 'receipt') return; voucherForm(v); },
  });
  if (q.new) voucherForm(null, q.new === 'payment' ? 'payment' : 'receipt', q.acc);
};

/* ------------------------- القيود اليومية ------------------------- */
const SRC = { manual: 'يدوي', invoice: 'فاتورة', voucher: 'سند', stock: 'مستودع' };
V.journal = (id, q, view) => {
  const s = q.src || 'all';
  const list = engine().entries.filter(e => s === 'all' || e.src === s).slice().reverse().slice(0, 500);
  const rows = list.map(e => {
    const amt = e.lines.reduce((x, l) => x + l.dr, 0);
    const lines = e.lines.map(l => `<div class="muted" style="font-size:12.5px">${l.dr ? 'من ح/ ' : '&nbsp;&nbsp;&nbsp;&nbsp;إلى ح/ '}${esc(accName(l.acc))} — ${fmt(l.dr || l.cr)}</div>`).join('');
    return `<tr data-act="open" data-id="${e.id}"><td class="n">${e.date}</td><td><span class="badge">${SRC[e.src]}</span> ${e.no}</td><td>${esc(e.desc)}${lines}</td><td class="n">${fmt(amt)}</td></tr>`;
  }).join('');
  const tab = (k, l) => `<a href="#/journal?src=${k}" class="${s === k ? 'on' : ''}">${l}</a>`;
  view.innerHTML = head('القيود اليومية', `<a class="btn pri" href="#/entry/new">+ قيد يدوي</a>`) +
    `<div class="tabs">${tab('all', 'الكل')}${tab('manual', 'يدوية')}${tab('invoice', 'من الفواتير')}${tab('voucher', 'من السندات')}</div>
     <p class="muted">القيود الناتجة عن الفواتير والسندات تُولَّد تلقائياً — لتعديلها عدّل الفاتورة أو السند نفسه.</p>
     <div class="card">${table(['التاريخ', 'المصدر/الرقم', 'البيان', 'المبلغ'], rows)}</div>`;
  onAct(view, {
    open: id => {
      const e = engine().entries.find(x => x.id === id);
      if (!e) return;
      if (e.src === 'manual') go('#/entry/' + e.id);
      else if (e.src === 'invoice') go('#/invoice/' + e.ref);
      else if (e.src === 'voucher') voucherForm(db.vouchers.find(v => v.id === e.ref));
      else go('#/items');
    },
  });
};
V.entry = (id, q, view) => {
  const orig = id === 'new' ? null : db.entries.find(e => e.id === id);
  if (id !== 'new' && !orig) return go('#/journal');
  const en = orig ? clone(orig) : { date: today(), desc: '', lines: [{ acc: '', dr: '', cr: '', note: '' }, { acc: '', dr: '', cr: '', note: '' }] };
  const aOpts = accOpts(postable(), '— اختر الحساب —');
  view.innerHTML = head(orig ? `قيد يومية رقم ${orig.no}` : 'قيد يومية جديد', `${orig ? `<button class="btn red" data-act="del">حذف</button>` : ''}<a class="btn" href="#/journal">رجوع</a>`) + `
  <div class="card">
    <div class="grid4">${field({ k: 'date', l: 'التاريخ', t: 'date', req: 1 }, en.date)}<div class="fld" style="grid-column:span 3"><span>البيان</span><input name="desc" value="${esc(en.desc)}"></div></div>
    <div class="tbl" style="margin-top:14px"><table class="lines"><thead><tr><th>#</th><th>الحساب</th><th>مدين</th><th>دائن</th><th>ملاحظة</th><th></th></tr></thead><tbody id="ln"></tbody>
    <tfoot><tr><td></td><td>المجموع</td><td class="n" id="tDr"></td><td class="n" id="tCr"></td><td colspan="2" id="tDiff" class="diff"></td></tr></tfoot></table></div>
    <button class="btn" data-act="addLine" style="margin-top:8px">+ سطر</button>
    <div class="form-actions"><button class="btn pri big" data-act="save">💾 حفظ القيد</button></div>
  </div>`;
  const totals = () => {
    const dr = en.lines.reduce((s, l) => s + num(l.dr), 0), cr = en.lines.reduce((s, l) => s + num(l.cr), 0), df = r2(dr - cr);
    $('#tDr', view).textContent = fmt(dr); $('#tCr', view).textContent = fmt(cr);
    const t = $('#tDiff', view); t.textContent = df ? 'الفرق: ' + fmt(df) : 'القيد متوازن ✓'; t.className = 'diff ' + (df ? 'bad' : 'ok');
  };
  const draw = () => {
    $('#ln', view).innerHTML = en.lines.map((l, i) => `<tr data-i="${i}"><td>${i + 1}</td><td><select data-f="acc">${optsHtml(aOpts, l.acc)}</select></td>
      <td><input data-f="dr" type="number" step="any" inputmode="decimal" value="${esc(l.dr || '')}" placeholder="مدين"></td>
      <td><input data-f="cr" type="number" step="any" inputmode="decimal" value="${esc(l.cr || '')}" placeholder="دائن"></td>
      <td><input data-f="note" value="${esc(l.note || '')}" placeholder="ملاحظة"></td>
      <td><button class="mini red" data-act="rm" data-id="${i}">✕</button></td></tr>`).join('');
    totals();
  };
  view.oninput = view.onchange = e => {
    const tr = e.target.closest('#ln tr'); if (!tr || !e.target.dataset.f) return;
    const l = en.lines[tr.dataset.i], f = e.target.dataset.f; l[f] = e.target.value;
    if (f === 'dr' && num(l.dr)) { l.cr = ''; $('[data-f=cr]', tr).value = ''; }
    if (f === 'cr' && num(l.cr)) { l.dr = ''; $('[data-f=dr]', tr).value = ''; }
    totals();
  };
  onAct(view, {
    addLine: () => { en.lines.push({ acc: '', dr: '', cr: '', note: '' }); draw(); },
    rm: i => { en.lines.splice(+i, 1); draw(); },
    del: () => { if (!confirm('حذف القيد؟')) return; db.entries = db.entries.filter(x => x.id !== orig.id); save(); go('#/journal'); },
    save: () => {
      const lines = en.lines.filter(l => l.acc && (num(l.dr) || num(l.cr))).map(l => ({ acc: l.acc, dr: r2(num(l.dr)), cr: r2(num(l.cr)), note: l.note || '' }));
      if (lines.length < 2) return toast('القيد يحتاج سطرين على الأقل', 1);
      const dr = r2(lines.reduce((s, l) => s + l.dr, 0)), cr = r2(lines.reduce((s, l) => s + l.cr, 0));
      if (dr !== cr) return toast('القيد غير متوازن: مجموع المدين لا يساوي مجموع الدائن', 1);
      const date = $('[name=date]', view).value, desc = $('[name=desc]', view).value.trim();
      if (!date) return toast('أدخل التاريخ', 1);
      if (orig) Object.assign(orig, { date, desc, lines });
      else db.entries.push({ id: uid(), no: newNo('entry').no, date, desc, lines });
      save(); toast('تم حفظ القيد'); go('#/journal?src=manual');
    },
  });
  draw();
};

/* ------------------------- التقارير ------------------------- */
const REPORTS = {
  statement: { t: 'كشف حساب', d: 'حركة أي حساب أو عميل أو مورد مع الرصيد التراكمي' },
  trial: { t: 'ميزان المراجعة', d: 'مجاميع وأرصدة كل الحسابات خلال فترة' },
  income: { t: 'قائمة الدخل (الأرباح والخسائر)', d: 'الإيرادات والمصاريف وصافي الربح' },
  balance: { t: 'الميزانية العمومية', d: 'الأصول والخصوم وحقوق الملكية بتاريخ معيّن' },
  stock: { t: 'جرد المستودع', d: 'الكميات الحالية وقيمتها بالكلفة وبسعر المبيع' },
  itemcard: { t: 'بطاقة مادة', d: 'كل حركات مادة معيّنة دخولاً وخروجاً' },
  itemprofit: { t: 'أرباح المواد', d: 'المبيعات والكلفة والربح لكل مادة خلال فترة' },
  parties: { t: 'أرصدة العملاء والموردين', d: 'من له ومن عليه بتاريخ معيّن' },
};
V.reports = (id, q, view) => {
  view.innerHTML = head('التقارير') + `<div class="rep-grid">${Object.entries(REPORTS).map(([k, r]) => `<a href="#/report/${k}"><b>${r.t}</b><span>${r.d}</span></a>`).join('')}</div>`;
};
V.report = (type, q, view) => {
  const R = REPORTS[type]; if (!R) return go('#/reports');
  const from = q.from || db.settings.startDate, to = q.to || today();
  const F = { from: { k: 'from', l: 'من تاريخ', t: 'date' }, to: { k: 'to', l: 'إلى تاريخ', t: 'date' } };
  let filters = [], body = '', waMsg = null, waAcc = null;
  const vals = { ...q, from, to };

  if (type === 'statement') {
    filters = [{ k: 'acc', l: 'الحساب', t: 'select', opts: [['', '— اختر —'], ...treeOrder().map(({ a, d }) => [a.id, ' '.repeat(d * 3) + a.code + ' - ' + a.name])] }, F.from, F.to];
    const a = acc(q.acc);
    if (!a) body = '<p class="muted">اختر حساباً لعرض كشفه.</p>';
    else {
      const ids = new Set(descendants(a.id)), sign = DEBIT_NATURE.includes(a.type) ? 1 : -1;
      let open = 0, bal, tdr = 0, tcr = 0; const rows = [];
      for (const e of engine().entries) {
        if (e.date > to) break;
        for (const l of e.lines) {
          if (!ids.has(l.acc)) continue;
          const net = (l.dr - l.cr) * sign;
          if (e.date < from) { open += net; continue; }
          rows.push({ e, l, net });
        }
      }
      bal = open;
      const html = rows.map(({ e, l, net }) => {
        bal += net; tdr += l.dr; tcr += l.cr;
        return `<tr><td class="n">${e.date}</td><td>${SRC[e.src]} ${e.no}</td><td>${esc(e.desc)}${l.note ? ' — ' + esc(l.note) : ''}${ids.size > 1 ? ` <small class="muted">[${esc(accName(l.acc))}]</small>` : ''}</td>
          <td class="n">${l.dr ? fmt(l.dr) : ''}</td><td class="n">${l.cr ? fmt(l.cr) : ''}</td><td class="n">${fmt(Math.abs(bal))} <small class="muted">${bal ? balLabel(a, bal) : ''}</small></td></tr>`;
      }).join('');
      body = `<h3>${esc(a.code + ' - ' + a.name)} <small class="muted">من ${from} إلى ${to}</small></h3>` +
        table(['التاريخ', 'المستند', 'البيان', 'مدين', 'دائن', 'الرصيد'],
          `<tr class="grp"><td colspan="5">رصيد سابق</td><td class="n">${fmt(Math.abs(open))} <small class="muted">${open ? balLabel(a, open) : ''}</small></td></tr>` + html,
          `<tr><td colspan="3">المجموع / الرصيد النهائي</td><td class="n">${fmt(tdr)}</td><td class="n">${fmt(tcr)}</td><td class="n">${fmt(Math.abs(bal))} ${bal ? balLabel(a, bal) : ''}</td></tr>`);
      if ([...customers(), ...suppliers()].includes(a)) { waAcc = a; waMsg = waStatementText(a, from, to, rows, open, bal); }
      if (FX().rate && r2(bal)) body += `<p class="muted">الرصيد النهائي بالدولار حسب سعر الصرف الحالي (${fmt(FX().rate)}): <b>${fmt(Math.abs(bal) / FX().rate)} ${esc(FX().sym)}</b> ${balLabel(a, bal)}</p>`;
    }
  }

  if (type === 'trial') {
    filters = [F.from, F.to];
    const RU = rollup(sums(from, to));
    let T = { dr: 0, cr: 0, bd: 0, bc: 0 };
    const rows = treeOrder().filter(({ a }) => RU[a.id].dr || RU[a.id].cr).map(({ a, d }) => {
      const s = RU[a.id], b = r2(s.dr - s.cr), g = isGroup(a);
      if (!g) { T.dr += s.dr; T.cr += s.cr; if (b > 0) T.bd += b; else T.bc -= b; }
      return `<tr class="${g ? 'grp' : ''}"><td class="n">${esc(a.code)}</td><td style="padding-inline-start:${10 + d * 16}px">${esc(a.name)}</td><td class="n">${fmt(s.dr)}</td><td class="n">${fmt(s.cr)}</td><td class="n">${b > 0 ? fmt(b) : ''}</td><td class="n">${b < 0 ? fmt(-b) : ''}</td></tr>`;
    }).join('');
    const okk = r2(T.dr) === r2(T.cr);
    body = table(['الرمز', 'الحساب', 'مجموع مدين', 'مجموع دائن', 'رصيد مدين', 'رصيد دائن'], rows,
      `<tr><td colspan="2">الإجمالي</td><td class="n">${fmt(T.dr)}</td><td class="n">${fmt(T.cr)}</td><td class="n">${fmt(T.bd)}</td><td class="n">${fmt(T.bc)}</td></tr>`) +
      `<p class="${okk ? 'ok' : 'bad'}">${okk ? 'الميزان متوازن ✓' : 'الميزان غير متوازن!'}</p>`;
  }

  const section = (rootId, RU, title) => {
    const rows = treeOrder().filter(({ a }) => isUnder(a.id, rootId) && a.id !== rootId && r2(natural(a, RU[a.id]))).map(({ a, d }) =>
      `<tr class="${isGroup(a) ? 'grp' : ''}"><td style="padding-inline-start:${10 + (d - 1) * 16}px">${esc(a.name)}</td><td class="n">${fmt(natural(a, RU[a.id]))}</td></tr>`).join('');
    const tot = natural(acc(rootId), RU[rootId]);
    return { html: `<tr class="sec-title"><td colspan="2">${title}</td></tr>${rows}<tr class="grp"><td>إجمالي ${title}</td><td class="n">${fmt(tot)}</td></tr>`, tot };
  };

  if (type === 'income') {
    filters = [F.from, F.to];
    const RU = rollup(sums(from, to));
    const rv = section('revenue', RU, 'الإيرادات'), ex = section('expenses', RU, 'المصاريف'), net = rv.tot - ex.tot;
    body = table(['البند', 'المبلغ'], rv.html + ex.html, `<tr><td>${net >= 0 ? 'صافي الربح' : 'صافي الخسارة'}</td><td class="n ${net < 0 ? 'neg' : 'pos'}">${fmt(Math.abs(net))}</td></tr>`);
  }

  if (type === 'balance') {
    filters = [F.to];
    const RU = rollup(sums(null, to));
    const as = section('assets', RU, 'الأصول'), li = section('liabilities', RU, 'الخصوم'), eq = section('equity', RU, 'حقوق الملكية');
    const profit = natural(acc('revenue'), RU.revenue) - natural(acc('expenses'), RU.expenses);
    const right = li.tot + eq.tot + profit, okk = r2(as.tot) === r2(right);
    body = `<div class="cols2"><div>${table(['البند', 'المبلغ'], as.html)}</div><div>${table(['البند', 'المبلغ'], li.html + eq.html +
      `<tr><td>صافي ربح/خسارة الفترة</td><td class="n ${profit < 0 ? 'neg' : ''}">${fmt(profit)}</td></tr>`, `<tr><td>إجمالي الخصوم وحقوق الملكية</td><td class="n">${fmt(right)}</td></tr>`)}</div></div>
      <p class="${okk ? 'ok' : 'bad'}">${okk ? 'الميزانية متوازنة ✓' : 'الميزانية غير متوازنة!'}</p>`;
  }

  if (type === 'stock') {
    filters = [{ k: 'g', l: 'المجموعة', t: 'select', opts: [['', 'كل المجموعات'], ...grpOpts().slice(1)] }];
    const st = engine().stock; let tc = 0, ts = 0;
    const gids = q.g ? new Set(grpDesc(q.g)) : null;
    const rows = [...db.items].sort(byCode).filter(i => !gids || gids.has(i.group)).map(i => {
      const s = st[i.id] || { qty: 0, avg: 0 }, c = s.qty * s.avg, sv = s.qty * num(i.sellPrice); tc += c; ts += sv;
      return `<tr><td class="n">${esc(i.code)}</td><td>${esc(i.name)}</td><td>${esc(i.unit || '')}</td><td class="n">${fmt(s.qty)}</td><td class="n">${fmt(s.avg)}</td><td class="n">${fmt(c)}</td><td class="n">${fmt(i.sellPrice)}</td><td class="n">${fmt(sv)}</td></tr>`;
    }).join('');
    body = table(['الرمز', 'المادة', 'الوحدة', 'الكمية', 'متوسط الكلفة', 'القيمة بالكلفة', 'سعر المبيع', 'القيمة بسعر المبيع'], rows,
      `<tr><td colspan="5">الإجمالي</td><td class="n">${fmt(tc)}</td><td></td><td class="n">${fmt(ts)}</td></tr>`);
  }

  if (type === 'itemcard') {
    filters = [{ k: 'item', l: 'المادة', t: 'select', opts: [['', '— اختر —'], ...[...db.items].sort(byCode).map(i => [i.id, (i.code ? i.code + ' - ' : '') + i.name])] }, F.from, F.to];
    const it = db.items.find(i => i.id === q.item);
    if (!it) body = '<p class="muted">اختر مادة.</p>';
    else {
      let qty = 0, open = 0; const rows = [];
      engine().moves.filter(m => m.item === it.id).forEach(m => {
        if (m.date < from) { open += m.in - m.out; return; }
        if (m.date > to) return;
        rows.push(m);
      });
      qty = open;
      body = `<h3>${esc(it.name)} <small class="muted">${esc(it.unit || '')}</small></h3>` + table(['التاريخ', 'الحركة', 'الطرف', 'وارد', 'صادر', 'السعر', 'الرصيد'],
        (open ? `<tr class="grp"><td colspan="6">رصيد سابق</td><td class="n">${fmt(open)}</td></tr>` : '') +
        rows.map(m => { qty += m.in - m.out; return `<tr${m.ref ? ` data-act="inv" data-id="${m.ref}"` : ''}><td class="n">${m.date}</td><td>${esc(m.label)}</td><td>${esc(accName(m.party))}</td><td class="n">${m.in ? fmt(m.in) : ''}</td><td class="n">${m.out ? fmt(m.out) : ''}</td><td class="n">${fmt(m.price)}</td><td class="n">${fmt(qty)}</td></tr>`; }).join(''));
    }
  }

  if (type === 'itemprofit') {
    filters = [F.from, F.to];
    const agg = {};
    engine().moves.filter(m => (m.kind === 'sale' || m.kind === 'saleReturn') && m.date >= from && m.date <= to).forEach(m => {
      const a = agg[m.item] || (agg[m.item] = { qty: 0, val: 0, cost: 0 }), s = m.kind === 'sale' ? 1 : -1;
      a.qty += s * (m.out || m.in); a.val += s * m.val; a.cost += s * m.cost;
    });
    let T = { val: 0, cost: 0 };
    const rows = Object.entries(agg).sort((a, b) => (b[1].val - b[1].cost) - (a[1].val - a[1].cost)).map(([id, a]) => {
      const it = db.items.find(i => i.id === id) || {}, p = a.val - a.cost; T.val += a.val; T.cost += a.cost;
      return `<tr><td>${esc(it.name)}</td><td class="n">${fmt(a.qty)}</td><td class="n">${fmt(a.val)}</td><td class="n">${fmt(a.cost)}</td><td class="n ${p < 0 ? 'neg' : 'pos'}">${fmt(p)}</td><td class="n">${a.val ? fmt(p / a.val * 100) + '%' : ''}</td></tr>`;
    }).join('');
    body = table(['المادة', 'الكمية المباعة', 'المبيعات', 'الكلفة', 'الربح', 'نسبة الربح'], rows,
      `<tr><td colspan="2">الإجمالي</td><td class="n">${fmt(T.val)}</td><td class="n">${fmt(T.cost)}</td><td class="n">${fmt(T.val - T.cost)}</td><td></td></tr>`);
  }

  if (type === 'parties') {
    filters = [F.to];
    const RU = rollup(sums(null, to));
    const mk = (list, title) => {
      let t = 0;
      const rows = list.filter(a => r2(natural(a, RU[a.id]))).map(a => { const b = natural(a, RU[a.id]); t += b; return `<tr data-act="st" data-id="${a.id}"><td>${esc(a.name)}</td><td class="n">${esc(a.phone || '')}</td><td class="n">${fmt(b)}</td></tr>`; }).join('');
      return `<h3>${title}</h3>` + table(['الاسم', 'الهاتف', 'الرصيد'], rows, `<tr><td colspan="2">الإجمالي</td><td class="n">${fmt(t)}</td></tr>`);
    };
    body = `<div class="cols2"><div>${mk(customers(), 'العملاء (لنا عليهم)')}</div><div>${mk(suppliers(), 'الموردون (لهم علينا)')}</div></div>`;
  }

  view.innerHTML = head(R.t, `${waMsg ? '<button class="btn wa" data-act="wa">واتساب</button>' : ''}<button class="btn" data-act="print">🖨 طباعة</button><a class="btn" href="#/reports">رجوع</a>`) +
    (filters.length ? `<form class="card filters" id="flt">${filters.map(f => field(f, vals[f.k])).join('')}<button class="btn pri">عرض</button></form>` : '') +
    `<div class="card" id="rep">${body}</div>`;
  const flt = $('#flt', view);
  if (flt) {
    flt.onsubmit = e => { e.preventDefault(); const p = new URLSearchParams(new FormData(flt)); go(`#/report/${type}?${p}`); };
    $$('select', flt).forEach(s => (s.onchange = () => flt.requestSubmit()));
  }
  onAct(view, {
    print: () => printDoc(`<h3 class="ptitle">${R.t}</h3><div class="pmeta">${filters.some(f => f.k === 'from') ? `<span>من ${from}</span>` : ''}${filters.some(f => f.k === 'to') ? `<span>إلى ${to}</span>` : ''}</div>` + $('#rep', view).innerHTML),
    inv: id => go('#/invoice/' + id),
    st: id => go('#/report/statement?acc=' + id),
    wa: () => waSend(waAcc, waMsg),
  });
};

/* ------------------------- الإعدادات ------------------------- */
V.settings = (id, q, view) => {
  const s = db.settings;
  view.innerHTML = head('الإعدادات') + `
  <form class="card" id="sf"><h3>بيانات المنشأة</h3>
    ${fields([
      { k: 'company', l: 'اسم المنشأة', req: 1 }, { k: 'phone', l: 'الهاتف' },
      { k: 'address', l: 'العنوان', full: 1 },
      { k: 'currency', l: 'رمز العملة الأساسية', ph: 'ل.س' }, { k: 'currencyName', l: 'اسم العملة الأساسية (للتفقيط)', ph: 'ليرة سورية' },
      { k: 'currency2', l: 'رمز العملة الثانية', ph: '$' }, { k: 'currency2Name', l: 'اسم العملة الثانية', ph: 'دولار أمريكي' },
      { k: 'rate', l: 'سعر الصرف الحالي (كم ليرة للدولار)', t: 'number', full: 1 },
      { k: 'showOld', l: 'إظهار المبالغ بالعملة القديمة كمان (قبل حذف الصفرين)', t: 'select', opts: [['1', 'نعم'], ['0', 'لا']] },
      { k: 'oldFactor', l: 'كل ليرة جديدة = كم ليرة قديمة', t: 'number' },
      { k: 'startDate', l: 'تاريخ بداية الفترة المحاسبية', t: 'date', req: 1 },
      { k: 'paperWidth', l: 'عرض ورق الطابعة الحرارية', t: 'select', opts: [['80', '80 مم (3 إنش)'], ['58', '58 مم (2 إنش)']] },
      { k: 'printFast', l: 'سرعة طباعة البلوتوث', t: 'select', opts: [['1', '⚡ سريعة (ضعف السرعة)'], ['0', 'عادية (أنعم شوي)']] },
      { k: 'receiptCp', l: 'عمود سعر المستهلك بالإيصال', t: 'select', opts: [['1', 'يطلع دايماً'], ['0', 'لا يطلع']] },
      { k: 'receiptHeader', l: 'سطر تحت اسم المحل بالإيصال (نشاطك، السجل التجاري…)', ph: 'شيبس، مياه، غازية، بسكويت — س.ت 384', t: 'textarea', full: 1 },
      { k: 'receiptStamp', l: 'ختم الشركة بآخر الإيصال', t: 'select', opts: [['1', 'يطلع'], ['0', 'لا يطلع']] },
      { k: 'receiptFooter', l: 'عبارة أسفل الإيصال', ph: 'صفة البيع من تاجر نصف جملة إلى تاجر مفرق', t: 'textarea', full: 1 },
    ], s)}
    <div class="fld full" style="margin-top:8px"><span>شعار الإيصال (صورة)</span>
      <div class="acts" style="align-items:center">${s.logo ? `<img src="${s.logo}" style="height:60px;border:1px solid var(--line);border-radius:8px;background:#fff">` : ''}
      <label class="btn">🖼 اختيار صورة<input type="file" id="logoF" accept="image/*" hidden></label>${s.logo ? '<button type="button" class="btn red" data-act="noLogo">إزالة</button>' : ''}</div></div>
    <div class="form-actions"><button class="btn pri">حفظ الإعدادات</button></div>
  </form>
  <div class="card" id="cloudCard"></div>
  <div class="card"><h3>🧑‍💼 نقطة البيع (موبايلات المندوبين)</h3>
    <p class="muted">📷 <b>الباركود</b>: المندوب بيصوّره بموبايله ← بيوصلك طلب ← بتكبس «تفعيل» ← بتفتح عنده نقطة البيع بس. بلا إيميل ولا كلمة سر.</p>
    <div id="posDevs"></div>
    <div class="acts"><button class="btn pri" data-act="posqr">📷 باركود نقطة البيع لموبايل المندوب</button><button class="btn" data-act="repbox">💰 صندوق لمندوب</button></div>
  </div>
  <div class="card"><h3>النسخ الاحتياطي</h3>
    <p class="muted">البيانات محفوظة على هذا الجهاز فقط داخل المتصفح. خذ نسخة احتياطية بانتظام واحفظها في مكان آمن، ويمكنك نقلها لجهاز آخر.</p>
    <div class="acts"><button class="btn pri" data-act="export">⬇️ تنزيل نسخة احتياطية</button>
    <label class="btn">⬆️ استعادة نسخة<input type="file" id="imp" accept=".json,.txt,application/json,text/plain" hidden></label></div>
    <div id="autoBk"></div>
  </div>
  <div class="card"><h3>أخرى</h3>
    <div class="acts"><button class="btn" data-act="demo">🧪 تحميل بيانات تجريبية</button><button class="btn red" data-act="reset">🗑 مسح كل البيانات</button></div>
    <div id="storeUse" class="store-use"></div>
    <p class="muted" style="margin-top:10px">الإصدار: <b>${APP_VERSION}</b> — عدد الفواتير: ${db.invoices.length} — المواد: ${db.items.length} — السندات: ${db.vouchers.length} — القيود اليدوية: ${db.entries.length}</p>
  </div>`;
  if (window.Cloud) Cloud.card($('#cloudCard', view)); else $('#cloudCard', view).remove();
  posDevsCard($('#posDevs', view));
  storeUseCard($('#storeUse', view));
  autoBackup().then(() => autoBackupCard($('#autoBk', view)));
  $('#sf', view).onsubmit = e => {
    e.preventDefault();
    Object.assign(db.settings, Object.fromEntries(new FormData(e.target)));
    save(); toast('تم حفظ الإعدادات');
  };
  $('#logoF', view).onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const im = new Image(), u = URL.createObjectURL(f);
    im.onload = () => {
      const h = 160, w = Math.round(im.width * h / im.height), c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(im, 0, 0, w, h);
      db.settings.logo = c.toDataURL('image/png'); URL.revokeObjectURL(u); save(); toast('انحفظ الشعار'); route();
    };
    im.src = u;
  };
  $('#imp', view).onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!Array.isArray(d.accounts) || !Array.isArray(d.invoices)) throw 0;
        if (!confirm('سيتم استبدال كل البيانات الحالية بالنسخة المختارة. متابعة؟')) return;
        if (bkOk()) Store.put('bak:pre', JSON.stringify({ at: Date.now(), db })).catch(() => {});
        const sd = seed(); db = { ...sd, ...d, settings: { ...sd.settings, ...d.settings } }; save(); toast('تمت الاستعادة'); go('#/');
      } catch (err) { toast('الملف غير صالح', 1); }
    };
    r.readAsText(f);
  };
  onAct(view, {
    noLogo: () => { db.settings.logo = ''; save(); route(); },
    posqr: () => posQR(),
    repbox: () => repBoxDialog(),
    export: () => {
      const blob = new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `daftar-backup-${today()}.json`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    demo: () => { if ((db.invoices.length || db.items.length) && !confirm('سيتم استبدال البيانات الحالية ببيانات تجريبية. متابعة؟')) return; loadDemo(); toast('تم تحميل البيانات التجريبية'); go('#/'); },
    reset: () => { if (!confirm('مسح كل البيانات نهائياً؟' + (window.Cloud && $('#syncPill') && !$('#syncPill').hidden ? '\nتنبيه: أنت مربوط بالسحابة، سيُمسح منها أيضاً ومن كل الأجهزة!' : ''))) return; if (prompt('اكتب كلمة: مسح') !== 'مسح') return; db = seed(); save(); toast('تم المسح'); go('#/'); },
  });
};

/* ------------------------- بيانات تجريبية ------------------------- */
function loadDemo() {
  db = seed();
  const s = db.settings; s.company = 'محل النور للمواد الغذائية'; s.address = 'دمشق — الميدان'; s.phone = '011-0000000'; s.startDate = daysAgo(40); s.rate = 120;
  const addP = (parent, name, phone) => { const p = acc(parent); const a = { id: uid(), code: nextCode(p), name, type: p.type, parent, group: false, phone }; db.accounts.push(a); return a.id; };
  const c1 = addP('customers', 'أحمد الخطيب', '0933000001'), c2 = addP('customers', 'مطعم الياسمين', '0944000002'), c3 = addP('customers', 'سامر الحلبي', '0955000003');
  const s1 = addP('suppliers', 'شركة الأمل للتوزيع', '0112000001'), s2 = addP('suppliers', 'مؤسسة الشام التجارية', '0113000002');
  const it = (code, name, unit, buy, sell, oq, min) => { const o = { id: uid(), code, name, unit, buyPrice: buy, sellPrice: sell, consumerPrice: Math.round(sell * 1.15 / 5) * 5, openQty: oq, openCost: buy, minQty: min }; db.items.push(o); return o.id; };
  const G = (code, name, parent = null) => { const g = { id: uid(), code, name, parent }; db.groups.push(g); return g.id; };
  const gFood = G('001', 'مواد تموينية'), gSugar = G('00101', 'سكر ورز وحبوب', gFood), gOil = G('00102', 'زيوت', gFood);
  const gDrinks = G('002', 'مشروبات'), gTea = G('00201', 'شاي', gDrinks), gPasta = G('00103', 'معكرونة', gFood);
  const sugar = it('001', 'سكر', 'كيلو', 90, 110, 100, 20), rice = it('002', 'رز مصري', 'كيلو', 140, 170, 80, 20), oil = it('003', 'زيت دوار الشمس', 'ليتر', 210, 250, 40, 10),
    tea = it('004', 'شاي', 'علبة', 320, 380, 25, 5), pasta = it('005', 'معكرونة', 'كيس', 60, 75, 120, 30), lentil = it('006', 'عدس', 'كيلو', 120, 145, 6, 10);
  let t = 0;
  const inv = (type, days, pay, party, lines, discount = 0, fx = 0) => db.invoices.push({ id: uid(), type, no: nextNo(type), date: daysAgo(days), pay, cashAcc: pay === 'cash' ? 'cash' : '', party, cur: fx ? 'fx' : 'base', rate: fx || '', lines: lines.map(([item, qty, price]) => ({ item, qty, price, cp: (db.items.find(x => x.id === item)?.consumerPrice || 0) / (fx || 1) })), discount, note: '', created: ++t });
  const vch = (type, days, a, amount, note, fx = 0) => db.vouchers.push({ id: uid(), type, no: nextNo(type), date: daysAgo(days), acc: a, cashAcc: 'cash', amount, note, cur: fx ? 'fx' : 'base', rate: fx || '', created: ++t });
  db.entries.push({ id: uid(), no: nextNo('entry'), date: daysAgo(40), desc: 'إيداع رأس المال النقدي', lines: [{ acc: 'cash', dr: 50000, cr: 0, note: '' }, { acc: 'capital', dr: 0, cr: 50000, note: '' }] });
  [gSugar, gSugar, gOil, gTea, gPasta, gSugar].forEach((g, i) => (db.items[i].group = g));
  db.items[0].barcodes = ['6281001234567', '6281001234574']; db.items[1].barcodes = ['6223000111222'];
  inv('purchase', 35, 'credit', s1, [[sugar, 200, 88], [rice, 100, 138], [oil, 60, 205]], 500);
  inv('purchase', 30, 'cash', s2, [[tea, 40, 315], [pasta, 100, 58]]);
  inv('sale', 28, 'cash', c3, [[sugar, 20, 110], [rice, 10, 170], [tea, 3, 380]]);
  inv('sale', 25, 'credit', c2, [[oil, 30, 245], [rice, 50, 165], [pasta, 60, 72]], 300);
  inv('sale', 20, 'credit', c1, [[sugar, 50, 108], [tea, 10, 375]]);
  vch('payment', 18, 'rent', 2500, 'إيجار المحل لهذا الشهر');
  vch('receipt', 15, c2, 10000, 'دفعة على الحساب');
  inv('saleReturn', 14, 'credit', c2, [[pasta, 5, 72]]);
  vch('payment', 12, s1, 30000, 'دفعة للمورد');
  inv('sale', 8, 'cash', '', [[sugar, 35, 110], [oil, 12, 250], [pasta, 40, 75], [lentil, 3, 145]]);
  vch('payment', 6, 'utilities', 900, 'فاتورة كهرباء');
  inv('purchase', 5, 'credit', s2, [[tea, 20, 2.6], [oil, 20, 1.7]], 0, 118);
  vch('receipt', 2, c2, 50, 'دفعة بالدولار', 121);
  vch('payment', 3, 'salaries', 2000, 'راتب العامل');
  inv('sale', 1, 'credit', c1, [[rice, 25, 168], [tea, 6, 380]]);
  vch('receipt', 0, c1, 5000, 'دفعة نقدية');
  save();
}

/* ------------------------- الإقلاع ------------------------- */
$('#appName').textContent = APP_NAME;
$('#topTitle').textContent = APP_NAME;
$('#coName').textContent = db.settings.company;
$('#menuBtn').onclick = () => document.body.classList.toggle('menu-open');
$('#backdrop').onclick = () => document.body.classList.remove('menu-open');
window.addEventListener('hashchange', route);
applySellerUI();
route();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
  // عند وصول نسخة جديدة: إعادة تحميل الصفحة مرة واحدة لتظهر التحديثات
  let reloaded = false; const hadCtrl = !!navigator.serviceWorker.controller;
  // ما منعمل إعادة تحميل وإنت عم تكتب فاتورة أو قيد — منستنى لتطلع منها
  const busyNow = () => /^#\/(invoice|entry)\//.test(location.hash) || $('#dlg').open;
  const doReload = () => { if (reloaded) return; if (busyNow()) return window.addEventListener('hashchange', doReload, { once: true }); reloaded = true; location.reload(); };
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!hadCtrl) return; doReload(); });
}
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('#installBtn').hidden = false; });
$('#installBtn').onclick = async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $('#installBtn').hidden = true; };
