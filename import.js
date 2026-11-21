/* استيراد المواد من ملف Excel أو CSV (مثلاً تصدير من المحاسب السهل أو أي برنامج) */
'use strict';
const ItemImport = (() => {
  const FIELDS = [
    { k: 'name', l: 'اسم المادة', req: 1, syn: ['اسم المادة', 'المادة', 'اسم الصنف', 'الصنف', 'الاسم', 'البيان', 'name', 'item'] },
    { k: 'code', l: 'رمز المادة', syn: ['رمز المادة', 'الرمز', 'كود', 'الكود', 'رقم المادة', 'رقم الصنف', 'code'] },
    { k: 'barcode', l: 'الباركود', syn: ['باركود', 'الباركود', 'barcode', 'الرمز الشريطي'] },
    { k: 'unit', l: 'الوحدة', syn: ['الوحدة', 'وحدة', 'unit'] },
    { k: 'group', l: 'المجموعة (أو المجموعة الرئيسية)', syn: ['المجموعة', 'مجموعة', 'المجموعة الرئيسية', 'الفئة', 'التصنيف', 'الشركة', 'group', 'category'] },
    { k: 'sub', l: 'المجموعة الفرعية', syn: ['المجموعة الفرعية', 'مجموعة فرعية', 'الفرعية', 'subgroup'] },
    { k: 'buyPrice', l: 'سعر الشراء', syn: ['سعر الشراء', 'الشراء', 'التكلفة', 'الكلفة', 'سعر التكلفة', 'cost'] },
    { k: 'sellPrice', l: 'سعر المبيع', syn: ['سعر المبيع', 'سعر البيع', 'المبيع', 'البيع', 'السعر', 'سعر الجملة', 'price'] },
    { k: 'consumerPrice', l: 'سعر المستهلك', syn: ['سعر المستهلك', 'المستهلك', 'سعر المفرق', 'المفرق'] },
    { k: 'openQty', l: 'الكمية (أول المدة)', syn: ['الكمية', 'كمية', 'الرصيد', 'كمية أول المدة', 'المخزون', 'qty'] },
    { k: 'minQty', l: 'الحد الأدنى', syn: ['الحد الأدنى', 'حد الطلب', 'min'] },
  ];
  const N = s => normAr(String(s || '')).replace(/[\s_:.\-]+/g, ' ').trim();
  const toNum = v => { if (typeof v === 'number') return v; const s = String(v ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٬,\s]/g, '').replace('٫', '.'); const n = parseFloat(s); return isFinite(n) ? n : 0; };

  let libP = null;
  const loadLib = () => libP || (libP = new Promise((ok, bad) => {
    if (window.XLSX) return ok();
    const s = document.createElement('script'); s.src = 'lib/xlsx.full.min.js'; s.onload = ok; s.onerror = () => { libP = null; bad(new Error('ما قدر يحمّل مكتبة Excel، تأكد من الإنترنت')); };
    document.head.appendChild(s);
  }));

  async function readFile(file) {
    await loadLib();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', codepage: 1256 });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true, blankrows: false });
  }

  function guess(rows, FIELDS) {
    // سطر العناوين: أول سطر (من أول 10) فيه أكبر عدد عناوين معروفة
    let best = { i: 0, score: -1 };
    rows.slice(0, 10).forEach((r, i) => {
      const sc = r.reduce((s, c) => s + (FIELDS.some(f => f.syn.some(x => N(c) === N(x))) ? 1 : 0), 0);
      if (sc > best.score) best = { i, score: sc };
    });
    const hdr = rows[best.i] || [];
    const map = {}, used = new Set();
    for (const f of FIELDS) {
      let idx = hdr.findIndex((c, j) => !used.has(j) && f.syn.some(x => N(c) === N(x)));
      if (idx < 0) idx = hdr.findIndex((c, j) => !used.has(j) && N(c) && f.syn.some(x => N(c).includes(N(x))));
      if (idx >= 0) { map[f.k] = idx; used.add(idx); }
    }
    return { hr: best.score > 0 ? best.i : -1, map };
  }

  function findGroup(name, parent) {
    const n = N(name);
    return db.groups.find(g => (g.parent || null) === (parent || null) && N(g.name) === n);
  }
  function ensureGroup(name, parent) {
    name = String(name || '').trim(); if (!name) return parent || null;
    let g = findGroup(name, parent);
    if (!g) { g = { id: uid(), code: nextGrpCode(parent || null), name, parent: parent || null }; db.groups.push(g); }
    return g.id;
  }

  function run(rows, hr, map, mode) {
    const res = { add: 0, upd: 0, skip: 0, bad: 0, groups: db.groups.length };
    const cell = (r, k) => (map[k] === undefined || map[k] === '' ? '' : r[map[k]]);
    let nextCode = parseInt(nextItemCode(), 10);
    for (const r of rows.slice(hr + 1)) {
      const name = String(cell(r, 'name') ?? '').trim();
      if (!name) { res.bad++; continue; }
      const code = String(cell(r, 'code') ?? '').trim();
      const bcs = parseCodes(cell(r, 'barcode')).filter(b => b !== code);
      let ex = null;
      if (code) ex = db.items.find(i => i.code === code);
      if (!ex && bcs.length) ex = db.items.find(i => bcs.some(b => itemCodes(i).includes(b)));
      if (!ex) ex = db.items.find(i => N(i.name) === N(name));
      if (ex && mode === 'skip') { res.skip++; continue; }
      let gid;
      const gTxt = String(cell(r, 'group') ?? '').trim(), sTxt = String(cell(r, 'sub') ?? '').trim();
      if (gTxt || sTxt) {
        const path = gTxt.split(/\s*[›>\/\\|]\s*/).filter(Boolean);
        if (sTxt) path.push(sTxt);
        gid = null; for (const p of path) gid = ensureGroup(p, gid);
      }
      const o = { name };
      const setN = k => { if (map[k] !== undefined && map[k] !== '' && String(cell(r, k)).trim() !== '') o[k] = toNum(cell(r, k)); };
      ['buyPrice', 'sellPrice', 'consumerPrice', 'minQty'].forEach(setN);
      if (map.unit !== undefined && map.unit !== '' && String(cell(r, 'unit')).trim()) o.unit = String(cell(r, 'unit')).trim();
      if (gid !== undefined) o.group = gid;
      if (map.openQty !== undefined && map.openQty !== '' && String(cell(r, 'openQty')).trim() !== '') {
        o.openQty = toNum(cell(r, 'openQty'));
        o.openCost = o.buyPrice ?? (ex ? num(ex.openCost) || num(ex.buyPrice) : 0);
      }
      // باركودات مكررة عند مادة تانية تُتجاهل
      const free = bcs.filter(b => !db.items.some(i => i !== ex && itemCodes(i).includes(b)));
      if (ex) {
        Object.assign(ex, o);
        if (free.length) ex.barcodes = [...new Set([...(ex.barcodes || []), ...free])];
        res.upd++;
      } else {
        let c = code && !db.items.some(i => itemCodes(i).includes(code)) ? code : '';
        if (!c) { c = String(nextCode++).padStart(3, '0'); while (db.items.some(i => itemCodes(i).includes(c))) c = String(nextCode++).padStart(3, '0'); }
        db.items.push({ id: uid(), code: c, barcodes: free, group: null, unit: 'قطعة', minQty: 0, buyPrice: 0, sellPrice: 0, consumerPrice: 0, openQty: 0, openCost: 0, ...o });
        res.add++;
      }
    }
    res.groups = db.groups.length - res.groups;
    return res;
  }

  function dl(name, rows) {
    const csv = '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const u = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 3000);
  }

  /* معالج عام: اختيار ملف ← ربط الأعمدة ← تنفيذ */
  function wizard({ title, intro, fields, tpl, extra = () => '', exec }) {
    modal(title, `
      <p class="muted" style="margin-top:0">${intro}</p>
      <div class="acts" style="margin-bottom:10px">
        <label class="btn pri">📂 اختيار ملف<input type="file" id="impF" accept=".xlsx,.xls,.csv,.ods,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" hidden></label>
        <button type="button" class="btn" id="impT">⬇️ نموذج جاهز</button>
      </div>
      <div id="impBody"></div>`);
    const d = $('#dlg'), body = $('#impBody', d);
    $('#impT', d).onclick = () => dl(tpl.name, tpl.rows);
    $('#impF', d).onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      body.innerHTML = '<p class="muted">عم يقرأ الملف…</p>';
      let rows;
      try { rows = await readFile(f); } catch (err) { body.innerHTML = `<p class="bad">❌ ${esc(err.message || 'الملف غير صالح')}</p>`; return; }
      if (!rows.length) { body.innerHTML = '<p class="bad">الملف فاضي</p>'; return; }
      const g = guess(rows, fields), hr = g.hr;
      const hdr = hr >= 0 ? rows[hr] : rows[0].map((_, j) => 'عمود ' + (j + 1));
      const colOpts = [['', '— لا يوجد —'], ...hdr.map((c, j) => [String(j), `${String(c || 'عمود ' + (j + 1))}`])];
      const sample = rows.slice(hr + 1, hr + 4);
      body.innerHTML = `
        <p><b>${esc(f.name)}</b> — ${rows.length - hr - 1} سطر</p>
        <p class="muted" style="font-size:13px">تأكد إن كل خانة مربوطة بالعمود الصح من ملفك:</p>
        <div class="grid2">${fields.map(fl => `<label class="fld"><span>${fl.l}${fl.req ? ' *' : ''}</span><select data-map="${fl.k}">${optsHtml(colOpts, map0(g.map[fl.k]))}</select></label>`).join('')}</div>
        ${extra()}
        <label class="fld" style="margin-top:8px"><span>إذا كان موجود من قبل (نفس الرمز أو الاسم)</span>
          <select id="impMode"><option value="update">حدّث بياناته</option><option value="skip">اتركه متل ما هو</option></select></label>
        <div class="tbl" style="margin-top:10px">${table(hdr.map(c => esc(String(c))), sample.map(r => `<tr>${hdr.map((_, j) => `<td>${esc(String(r[j] ?? ''))}</td>`).join('')}</tr>`).join(''))}</div>
        <div class="acts" style="margin-top:12px"><button type="button" class="btn pri" id="impGo">✅ استيراد</button></div>`;
      $('#impGo', d).onclick = () => {
        const map = {}; $$('[data-map]', body).forEach(s => { if (s.value !== '') map[s.dataset.map] = +s.value; });
        const miss = fields.find(f => f.req && map[f.k] === undefined);
        if (miss) return toast('لازم تختار عمود ' + miss.l, 1);
        const opts = Object.fromEntries($$('[data-opt]', body).map(x => [x.dataset.opt, x.value]));
        const msg = exec(rows, hr, map, $('#impMode', body).value, opts);
        save();
        body.innerHTML = `<div class="card" style="background:var(--green-soft)"><b>✅ خلص الاستيراد</b><br>${msg}</div>`;
        route();
      };
    };
  }

  function open() {
    wizard({
      title: '📥 استيراد المواد من Excel',
      intro: 'اختار ملف Excel (‎.xlsx / .xls) أو CSV فيه المواد. لازم يكون فيه عمود لاسم المادة على الأقل، والباقي اختياري.',
      fields: FIELDS,
      tpl: { name: 'نموذج-استيراد-المواد.csv', rows: [['رمز المادة', 'اسم المادة', 'الباركود', 'الوحدة', 'المجموعة', 'المجموعة الفرعية', 'سعر الشراء', 'سعر المبيع', 'سعر المستهلك', 'الكمية'], ['001', 'شامبو ديلوكس 400 مل', '6281000000017', 'قطعة', 'ديلوكس', 'شامبو', '20', '25', '30', '48']] },
      exec: (rows, hr, map, mode) => {
        const r = run(rows, hr, map, mode);
        toast(`تم استيراد ${r.add + r.upd} مادة`);
        return `مواد جديدة: <b>${r.add}</b> — تحدّثت: <b>${r.upd}</b>${r.skip ? ` — تُركت: <b>${r.skip}</b>` : ''}${r.groups ? ` — مجموعات جديدة: <b>${r.groups}</b>` : ''}${r.bad ? `<br><small class="muted">${r.bad} سطر بلا اسم تجاهلناهن</small>` : ''}`;
      },
    });
  }

  /* ---------- استيراد العملاء والموردين مع أرصدتهم ---------- */
  const PFIELDS = [
    { k: 'name', l: 'الاسم', req: 1, syn: ['الاسم', 'اسم الحساب', 'اسم العميل', 'اسم الزبون', 'اسم المورد', 'الحساب', 'العميل', 'الزبون', 'المورد', 'name'] },
    { k: 'code', l: 'الرمز', syn: ['الرمز', 'رمز الحساب', 'رقم الحساب', 'كود', 'الكود', 'code'] },
    { k: 'phone', l: 'الهاتف', syn: ['الهاتف', 'هاتف', 'الموبايل', 'موبايل', 'الجوال', 'رقم الهاتف', 'تلفون', 'phone', 'mobile'] },
    { k: 'address', l: 'العنوان', syn: ['العنوان', 'عنوان', 'address'] },
    { k: 'bal', l: 'الرصيد (رقم واحد)', syn: ['الرصيد', 'رصيد', 'الرصيد الحالي', 'رصيد أول المدة', 'الرصيد الافتتاحي', 'balance'] },
    { k: 'dr', l: 'مدين', syn: ['مدين', 'المدين', 'عليه', 'رصيد مدين', 'debit'] },
    { k: 'cr', l: 'دائن', syn: ['دائن', 'الدائن', 'له', 'رصيد دائن', 'credit'] },
    { k: 'kind', l: 'النوع (عميل/مورد)', syn: ['النوع', 'نوع الحساب', 'الصفة', 'type'] },
    { k: 'notes', l: 'ملاحظات', syn: ['ملاحظات', 'ملاحظة', 'notes'] },
  ];
  const OPEN_TAG = 'رصيد افتتاحي — ';
  function setOpening(a, kind, ob) {
    // يحذف الرصيد الافتتاحي القديم لهالحساب (إن وجد) ويكتب الجديد
    db.entries = db.entries.filter(e => !(e.openFor === a.id || (e.desc === OPEN_TAG + a.name && e.lines.length === 2 && e.lines.some(l => l.acc === a.id) && e.lines.some(l => l.acc === 'capital'))));
    ob = r2(ob); if (!ob) return;
    const dr = kind === 'c' ? ob > 0 : ob < 0, v = Math.abs(ob);
    db.entries.push({ id: uid(), no: nextNo('entry'), date: db.settings.startDate, desc: OPEN_TAG + a.name, openFor: a.id,
      lines: [{ acc: a.id, dr: dr ? v : 0, cr: dr ? 0 : v, note: '' }, { acc: 'capital', dr: dr ? 0 : v, cr: dr ? v : 0, note: '' }] });
  }
  function runParties(rows, hr, map, mode, opts) {
    const res = { c: 0, s: 0, upd: 0, skip: 0, bad: 0, bal: 0 };
    const has = k => map[k] !== undefined;
    const cell = (r, k) => (has(k) ? r[map[k]] : '');
    for (const r of rows.slice(hr + 1)) {
      const name = String(cell(r, 'name') ?? '').trim();
      if (!name || /^(المجموع|الإجمالي|اجمالي|المجموع الكلي)$/.test(name)) { res.bad++; continue; }
      let kind = opts.kind;
      const kt = N(cell(r, 'kind'));
      if (kt) kind = /مورد|supp/.test(kt) ? 's' : /عميل|زبون|cust/.test(kt) ? 'c' : kind;
      const parent = kind === 's' ? 'suppliers' : 'customers';
      const code = String(cell(r, 'code') ?? '').trim();
      const pool = kind === 's' ? suppliers() : customers();
      let ex = (code && pool.find(a => a.code === code)) || pool.find(a => N(a.name) === N(name));
      if (ex && mode === 'skip') { res.skip++; continue; }
      // الرصيد: إمّا عمود واحد، أو مدين − دائن
      let ob = null;
      if (has('dr') || has('cr')) {
        const net = toNum(cell(r, 'dr')) - toNum(cell(r, 'cr'));
        ob = kind === 'c' ? net : -net;
      } else if (has('bal') && String(cell(r, 'bal')).trim() !== '') ob = toNum(cell(r, 'bal'));
      if (ob !== null && opts.flip === '1') ob = -ob;
      const o = { name };
      ['phone', 'address', 'notes'].forEach(k => { if (has(k) && String(cell(r, k) ?? '').trim()) o[k] = String(cell(r, k)).trim(); });
      if (ex) { Object.assign(ex, o); res.upd++; }
      else {
        let c = code && !db.accounts.some(a => a.code === code) ? code : nextCode(acc(parent));
        ex = { id: uid(), code: c, type: acc(parent).type, parent, group: false, phone: '', address: '', notes: '', ...o };
        db.accounts.push(ex); res[kind]++;
      }
      if (ob !== null) { setOpening(ex, kind, ob); if (r2(ob)) res.bal++; }
    }
    return res;
  }
  function openParties(kind) {
    wizard({
      title: '📥 استيراد ' + (kind === 's' ? 'الموردين' : 'العملاء') + ' من Excel',
      intro: 'ملف Excel أو CSV فيه الأسماء، ومع كل اسم (اختياري) الهاتف والرصيد. الرصيد بينكتب كرصيد افتتاحي بتاريخ بداية الفترة.',
      fields: PFIELDS,
      tpl: { name: 'نموذج-استيراد-الحسابات.csv', rows: [['الرمز', 'الاسم', 'الهاتف', 'العنوان', 'الرصيد'], ['', 'أبو محمد الحلبي', '0991234567', 'دمشق', '150000'], ['', 'محل الأمانة', '0944111222', '', '-20000']] },
      extra: () => `<div class="grid2" style="margin-top:8px">
        <label class="fld"><span>الحسابات هي</span><select data-opt="kind"><option value="c" ${kind !== 's' ? 'selected' : ''}>عملاء (زبائن)</option><option value="s" ${kind === 's' ? 'selected' : ''}>موردين</option></select></label>
        <label class="fld"><span>معنى الرصيد الموجب (إذا عمود رصيد واحد)</span><select data-opt="flip">
          <option value="0">${kind === 's' ? 'موجب = إله علينا (دائن)' : 'موجب = عليه إلنا (مدين)'}</option>
          <option value="1">${kind === 's' ? 'موجب = عليه إلنا (مدين)' : 'موجب = إله علينا (دائن)'}</option></select></label></div>`,
      exec: (rows, hr, map, mode, opts) => {
        const r = runParties(rows, hr, map, mode, opts);
        toast(`تم استيراد ${r.c + r.s + r.upd} حساب`);
        return `عملاء جدد: <b>${r.c}</b> — موردين جدد: <b>${r.s}</b> — تحدّثوا: <b>${r.upd}</b>${r.skip ? ` — تُركوا: <b>${r.skip}</b>` : ''}<br>أرصدة افتتاحية انكتبت: <b>${r.bal}</b>${r.bad ? `<br><small class="muted">${r.bad} سطر بلا اسم أو سطر مجموع تجاهلناهن</small>` : ''}`;
      },
    });
  }
  const map0 = v => (v === undefined ? '' : String(v));
  return { open, openParties, guess, run, runParties, readFile };
})();
window.ItemImport = ItemImport;
