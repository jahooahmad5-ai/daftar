/* لصق طلبية مكتوبة (من واتساب مثلاً) وتحويلها لأسطر فاتورة
   مثال سطر: «بسكوت5000. 12ق عدد4» ← المادة «بسكوت 5000» تعبئة 12 والكمية 4
   سطر «دفعة ...» ← مبلغ مقبوض، وأول سطر بلا أرقام ← اسم الزبون */
'use strict';
const OrderPaste = (() => {
  const dig = s => String(s || '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  // يفصل الحروف عن الأرقام ويرجّع كلمات وأرقام
  const toks = s => {
    s = normAr(dig(s)).replace(/(\d)[.,،](?!\d)/g, '$1 ').replace(/([^\d\s.])(\d)/g, '$1 $2').replace(/(\d)([^\d\s.,])/g, '$1 $2');
    const words = [], nums = [];
    s.split(/[\s\-_/()،,:+*×x]+/).filter(Boolean).forEach(t => { if (/^\d+(\.\d+)?$/.test(t)) nums.push(+t); else if (t.length > 0) words.push(t.replace(/^ال(?=..)/, '')); });
    return { words, nums };
  };

  function parseLine(raw) {
    let s = dig(raw).trim();
    if (!s) return null;
    if (/^(دفع[هة]|دفعه|واصل|مقبوض|نقدا|نقدي)/.test(normAr(s))) return { kind: 'pay', raw, amount: parseMoney(s) };
    // التعبئة: 12ق / 24 ق
    let pack = null;
    s = s.replace(/(\d+)\s*ق(?=\s|عدد|\d|$)/g, (m, n) => { pack = +n; return ' '; });
    // الكمية: عدد8 / ص2 / رقم بالآخر
    let qty = null;
    s = s.replace(/عدد\s*(\d+(?:\.\d+)?)/g, (m, n) => { qty = +n; return ' '; });
    if (qty === null) s = s.replace(/(?:^|\s)(?:ص|صندوق|كرتون[هة]?|كرت)\s*(\d+)\s*$/, (m, n) => { qty = +n; return ' '; });
    if (qty === null && pack !== null) s = s.replace(/\s(\d{1,3})\s*$/, (m, n) => { qty = +n; return ' '; });
    const t = toks(s);
    if (qty === null && !t.nums.length && pack === null) return { kind: 'name', raw, text: s.trim() };
    return { kind: 'item', raw, qty: qty ?? 1, pack, t, text: s.trim() };
  }

  function parseMoney(s) {
    s = normAr(dig(s));
    const m = s.match(/\d+(\.\d+)?/), n = m ? +m[0] : 0;
    const mil = /مليون|ملايين/.test(s), half = /ونص|ونصف/.test(s), thou = /الف|الاف/.test(s);
    if (mil) {
      if (!n) return half ? 1500000 : 1000000;
      if (n >= 1000) return n * 1000;          // «1500 مليون ونص» = 1500 ألف
      return n * 1000000 + (half ? 500000 : 0);
    }
    if (thou) return (n || 1) * 1000 + (half ? 500 : 0);
    return n;
  }

  // تقييم مدى تطابق سطر مع مادة
  const itemToks = new Map();
  function score(line, it) {
    let T = itemToks.get(it.id);
    if (!T) { T = toks(it.name + ' ' + (it.unit || '')); itemToks.set(it.id, T); }
    let sc = 0;
    const lineNums = [...line.t.nums]; if (line.pack) lineNums.push(line.pack);
    for (const n of line.t.nums) sc += T.nums.includes(n) ? 4 : -5;
    if (line.pack) sc += T.nums.includes(line.pack) ? 3 : -1;
    for (const n of T.nums) if (!lineNums.includes(n)) sc -= 2;
    for (const w of line.t.words) {
      if (T.words.some(x => x === w)) sc += 3;
      else if (T.words.some(x => x.startsWith(w) || w.startsWith(x))) sc += 2;
      else if (T.words.some(x => x.includes(w) || w.includes(x))) sc += 1;
      else sc -= 1;
    }
    return sc;
  }
  function best(line, items) {
    let top = null, s1 = -1e9, s2 = -1e9;
    for (const it of items) { const s = score(line, it); if (s > s1) { s2 = s1; s1 = s; top = it; } else if (s > s2) s2 = s; }
    return s1 > 0 ? { it: top, sure: s1 - s2 >= 2 } : { it: null, sure: false };
  }

  function open({ sideSale, onDone }) {
    modal('📋 لصق طلبية', `
      <p class="muted" style="margin-top:0">الصق نص الطلبية متل ما هو (من واتساب مثلاً). أول سطر اسم ${sideSale ? 'الزبون' : 'المورد'}، وكل سطر مادة مع «عدد…»، وسطر «دفعة…» للمبلغ المدفوع.</p>
      <textarea id="opTxt" rows="8" style="width:100%;font:inherit" placeholder="ام عطا&#10;بسكوت5000. 12ق عدد4&#10;كرتون 5000 12ق عدد8&#10;دفعة 1500 مليون ونص"></textarea>
      <div class="acts" style="margin-top:8px"><button type="button" class="btn pri" id="opGo">🔎 قراءة الطلبية</button></div>
      <div id="opRes"></div>`);
    const d = $('#dlg'), res = $('#opRes', d);
    $('#opTxt', d).focus();
    $('#opGo', d).onclick = () => {
      itemToks.clear();
      const items = [...db.items].sort(byCode);
      const parties = sideSale ? customers() : suppliers();
      const parsed = $('#opTxt', d).value.split(/\r?\n/).map(parseLine).filter(Boolean);
      const nameLine = parsed.find(p => p.kind === 'name');
      const pays = parsed.filter(p => p.kind === 'pay');
      const lines = parsed.filter(p => p.kind === 'item').map(p => ({ ...p, m: best(p, items) }));
      let party = null;
      if (nameLine) { const n = normAr(nameLine.text); party = parties.find(a => normAr(a.name) === n) || parties.find(a => normAr(a.name).includes(n) || n.includes(normAr(a.name))); }
      const payAmt = pays.reduce((s, p) => s + p.amount, 0);
      const itemOpts = [['', '— اختر مادة / تجاهل —'], ...items.map(i => [i.id, i.code + ' - ' + i.name])];
      const pOpts = [['', '— بدون —'], ...(nameLine && !party ? [['__new', `➕ ${sideSale ? 'زبون' : 'مورد'} جديد: ${nameLine.text}`]] : []), ...parties.map(a => [a.id, a.name])];
      const found = lines.filter(l => l.m.it).length;
      res.innerHTML = `
        <label class="fld" style="margin-top:10px"><span>${sideSale ? 'الزبون' : 'المورد'}${nameLine ? ` (مكتوب: «${esc(nameLine.text)}»)` : ''}</span>
          <select id="opParty">${optsHtml(pOpts, party ? party.id : (nameLine ? '__new' : ''))}</select></label>
        <p style="margin:10px 0 4px"><b>المواد:</b> لقيت ${found} من ${lines.length}. ${found < lines.length ? '<span class="bad">الأسطر الحمرا اختار مادتها بإيدك.</span>' : ''} ${lines.some(l => l.m.it && !l.m.sure) ? '<span class="muted">الأسطر الصفرا تأكد منها.</span>' : ''}</p>
        <div class="op-list">${lines.map((l, i) => `
          <div class="op-row ${!l.m.it ? 'bad-row' : !l.m.sure ? 'warn-row' : ''}">
            <div class="op-raw">${esc(l.raw)}</div>
            <div class="op-ctl"><select data-op="${i}">${optsHtml(itemOpts, l.m.it ? l.m.it.id : '')}</select>
            <input type="number" step="any" inputmode="decimal" data-oq="${i}" value="${l.qty}" title="الكمية"></div>
          </div>`).join('')}</div>
        ${pays.length ? `<div class="card" style="margin-top:10px;padding:10px">
          <b>💵 دفعة:</b> ${pays.map(p => esc(p.raw)).join('، ')}
          <div class="grid2" style="margin-top:6px">
            <label class="fld"><span>المبلغ مثل ما انكتب</span><input type="number" step="any" id="opPay" value="${payAmt}"></label>
            <label class="fld"><span>بأي عملة</span><select id="opPayCur">
              <option value="old" ${oldOn() && payAmt >= 100000 ? 'selected' : ''}>ليرة قديمة (÷${oldF()})</option>
              <option value="new" ${!(oldOn() && payAmt >= 100000) ? 'selected' : ''}>ليرة جديدة</option></select></label>
          </div><div class="muted" id="opPayEq"></div></div>` : ''}
        <div class="acts" style="margin-top:12px"><button type="button" class="btn pri" id="opOk">✅ أضف للفاتورة</button></div>`;
      const payEq = () => { const e = $('#opPayEq', res); if (!e) return; const a = num($('#opPay', res).value), b = $('#opPayCur', res).value === 'old' ? a / oldF() : a; e.textContent = `بينكتب سند ${sideSale ? 'قبض' : 'دفع'} بقيمة ${fmt(b)} ${cur()}${oldOn() ? ` (بالقديم ${oldAmt(b)})` : ''} لما تحفظ الفاتورة.`; };
      if (pays.length) { $('#opPay', res).oninput = payEq; $('#opPayCur', res).onchange = payEq; payEq(); }
      $$('[data-op]', res).forEach(s => (s.onchange = () => { const row = s.closest('.op-row'); row.classList.remove('warn-row'); row.classList.toggle('bad-row', !s.value); }));
      $('#opOk', res).onclick = () => {
        let pid = $('#opParty', res).value;
        if (pid === '__new') {
          const parent = sideSale ? 'customers' : 'suppliers';
          const a = { id: uid(), code: nextCode(acc(parent)), name: nameLine.text, type: acc(parent).type, parent, group: false, phone: '', address: '', notes: '' };
          db.accounts.push(a); save(); pid = a.id;
        }
        const out = [];
        lines.forEach((l, i) => { const id = $(`[data-op="${i}"]`, res).value, q = num($(`[data-oq="${i}"]`, res).value); if (id && q > 0) out.push({ item: id, qty: q }); });
        let pay = 0;
        if (pays.length) { const a = num($('#opPay', res).value); pay = r2($('#opPayCur', res).value === 'old' ? a / oldF() : a); }
        $('#dlg').close();
        onDone({ party: pid, lines: out, pay, skipped: lines.length - out.length });
      };
    };
  }
  return { open, parseLine, parseMoney, best };
})();
window.OrderPaste = OrderPaste;
