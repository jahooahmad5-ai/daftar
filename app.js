'use strict';
/* =====================================================================
   دفتر — برنامج محاسبة بسيط يعمل في المتصفح (PWA)
   - كل البيانات محفوظة محلياً على الجهاز (localStorage)
   - القيود تتولّد تلقائياً من الفواتير والسندات (قيد مزدوج)
   - المخزون بطريقة الجرد المستمر وكلفة المتوسط المرجّح
   ===================================================================== */
const APP_NAME = 'دفتر';
const APP_VERSION = '2.9';

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
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.accounts)) { const s = seed(); return { ...s, ...d, settings: { ...s.settings, ...d.settings } }; }
  } catch (e) { /* بيانات تالفة */ }
  return seed();
}
let db = load();
let _eng = null;
function save() {
  _eng = null;
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { toast('تعذّر الحفظ: مساحة التخزين ممتلئة', 1); }
  $('#coName').textContent = db.settings.company;
  if (window.Cloud) Cloud.track();
}
const nextNo = k => (db.seq[k] = (db.seq[k] || 0) + 1);

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
  const disc = r2(num(inv.discount));
  return { gross, disc, net: r2(gross - disc) };
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
    const label = `${INV_TYPES[inv.type]} رقم ${inv.no}`;
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
  if (d.length === 10 && d.startsWith('09')) d = '963' + d.slice(1);
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
  let ph = waPhone(a && a.phone);
  if (!ph) {
    const n = prompt(`لا يوجد رقم واتساب صحيح لـ «${a ? a.name : ''}».\nاكتب الرقم (مثال 0991234567):`, (a && a.phone) || '');
    if (n === null) return;
    ph = waPhone(n);
    if (!ph) return toast('الرقم غير صحيح', 1);
    if (a) { a.phone = n.trim(); save(); }
  }
  window.open(`https://wa.me/${ph}?text=${encodeURIComponent(text)}`, '_blank');
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
  let s = `${waHead()}\n${INV_TYPES[inv.type]} رقم ${inv.no}\nالتاريخ: ${inv.date}\n${a ? 'السيد: ' + a.name + '\n' : ''}————————\n${lines}\n————————\n`;
  if (t.disc) s += `الإجمالي: ${fmt(t.gross)}\nالحسم: ${fmt(t.disc)}\n`;
  s += `*الصافي: ${fmt(t.net)} ${sym}*\n`;
  if (inv.cur === 'fx') s += `(المعادل: ${fmt(t.net * num(inv.rate))} ${cur()})\n`;
  else if (oldOn()) s += `(بالقديم: ${oldAmt(t.net)})\n`;
  s += `الدفع: ${inv.pay === 'cash' ? 'نقدي' : 'آجل'}\n`;
  if (a && inv.pay !== 'cash') s += `————————\nرصيد حسابكم الآن:\n${balWords(a, partyBal(a))}\n`;
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
function go(h) { if (location.hash === h) route(); else location.hash = h; }
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const [name, id] = path.split('/');
  const q = Object.fromEntries(new URLSearchParams(qs || ''));
  const view = $('#view');
  view.onclick = view.oninput = view.onchange = view.onsubmit = null;
  const key = V[name] ? name : 'home';
  const nav = NAV_MAP[key] || key;
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === nav));
  document.body.classList.remove('menu-open');
  V[key](id, q, view);
  window.scrollTo(0, 0);
}

/* ------------------------- الرئيسية ------------------------- */
V.home = (id, q, view) => {
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

  view.innerHTML = head('لوحة التحكم', `<span class="muted">${today()}</span>`) + `
  <div class="kpis">
    ${kpi('النقدية (صندوق + بنك)', fmt(bal('cashGroup')) + ' ' + cur(), 'p')}
    ${kpi('ذمم العملاء (لنا)', fmt(bal('customers')), 'g')}
    ${kpi('ذمم الموردين (علينا)', fmt(bal('suppliers')), 'r')}
    ${kpi('قيمة المخزون', fmt(bal('inventory')), 'a')}
    ${kpi('مبيعات هذا الشهر', fmt(monthSales), 'g')}
    ${kpi(`سعر صرف ${FX().name}`, `<button class="mini" data-act="rate" style="float:left">تعديل</button>${FX().rate ? fmt(FX().rate) + ' ' + cur() : '<span class="bad" style="font-size:15px">غير محدد</span>'}`, 'a')}
    ${kpi('صافي ربح السنة', `<span class="${profit < 0 ? 'neg' : 'pos'}">${fmt(profit)}</span>`, 'p')}
  </div>
  <div class="quick">
    <a href="#/invoice/new?type=sale"><i>🧾</i>فاتورة مبيع</a>
    <a href="#/invoice/new?type=purchase"><i>🛒</i>فاتورة شراء</a>
    <a href="#/vouchers?new=receipt"><i>📥</i>سند قبض</a>
    <a href="#/vouchers?new=payment"><i>📤</i>سند دفع</a>
    <a href="#/entry/new"><i>📝</i>قيد يومية</a>
    <a href="#/reports"><i>📊</i>التقارير</a>
  </div>
  <div class="cols2">
    <div class="card"><h3>آخر الفواتير</h3>${table(['الرقم', 'النوع', 'التاريخ', 'الطرف', 'الصافي'],
      recent.map(i => `<tr data-act="open" data-id="${i.id}"><td>${i.no}</td><td><span class="badge ${i.type}">${INV_TYPES[i.type]}</span></td><td class="n">${i.date}</td><td>${esc(accName(i.party) || 'نقدي')}</td><td class="n">${fmt(invTotals(i).net)} <small class="muted">${esc(docSym(i))}</small></td></tr>`).join(''))}</div>
    <div class="card"><h3>مواد وصلت للحد الأدنى</h3>${table(['المادة', 'الكمية', 'الحد الأدنى'],
      low.map(i => `<tr><td>${esc(i.name)}</td><td class="n"><span class="badge low">${fmt(st[i.id]?.qty || 0)}</span></td><td class="n">${fmt(i.minQty)}</td></tr>`).join(''))}
      ${!db.items.length ? `<p class="muted">لا توجد بيانات بعد. ابدأ بإضافة <a href="#/items">المواد</a> و<a href="#/parties">العملاء</a>، أو جرّب <a href="#/settings">البيانات التجريبية</a>.</p>` : ''}</div>
  </div>`;
  onAct(view, { open: id => go('#/invoice/' + id), rate: () => rateDialog() });
};
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
  const k = q.t === 's' ? 's' : 'c';
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

function itemForm(it, defGroup) {
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
      if (it) Object.assign(it, o); else db.items.push({ id: uid(), ...o });
      save(); toast('تم الحفظ'); route();
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
    `<a class="btn" href="#/groups">📂 المجموعات</a><button class="btn" data-act="import">📥 استيراد Excel</button><button class="btn pri" data-act="add">+ مادة جديدة</button>`) + `
    <div class="card"><div class="filters" style="margin-bottom:10px"><select id="gf" style="flex:1;min-width:160px">${optsHtml(gOpts, gf)}</select>
    <input class="search" id="q" placeholder="🔎 بحث بالاسم أو الرمز أو الباركود" style="flex:2;min-width:180px"></div>
    ${table(['الرمز', 'المادة', 'الوحدة', 'الكمية', 'متوسط الكلفة', 'قيمة المخزون', 'سعر المبيع', 'سعر المستهلك', ''], rows,
      `<tr><td colspan="5">إجمالي قيمة المخزون (${list.length} مادة)</td><td class="n">${fmt(tv)}</td><td colspan="3"></td></tr>`)}</div>`;
  $('#q', view).oninput = e => { const s = normAr(e.target.value); $$('tbody tr[data-name]', view).forEach(tr => (tr.style.display = tr.dataset.name.includes(s) ? '' : 'none')); };
  $('#gf', view).onchange = e => go('#/items' + (e.target.value ? '?g=' + e.target.value : ''));
  onAct(view, {
    add: () => itemForm(null, gf),
    import: () => window.ItemImport && ItemImport.open(),
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
  const t = q.t || 'all';
  const list = db.invoices.filter(i => t === 'all' || i.type === t).sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0));
  let tot = 0;
  const rows = list.map(i => {
    const n = invTotals(i).net; tot += n * docRate(i);
    return `<tr data-act="open" data-id="${i.id}" data-name="${esc(i.no + ' ' + accName(i.party))}"><td class="n">${i.no}</td><td><span class="badge ${i.type}">${INV_TYPES[i.type]}</span></td><td class="n">${i.date}</td>
      <td>${esc(accName(i.party) || '—')}</td><td>${i.pay === 'cash' ? 'نقدي' : 'آجل'}</td><td class="n">${fmt(n)} <small class="muted">${esc(docSym(i))}</small></td></tr>`;
  }).join('');
  const tab = (k, l) => `<a href="#/invoices?t=${k}" class="${t === k ? 'on' : ''}">${l}</a>`;
  view.innerHTML = head('الفواتير', Object.entries(INV_TYPES).map(([k, l]) => `<a class="btn ${k === 'sale' ? 'pri' : ''}" href="#/invoice/new?type=${k}">+ ${l}</a>`).join('')) + `
    <div class="tabs">${tab('all', 'الكل')}${Object.entries(INV_TYPES).map(([k, l]) => tab(k, l)).join('')}</div>
    <div class="card"><input class="search" id="q" placeholder="🔎 بحث برقم الفاتورة أو الاسم" style="margin-bottom:10px">
    ${table(['الرقم', 'النوع', 'التاريخ', 'الطرف', 'الدفع', 'الصافي'], rows, t !== 'all' ? `<tr><td colspan="5">المجموع (بـ ${esc(cur())})</td><td class="n">${fmt(tot)}</td></tr>` : '')}</div>`;
  $('#q', view).oninput = e => { const s = e.target.value.trim(); $$('tbody tr[data-name]', view).forEach(tr => (tr.style.display = tr.dataset.name.includes(s) ? '' : 'none')); };
  onAct(view, { open: id => go('#/invoice/' + id) });
};

function invoiceHtml(inv) {
  const t = invTotals(inv), sideSale = ['sale', 'saleReturn'].includes(inv.type), sym = docSym(inv);
  const hasCp = inv.lines.some(l => num(l.cp));
  const rows = inv.lines.map((l, i) => {
    const it = db.items.find(x => x.id === l.item) || {};
    return `<tr><td>${i + 1}</td><td>${esc(it.name || '')}</td><td>${esc(it.unit || '')}</td><td>${fmt(l.qty)}</td><td>${fmt(l.price)}</td>${hasCp ? `<td>${num(l.cp) ? fmt(l.cp) : ''}</td>` : ''}<td>${fmt(num(l.qty) * num(l.price))}</td></tr>`;
  }).join('');
  const cs = hasCp ? 6 : 5;
  return `<h3 class="ptitle">${INV_TYPES[inv.type]} رقم ${inv.no}</h3>
    <div class="pmeta"><span>التاريخ: ${inv.date}</span><span>${sideSale ? 'العميل' : 'المورد'}: ${esc(accName(inv.party) || 'نقدي')}</span><span>الدفع: ${inv.pay === 'cash' ? 'نقدي' : 'آجل'}</span><span>العملة: ${esc(docCurName(inv))}${inv.cur === 'fx' ? ` — سعر الصرف: ${fmt(inv.rate)}` : ''}</span></div>
    <table><thead><tr><th>#</th><th>المادة</th><th>الوحدة</th><th>الكمية</th><th>السعر</th>${hasCp ? '<th>سعر المستهلك</th>' : ''}<th>الإجمالي</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td colspan="${cs}">الإجمالي</td><td>${fmt(t.gross)}</td></tr>${t.disc ? `<tr><td colspan="${cs}">الحسم</td><td>${fmt(t.disc)}</td></tr>` : ''}<tr><td colspan="${cs}">الصافي (${esc(sym)})</td><td>${fmt(t.net)}</td></tr>
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
  const inv = orig ? clone(orig) : { id: null, type: INV_TYPES[q.type] ? q.type : 'sale', date: today(), pay: 'cash', cashAcc: cashAccounts()[0]?.id || '', party: '', cur: 'base', rate: db.settings.rate || '', lines: [], discount: 0, note: '' };
  inv.lines = inv.lines.filter(l => l.item);
  if (!inv.cur) inv.cur = 'base';
  if (!inv.rate) inv.rate = db.settings.rate || '';
  const sideSale = ['sale', 'saleReturn'].includes(inv.type);
  const parties = sideSale ? customers() : suppliers();
  const st = engine().stock;
  const items = [...db.items].sort(byCode);
  const itemById = id => items.find(x => x.id === id);
  const stockOf = it => (st[it.id] ? st[it.id].qty : num(it.openQty));

  view.innerHTML = head(INV_TYPES[inv.type] + (orig ? ` رقم ${orig.no}` : ' جديدة'),
    `${!orig ? '<button class="btn" data-act="paste">📋 لصق طلبية</button>' : ''}${orig ? `${orig.party ? '<button class="btn wa" data-act="wa">واتساب</button>' : ''}<button class="btn" data-act="receipt">🧾 إيصال</button><button class="btn" data-act="print">🖨 طباعة</button><button class="btn red" data-act="del">حذف</button>` : ''}<a class="btn" href="#/invoices">رجوع</a>`) + `
  <div class="search-wrap">
    <div class="scan-row">
      ${canScan() ? '<button class="sq-btn" data-act="cam" title="مسح بالكاميرا">▮▯▮</button>' : ''}
      <input id="scanIn" type="search" enterkeyhint="search" autocomplete="off" placeholder="ادخل اسم المادة أو الباركود لإضافتها للفاتورة">
      ${canVoice() ? '<button class="sq-btn round" data-act="mic" title="بحث صوتي">🎤</button>' : ''}
    </div>
    <div id="sugg" class="sugg" hidden></div>
  </div>
  <div id="ln" class="ln-list"></div>
  <div class="card">
    <div class="grid4">
      ${field({ k: 'date', l: 'التاريخ', t: 'date', req: 1 }, inv.date)}
      ${field({ k: 'pay', l: 'طريقة الدفع', t: 'select', opts: [['cash', 'نقدي'], ['credit', 'آجل (على الحساب)']] }, inv.pay)}
      <div id="cashWrap">${field({ k: 'cashAcc', l: 'الصندوق', t: 'select', opts: accOpts(cashAccounts()) }, inv.cashAcc)}</div>
      ${field({ k: 'party', l: sideSale ? 'العميل' : 'المورد', t: 'select', opts: accOpts(parties, '— بدون —') }, inv.party)}
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
        <div><span>الحسم</span><input name="discount" type="number" step="any" inputmode="decimal" value="${esc(inv.discount || '')}"></div>
        <div class="net"><span>الصافي</span><b id="tNet" class="n">0</b></div>
        <div id="tEq" class="muted" style="font-size:14px"></div>
        <div id="tOld" class="old-eq"></div>
        <small class="muted" id="tWords"></small>
        <div id="tPay" class="old-eq" hidden></div>
      </div>
    </div>
  </div>
  <div class="inv-bar">
    <div class="inv-bar-sum"><small id="barInfo"></small><b id="barNet">0</b><small id="barOld" class="old-bar"></small></div>
    ${orig ? '' : '<button class="btn" data-act="saveNew">＋ حفظ وجديد</button>'}
    <button class="btn pri" data-act="save">💾 حفظ</button>
  </div>`;

  const val = n => $(`[name="${n}"]`, view).value;
  const rate = () => num(val('rate'));
  const toggles = () => {
    $('#cashWrap', view).style.visibility = val('pay') === 'cash' ? 'visible' : 'hidden';
    $('#rateWrap', view).style.visibility = inv.cur === 'fx' ? 'visible' : 'hidden';
  };
  const totals = () => {
    const g = inv.lines.reduce((s, l) => s + num(l.qty) * num(l.price), 0), n = g - num(val('discount')), sym = docSym(inv);
    $('#tGross', view).textContent = fmt(g) + ' ' + sym; $('#tNet', view).textContent = fmt(n) + ' ' + sym;
    const eq = $('#tEq', view), R = inv.cur === 'fx' ? rate() : FX().rate;
    eq.textContent = !n || !R ? '' : inv.cur === 'fx' ? `المعادل: ${fmt(n * R)} ${cur()}` : `المعادل: ${fmt(n / R)} ${FX().sym}`;
    $('#tWords', view).textContent = n > 0 ? moneyWords(n, inv) : '';
    const nb = inv.cur === 'fx' ? n * rate() : n;
    $('#tOld', view).textContent = oldOn() && nb ? `الصافي بالعملة القديمة: ${oldAmt(nb)} ${cur()}` : '';
    $('#barOld', view).textContent = oldTxt(nb);
    const cnt = inv.lines.reduce((s, l) => s + num(l.qty), 0);
    $('#barNet', view).textContent = fmt(n) + ' ' + sym;
    $('#barInfo', view).textContent = `${inv.lines.length} مادة — ${fmt(cnt)} قطعة${val('pay') === 'credit' ? ' — آجل' : ' — نقدي'}`;
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
        <b class="ln-name">${esc(it.name)}</b>
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
  const draw = () => {
    $('#ln', view).innerHTML = inv.lines.length ? inv.lines.map(lineHtml).join('')
      : `<div class="empty card">ابحث عن مادة بالاسم أو امسح الباركود لإضافتها للفاتورة</div>`;
    totals();
  };
  // تحويل سعر من الليرة إلى عملة الفاتورة الحالية
  const toDoc = base => (inv.cur === 'fx' && rate() ? r2(base / rate()) : base);
  const basePrice = it => (sideSale ? num(it.sellPrice) : (num(it.buyPrice) || r2(st[it.id]?.avg || 0)));
  // إضافة مادة: إذا كانت موجودة بالفاتورة تزيد الكمية
  const addItem = it => {
    const ex = inv.lines.find(l => l.item === it.id);
    if (ex) ex.qty = num(ex.qty) + 1;
    else inv.lines.push({ item: it.id, qty: 1, price: toDoc(basePrice(it)), cp: it.consumerPrice ? toDoc(num(it.consumerPrice)) : '' });
    draw(); navigator.vibrate?.(40); toast('✓ ' + it.name);
  };
  let payNow = 0;
  const showPay = () => { const e = $('#tPay', view); e.hidden = !payNow; e.innerHTML = payNow ? `💵 دفعة مع الفاتورة: <b>${fmt(payNow)} ${esc(cur())}</b>${oldOn() ? ` (بالقديم ${oldAmt(payNow)})` : ''} <button type="button" class="mini red" data-act="noPay">إلغاء</button>` : ''; };
  const fromPaste = r => {
    if (r.party) {
      const sel = $('[name="party"]', view);
      if (![...sel.options].some(o => o.value === r.party)) sel.add(new Option(accName(r.party), r.party));
      sel.value = r.party; $('[name="pay"]', view).value = 'credit'; toggles();
    }
    r.lines.forEach(({ item, qty }) => {
      const it = db.items.find(x => x.id === item); if (!it) return;
      const ex = inv.lines.find(l => l.item === item);
      if (ex) ex.qty = num(ex.qty) + qty;
      else inv.lines.push({ item, qty, price: toDoc(basePrice(it)), cp: it.consumerPrice ? toDoc(num(it.consumerPrice)) : '' });
    });
    payNow = r.pay || 0; showPay(); draw();
    if (r.lines.length > 1 || r.skipped) toast(`انضاف ${r.lines.length} مادة${r.skipped ? ` — ${r.skipped} سطر ما انضاف` : ''}`);
  };
  const addByCode = code => { const it = findByCode(code); if (it) addItem(it); else toast('لا توجد مادة بهذا الباركود: ' + code, 1); };

  /* ---- البحث مع الاقتراحات ---- */
  const scanIn = $('#scanIn', view), sugg = $('#sugg', view);
  let matches = [];
  const search = txt => {
    const qn = normAr(txt);
    if (!qn) return [];
    const words = qn.split(/\s+/);
    return items.filter(it => {
      if (itemCodes(it).some(c => c.startsWith(txt.trim()))) return true;
      const nm = normAr(it.name);
      return words.every(w => nm.includes(w));
    }).slice(0, 8);
  };
  const showSugg = () => {
    matches = search(scanIn.value);
    if (!scanIn.value.trim()) { sugg.hidden = true; return; }
    sugg.hidden = false;
    sugg.innerHTML = matches.length ? matches.map((it, i) => {
      const s = stockOf(it), low = s <= 0 || (num(it.minQty) > 0 && s <= num(it.minQty));
      return `<button type="button" class="sg" data-i="${i}">
        <b>${esc(it.name)}</b>
        <span class="sg-meta"><span>💰 ${fmt(toDoc(basePrice(it)))}${oldOn() ? ` <small class="muted">(${oldAmt(basePrice(it))} قديم)</small>` : ''}</span><span class="${s <= 0 ? 'bad' : ''}">📦 ${fmt(s)} ${esc(it.unit || '')}</span></span>
        ${low ? `<small class="bad">${s <= 0 ? 'نفدت المادة' : 'قاربت المادة على النفاد'}</small>` : ''}
      </button>`;
    }).join('') : smartHtml();
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
  const pick = it => { scanIn.value = ''; sugg.hidden = true; addItem(it); };
  scanIn.addEventListener('input', showSugg);
  scanIn.addEventListener('focus', () => setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 250));
  scanIn.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const c = scanIn.value.trim(); if (!c) return;
    const exact = findByCode(c);
    if (exact) pick(exact);
    else if (matches.length === 1) pick(matches[0]);
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
      const l = inv.lines[card.dataset.i]; l[e.target.dataset.f] = e.target.value;
      $('[data-tot]', card).textContent = fmt(num(l.qty) * num(l.price)); $('[data-old]', card).textContent = lineOld(l); totals();
    } else if (e.target.name === 'discount' || e.target.name === 'rate') totals();
  };
  view.onchange = e => {
    if (e.target.name === 'pay') { toggles(); totals(); }
    else if (e.target.name === 'cur') {
      const to = e.target.value, R = rate();
      if (to === 'fx' && !R) { toast('أدخل سعر الصرف أولاً (من الإعدادات أو من الرئيسية)', 1); }
      if (R && to !== inv.cur && inv.lines.some(l => num(l.price)) && confirm('تحويل الأسعار المدخلة إلى العملة الجديدة حسب سعر الصرف؟')) {
        const c = x => (num(x) ? r2(to === 'fx' ? num(x) / R : num(x) * R) : x);
        inv.lines.forEach(l => { l.price = c(l.price); l.cp = c(l.cp); });
        const d = $('[name=discount]', view); d.value = c(d.value) || '';
      }
      inv.cur = to; toggles(); draw();
    }
  };
  const doSave = andNew => {
    const lines = inv.lines.filter(l => l.item && num(l.qty) > 0).map(l => ({ item: l.item, qty: num(l.qty), price: num(l.price), cp: num(l.cp) }));
    if (!lines.length) return toast('أضف مادة واحدة على الأقل بكمية صحيحة', 1);
    const pay = val('pay'), party = val('party'), cashAcc = val('cashAcc');
    if (pay === 'credit' && !party) return toast(`الفاتورة الآجلة تحتاج ${sideSale ? 'عميلاً' : 'مورداً'}`, 1);
    if (pay === 'cash' && !cashAcc) return toast('اختر الصندوق', 1);
    if (!val('date')) return toast('أدخل التاريخ', 1);
    if (inv.cur === 'fx' && rate() <= 0) return toast('أدخل سعر الصرف للفاتورة', 1);
    if (['sale', 'purchaseReturn'].includes(inv.type)) {
      const need = {};
      lines.forEach(l => (need[l.item] = (need[l.item] || 0) + l.qty));
      const short = Object.entries(need).filter(([it, qn]) => {
        const before = orig ? orig.lines.filter(l => l.item === it).reduce((s, l) => s + num(l.qty), 0) : 0;
        return (st[it]?.qty || 0) + before < qn;
      });
      if (short.length && !confirm('الكمية المطلوبة أكبر من المتوفر في المستودع لبعض المواد:\n' + short.map(([it]) => db.items.find(x => x.id === it)?.name).join('، ') + '\nهل تريد المتابعة؟')) return;
    }
    const out = { ...inv, date: val('date'), pay, party, cashAcc: pay === 'cash' ? cashAcc : '', cur: inv.cur, rate: inv.cur === 'fx' ? rate() : '', discount: num(val('discount')), note: val('note'), lines };
    if (!orig) { out.id = uid(); out.no = nextNo(out.type); out.created = Date.now(); db.invoices.push(out); }
    if (!orig && payNow > 0 && party) {
      const vt = sideSale ? 'receipt' : 'payment';
      db.vouchers.push({ id: uid(), type: vt, no: nextNo(vt), date: out.date, acc: party, cashAcc: cashAccounts()[0]?.id || 'cash', amount: payNow, note: `دفعة على ${INV_TYPES[out.type]} رقم ${out.no}`, cur: 'base', rate: '', created: Date.now() + 1 });
    }
    else db.invoices[db.invoices.indexOf(orig)] = out;
    save(); toast('تم حفظ الفاتورة رقم ' + out.no);
    go(andNew ? '#/invoice/new?type=' + out.type : '#/invoice/' + out.id);
  };
  const step = (i, d) => {
    const l = inv.lines[+i]; const nq = r2(num(l.qty) + d);
    if (nq <= 0) { inv.lines.splice(+i, 1); draw(); return; }
    l.qty = nq;
    const card = $(`.ln-card[data-i="${i}"]`, view);
    $('[data-f=qty]', card).value = nq; $('[data-tot]', card).textContent = fmt(nq * num(l.price)); $('[data-old]', card).textContent = lineOld(l); totals();
  };
  onAct(view, {
    cam: () => scanBarcode(addByCode),
    paste: () => window.OrderPaste && OrderPaste.open({ sideSale, onDone: fromPaste }),
    noPay: () => { payNow = 0; showPay(); },
    mic: () => (window.Voice ? Voice.listen() : voice()),
    inc: i => step(i, 1),
    dec: i => step(i, -1),
    rmLine: i => { inv.lines.splice(+i, 1); draw(); },
    save: () => doSave(false),
    saveNew: () => doSave(true),
    print: () => printDoc(invoiceHtml(orig)),
    wa: () => waSend(acc(orig.party), waInvoiceText(orig)),
    receipt: () => window.Receipt && Receipt.open(orig),
    del: () => { if (!confirm('حذف الفاتورة نهائياً؟ سيتم عكس أثرها على الحسابات والمستودع.')) return; db.invoices = db.invoices.filter(x => x !== orig); save(); toast('تم الحذف'); go('#/invoices'); },
  });
  toggles(); draw();
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
    save: () => doSave(false),
    undo: () => { inv.lines.pop(); draw(); },
  };
  if (window.Voice) Voice.invReady();
};

/* ------------------------- السندات ------------------------- */
function voucherForm(v, type, preAcc) {
  type = v ? v.type : type;
  const isR = type === 'receipt';
  const others = postable().filter(a => !isUnder(a.id, 'cashGroup') && a.id !== 'inventory');
  const vals = v ? { cur: 'base', ...v } : { date: today(), acc: preAcc || '', cashAcc: cashAccounts()[0]?.id, amount: '', cur: 'base', rate: db.settings.rate || '' };
  if (!vals.rate) vals.rate = db.settings.rate || '';
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
    extra: v ? `<button type="button" class="btn" id="vPrint">🖨 طباعة</button><button type="button" class="btn red" id="vDel">حذف</button>` : '',
    onSave: d => {
      const amount = r2(num(d.amount)), R = num(d.rate);
      if (amount <= 0) { toast('أدخل مبلغاً صحيحاً', 1); return false; }
      if (!d.acc) { toast('اختر الحساب', 1); return false; }
      if (d.cur === 'fx' && R <= 0) { toast('أدخل سعر الصرف', 1); return false; }
      const o = { date: d.date, amount, acc: d.acc, cashAcc: d.cashAcc, note: d.note, cur: d.cur, rate: d.cur === 'fx' ? R : '' };
      if (v) Object.assign(v, o); else db.vouchers.push({ id: uid(), type, no: nextNo(type), created: Date.now(), ...o });
      save(); toast('تم حفظ السند'); go('#/vouchers?t=' + type);
    },
  });
  const rateFld = $('[name=rate]', f).closest('.fld');
  const upd = () => {
    const fx = $('[name=cur]', f).value === 'fx', a = num($('[name=amount]', f).value), R = num($('[name=rate]', f).value);
    rateFld.style.visibility = fx ? 'visible' : 'hidden';
    const base = fx ? a * R : a;
    $('#vEq').textContent = [fx && a && R ? `المعادل: ${fmt(base)} ${cur()}` : '', oldOn() && base ? `بالعملة القديمة: ${oldAmt(base)}` : ''].filter(Boolean).join(' — ');
  };
  f.oninput = f.onchange = upd; upd();
  if (v) {
    $('#vDel').onclick = () => { if (!confirm('حذف السند؟')) return; db.vouchers = db.vouchers.filter(x => x !== v); save(); $('#dlg').close(); route(); };
    $('#vPrint').onclick = () => { $('#dlg').close(); printDoc(voucherHtml(v)); };
  }
}
function voucherHtml(v) {
  const isR = v.type === 'receipt';
  return `<h3 class="ptitle">${isR ? 'سند قبض' : 'سند دفع'} رقم ${v.no}</h3>
  <table><tbody><tr><th>التاريخ</th><td>${v.date}</td></tr><tr><th>${isR ? 'استلمنا من' : 'دفعنا إلى'}</th><td>${esc(accName(v.acc))}</td></tr>
  <tr><th>المبلغ</th><td>${fmt(v.amount)} ${esc(docSym(v))}${oldOn() ? ` — بالعملة القديمة: ${oldAmt(v.amount * docRate(v))}` : ''}</td></tr><tr><th>المبلغ كتابةً</th><td>${esc(moneyWords(v.amount, v))}</td></tr>
  ${v.cur === 'fx' ? `<tr><th>سعر الصرف</th><td>${fmt(v.rate)} — المعادل: ${fmt(v.amount * num(v.rate))} ${esc(cur())}</td></tr>` : ''}
  <tr><th>البيان</th><td>${esc(v.note || '')}</td></tr><tr><th>${isR ? 'إلى الصندوق' : 'من الصندوق'}</th><td>${esc(accName(v.cashAcc))}</td></tr></tbody></table>
  <div class="psign"><span>${isR ? 'توقيع الدافع' : 'توقيع المستلم'}</span><span>توقيع المحاسب</span></div>`;
}
V.vouchers = (id, q, view) => {
  const t = q.t === 'payment' ? 'payment' : q.t === 'receipt' ? 'receipt' : 'all';
  const list = db.vouchers.filter(v => t === 'all' || v.type === t).sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0));
  const rows = list.map(v => `<tr data-act="open" data-id="${v.id}"><td class="n">${v.no}</td><td><span class="badge ${v.type === 'receipt' ? 'sale' : 'purchaseReturn'}">${v.type === 'receipt' ? 'قبض' : 'دفع'}</span></td>
    <td class="n">${v.date}</td><td>${esc(accName(v.acc))}</td><td>${esc(v.note || '')}</td><td class="n">${fmt(v.amount)} <small class="muted">${esc(docSym(v))}</small></td></tr>`).join('');
  const tab = (k, l) => `<a href="#/vouchers?t=${k}" class="${t === k ? 'on' : ''}">${l}</a>`;
  view.innerHTML = head('سندات القبض والدفع', `<button class="btn pri" data-act="new" data-id="receipt">📥 سند قبض</button><button class="btn" data-act="new" data-id="payment">📤 سند دفع</button>`) +
    `<div class="tabs">${tab('all', 'الكل')}${tab('receipt', 'سندات القبض')}${tab('payment', 'سندات الدفع')}</div>
    <div class="card">${table(['الرقم', 'النوع', 'التاريخ', 'الحساب', 'البيان', 'المبلغ'], rows)}</div>`;
  onAct(view, {
    new: type => voucherForm(null, type),
    open: id => voucherForm(db.vouchers.find(v => v.id === id)),
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
    del: () => { if (!confirm('حذف القيد؟')) return; db.entries = db.entries.filter(x => x !== orig); save(); go('#/journal'); },
    save: () => {
      const lines = en.lines.filter(l => l.acc && (num(l.dr) || num(l.cr))).map(l => ({ acc: l.acc, dr: r2(num(l.dr)), cr: r2(num(l.cr)), note: l.note || '' }));
      if (lines.length < 2) return toast('القيد يحتاج سطرين على الأقل', 1);
      const dr = r2(lines.reduce((s, l) => s + l.dr, 0)), cr = r2(lines.reduce((s, l) => s + l.cr, 0));
      if (dr !== cr) return toast('القيد غير متوازن: مجموع المدين لا يساوي مجموع الدائن', 1);
      const date = $('[name=date]', view).value, desc = $('[name=desc]', view).value.trim();
      if (!date) return toast('أدخل التاريخ', 1);
      if (orig) Object.assign(orig, { date, desc, lines });
      else db.entries.push({ id: uid(), no: nextNo('entry'), date, desc, lines });
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
      { k: 'receiptFooter', l: 'عبارة أسفل الإيصال', ph: 'شكراً لتعاملكم معنا' },
    ], s)}
    <div class="form-actions"><button class="btn pri">حفظ الإعدادات</button></div>
  </form>
  <div class="card" id="cloudCard"></div>
  <div class="card"><h3>النسخ الاحتياطي</h3>
    <p class="muted">البيانات محفوظة على هذا الجهاز فقط داخل المتصفح. خذ نسخة احتياطية بانتظام واحفظها في مكان آمن، ويمكنك نقلها لجهاز آخر.</p>
    <div class="acts"><button class="btn pri" data-act="export">⬇️ تنزيل نسخة احتياطية</button>
    <label class="btn">⬆️ استعادة نسخة<input type="file" id="imp" accept=".json,application/json" hidden></label></div>
  </div>
  <div class="card"><h3>أخرى</h3>
    <div class="acts"><button class="btn" data-act="demo">🧪 تحميل بيانات تجريبية</button><button class="btn red" data-act="reset">🗑 مسح كل البيانات</button></div>
    <p class="muted" style="margin-top:10px">الإصدار: <b>${APP_VERSION}</b> — عدد الفواتير: ${db.invoices.length} — المواد: ${db.items.length} — السندات: ${db.vouchers.length} — القيود اليدوية: ${db.entries.length}</p>
  </div>`;
  if (window.Cloud) Cloud.card($('#cloudCard', view)); else $('#cloudCard', view).remove();
  $('#sf', view).onsubmit = e => {
    e.preventDefault();
    Object.assign(db.settings, Object.fromEntries(new FormData(e.target)));
    save(); toast('تم حفظ الإعدادات');
  };
  $('#imp', view).onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!Array.isArray(d.accounts) || !Array.isArray(d.invoices)) throw 0;
        if (!confirm('سيتم استبدال كل البيانات الحالية بالنسخة المختارة. متابعة؟')) return;
        const sd = seed(); db = { ...sd, ...d, settings: { ...sd.settings, ...d.settings } }; save(); toast('تمت الاستعادة'); go('#/');
      } catch (err) { toast('الملف غير صالح', 1); }
    };
    r.readAsText(f);
  };
  onAct(view, {
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
route();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
  // عند وصول نسخة جديدة: إعادة تحميل الصفحة مرة واحدة لتظهر التحديثات
  let reloaded = false; const hadCtrl = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloaded || !hadCtrl) return; reloaded = true; location.reload(); });
}
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; $('#installBtn').hidden = false; });
$('#installBtn').onclick = async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $('#installBtn').hidden = true; };
