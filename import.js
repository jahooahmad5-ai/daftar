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

  function guess(rows) {
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

  function template() {
    const h = ['رمز المادة', 'اسم المادة', 'الباركود', 'الوحدة', 'المجموعة', 'المجموعة الفرعية', 'سعر الشراء', 'سعر المبيع', 'سعر المستهلك', 'الكمية'];
    const ex = ['001', 'شامبو ديلوكس 400 مل', '6281000000017', 'قطعة', 'ديلوكس', 'شامبو', '20', '25', '30', '48'];
    const csv = '﻿' + [h, ex].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const u = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = u; a.download = 'نموذج-استيراد-المواد.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(u), 3000);
  }

  function open() {
    modal('📥 استيراد المواد من Excel', `
      <p class="muted" style="margin-top:0">اختار ملف Excel (‎.xlsx / .xls) أو CSV فيه المواد. لازم يكون فيه عمود لاسم المادة على الأقل، والباقي اختياري.</p>
      <div class="acts" style="margin-bottom:10px">
        <label class="btn pri">📂 اختيار ملف<input type="file" id="impF" accept=".xlsx,.xls,.csv,.ods,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" hidden></label>
        <button type="button" class="btn" id="impT">⬇️ نموذج جاهز</button>
      </div>
      <div id="impBody"></div>`);
    const d = $('#dlg'), body = $('#impBody', d);
    $('#impT', d).onclick = template;
    $('#impF', d).onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      body.innerHTML = '<p class="muted">عم يقرأ الملف…</p>';
      let rows;
      try { rows = await readFile(f); } catch (err) { body.innerHTML = `<p class="bad">❌ ${esc(err.message || 'الملف غير صالح')}</p>`; return; }
      if (!rows.length) { body.innerHTML = '<p class="bad">الملف فاضي</p>'; return; }
      const g = guess(rows);
      const hr = g.hr;
      const hdr = hr >= 0 ? rows[hr] : rows[0].map((_, j) => 'عمود ' + (j + 1));
      const colOpts = [['', '— لا يوجد —'], ...hdr.map((c, j) => [String(j), `${String(c || 'عمود ' + (j + 1))}`])];
      const sample = rows.slice(hr + 1, hr + 4);
      body.innerHTML = `
        <p><b>${esc(f.name)}</b> — ${rows.length - hr - 1} سطر</p>
        <p class="muted" style="font-size:13px">تأكد إن كل خانة مربوطة بالعمود الصح من ملفك:</p>
        <div class="grid2">${FIELDS.map(fl => `<label class="fld"><span>${fl.l}${fl.req ? ' *' : ''}</span><select data-map="${fl.k}">${optsHtml(colOpts, map0(g.map[fl.k]))}</select></label>`).join('')}</div>
        <label class="fld" style="margin-top:8px"><span>إذا المادة موجودة من قبل (نفس الرمز أو الباركود أو الاسم)</span>
          <select id="impMode"><option value="update">حدّث بياناتها (الأسعار، المجموعة…)</option><option value="skip">اتركها متل ما هي</option></select></label>
        <div class="tbl" style="margin-top:10px">${table(hdr.map(c => esc(String(c))), sample.map(r => `<tr>${hdr.map((_, j) => `<td>${esc(String(r[j] ?? ''))}</td>`).join('')}</tr>`).join(''))}</div>
        <div class="acts" style="margin-top:12px"><button type="button" class="btn pri" id="impGo">✅ استيراد</button></div>`;
      $('#impGo', d).onclick = () => {
        const map = {}; $$('[data-map]', body).forEach(s => { if (s.value !== '') map[s.dataset.map] = +s.value; });
        if (map.name === undefined) return toast('لازم تختار عمود اسم المادة', 1);
        const r = run(rows, hr, map, $('#impMode', body).value);
        save();
        body.innerHTML = `<div class="card" style="background:var(--green-soft)"><b>✅ خلص الاستيراد</b><br>
          مواد جديدة: <b>${r.add}</b> — تحدّثت: <b>${r.upd}</b>${r.skip ? ` — تُركت: <b>${r.skip}</b>` : ''}${r.groups ? ` — مجموعات جديدة: <b>${r.groups}</b>` : ''}${r.bad ? `<br><small class="muted">${r.bad} سطر بلا اسم تجاهلناهن</small>` : ''}</div>`;
        toast(`تم استيراد ${r.add + r.upd} مادة`);
        route();
      };
    };
  }
  const map0 = v => (v === undefined ? '' : String(v));
  return { open, guess, run, readFile };
})();
window.ItemImport = ItemImport;
