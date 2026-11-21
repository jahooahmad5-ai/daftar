/* أوامر صوتية: زر 🎤 بأعلى الشاشة
   أمثلة: «فاتورة مبيع لأم عطا» — «بسكوت خمسة آلاف اتنعش قطعة عدد أربعة» — «دفعة مليون ونص»
          «احفظ» — «كشف حساب أم عطا» — «رصيد أحمد» — «ابعت رصيد أحمد عالواتس» — «سند قبض من أحمد عشرة آلاف» */
'use strict';
const Voice = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const N = s => normAr(String(s || '')).replace(/[،,.!?؟]/g, ' ').replace(/\s+/g, ' ').trim();

  /* ---------- تحويل الأرقام المحكية لأرقام ---------- */
  const U = {
    'صفر': 0, 'واحد': 1, 'وحده': 1, 'وحد': 1, 'اثنين': 2, 'اتنين': 2, 'تنين': 2, 'ثنين': 2, 'اثنان': 2,
    'ثلاثه': 3, 'تلاته': 3, 'تلات': 3, 'ثلاث': 3, 'اربعه': 4, 'اربع': 4, 'خمسه': 5, 'خمس': 5, 'سته': 6, 'ست': 6,
    'سبعه': 7, 'سبع': 7, 'ثمانيه': 8, 'تمانيه': 8, 'تمان': 8, 'ثمان': 8, 'تمن': 8, 'تسعه': 9, 'تسع': 9, 'عشره': 10, 'عشر': 10,
    'احدعش': 11, 'احدعشر': 11, 'حدعش': 11, 'اتنعش': 12, 'اثنعش': 12, 'اثنعشر': 12, 'طنعش': 12, 'تلتعش': 13, 'ثلطعش': 13, 'تلطعش': 13,
    'اربعتعش': 14, 'اربعطعش': 14, 'خمستعش': 15, 'خمسطعش': 15, 'ستعش': 16, 'سطعش': 16, 'سبعتعش': 17, 'سبعطعش': 17,
    'تمنتعش': 18, 'تمنطعش': 18, 'تسعتعش': 19, 'تسعطعش': 19,
    'عشرين': 20, 'ثلاثين': 30, 'تلاتين': 30, 'اربعين': 40, 'خمسين': 50, 'ستين': 60, 'سبعين': 70, 'ثمانين': 80, 'تمانين': 80, 'تسعين': 90,
    'ميه': 100, 'مية': 100, 'مائه': 100, 'مئه': 100, 'ميتين': 200, 'مئتين': 200, 'ميتان': 200, 'تلتميه': 300, 'ثلاثميه': 300, 'ثلثميه': 300,
    'ربعميه': 400, 'اربعميه': 400, 'خمسميه': 500, 'ستميه': 600, 'سبعميه': 700, 'تمنميه': 800, 'ثمانميه': 800, 'تسعميه': 900,
  };
  const SCALE = { 'الف': 1e3, 'الاف': 1e3, 'ألف': 1e3, 'آلاف': 1e3, 'الفين': 2e3, 'مليون': 1e6, 'ملايين': 1e6, 'مليونين': 2e6 };
  const HALF = ['نص', 'نصف'];
  function spokenNums(text) {
    const out = []; let run = null;
    const flush = () => { if (run) { out.push(String(run.total + run.cur)); run = null; } };
    for (let tok of N(text).split(' ')) {
      let w = tok, lead = '';
      const isNum = x => U[x] !== undefined || SCALE[x] !== undefined || /^\d+(\.\d+)?$/.test(x) || (run && HALF.includes(x));
      if (!isNum(w) && w.length > 1 && w[0] === 'و' && isNum(w.slice(1))) { lead = 'و'; w = w.slice(1); }
      if (!isNum(w) && w.startsWith('ال') && isNum(w.slice(2))) w = w.slice(2);       // «الالف» «الخمسة»
      if (!isNum(w) && w.startsWith('بال') && isNum(w.slice(3))) w = w.slice(3);      // «بالالف»
      if (!isNum(w)) { flush(); out.push(tok); continue; }
      // رقم جديد إذا ما في «و» قبله وما هو ألف/مليون (مثلاً «خمسة آلاف اتنعش» = 5000 و 12)
      if (run && !lead && SCALE[w] === undefined && !(HALF.includes(w))) flush();
      if (!run) { if (lead) out.push('و'); run = { total: 0, cur: 0, last: 1 }; }
      if (/^\d/.test(w)) run.cur += +w;
      else if (U[w] !== undefined) run.cur += U[w];
      else if (SCALE[w] !== undefined) {
        const sc = SCALE[w];
        if (w === 'الفين' || w === 'مليونين') { run.total += run.cur + sc; run.cur = 0; run.last = sc / 2; }
        else { run.total += (run.cur || 1) * sc; run.cur = 0; run.last = sc; }
      } else if (HALF.includes(w)) { run.total += run.last >= 1000 ? run.last / 2 : 0.5; run.cur = 0; }
    }
    flush();
    return out.filter(x => x !== '').join(' ').replace(/(\d+)\s*(?:قطعه|قطع|حبه|ق)(?=\s|$)/g, '$1ق');
  }

  /* ---------- مطابقة اسم حساب ---------- */
  function findParty(name, pool) {
    const n = N(name).replace(/^(ل|لل|الى|ل)\s*/, '').replace(/^ل(?=[^ا])/, '');
    if (!n) return null;
    pool = pool || [...customers(), ...suppliers()];
    const al = pool.find(a => (a.aliases || []).some(x => N(x) === n));
    if (al) return al;
    let best = null, bs = 0;
    for (const a of pool) {
      const an = N(a.name);
      let s = an === n ? 100 : an.includes(n) ? 50 : n.includes(an) ? 40 : 0;
      if (!s) { const ws = n.split(' '), aw = an.split(' '); s = ws.filter(w => aw.some(x => x === w || x.startsWith(w) || w.startsWith(x))).length * 10 - (aw.length - ws.length); }
      if (s > bs) { bs = s; best = a; }
    }
    return bs >= 9 ? best : null;
  }
  const after = (t, re) => { const m = t.match(re); return m ? t.slice(m.index + m[0].length).trim() : null; };
  const firstNum = t => { const m = t.match(/\d+(\.\d+)?/); return m ? +m[0] : 0; };

  /* ---------- تنفيذ الأمر ---------- */
  let pending = null;   // أمر ينفذ بعد فتح صفحة الفاتورة
  function exec(raw) {
    const t = spokenNums(raw), n = N(t);
    const onInv = /^#\/invoice\//.test(location.hash) && window.InvHook;

    // تنقّل
    const NAV = [[/^(الرئيسيه|الصفحه الرئيسيه|الشاشه الرئيسيه)$/, '#/'], [/^(المواد|المستودع|البضاعه)$/, '#/items'], [/^(العملاء|الزبائن|الزباين)$/, '#/parties?t=c'],
      [/^(الموردين|الموردون)$/, '#/parties?t=s'], [/^(التقارير)$/, '#/reports'], [/^(الفواتير)$/, '#/invoices'], [/^(السندات)$/, '#/vouchers'], [/^(الاعدادات)$/, '#/settings'], [/^(المجموعات)$/, '#/groups']];
    for (const [re, h] of NAV) if (re.test(n)) return go(h), say('فتحت ' + raw);

    // فاتورة جديدة
    let m = n.match(/^(?:فاتوره|فتوره)\s*(مبيع|بيع|شراء|شرا|مشتريات|مرتجع مبيع|مرتجع شراء)?\s*(?:جديده)?\s*(.*)$/);
    if (m) {
      const type = /شرا|مشتريات/.test(m[1] || '') ? (/مرتجع/.test(m[1]) ? 'purchaseReturn' : 'purchase') : (/مرتجع/.test(m[1] || '') ? 'saleReturn' : 'sale');
      const rest = (m[2] || '').replace(/^(ل|لل|الى|باسم|الزبون|العميل|المورد)\s*/, '');
      pending = rest ? { party: rest } : null;
      go('#/invoice/new?type=' + type);
      return say(INV_TYPES[type] + ' جديدة' + (rest ? ' — ' + rest : ''));
    }
    // سند قبض / دفع
    m = n.match(/^(?:سند\s*)?(قبض|دفع)\s*(?:من|ل|الى|لل)?\s*(.*)$/);
    if (m && !(onInv && m[1] === 'دفع' && !/^سند/.test(n))) {
      const type = m[1] === 'قبض' ? 'receipt' : 'payment';
      const amt = firstNum(m[2]), name = m[2].replace(/\d+(\.\d+)?/g, ' ').replace(/(مبلغ|ليره|ليرات|بالقديم|قديم|جديد)/g, ' ');
      const a = findParty(name);
      go('#/vouchers?new=' + type + (a ? '&acc=' + a.id : ''));
      if (amt) setTimeout(() => { const i = $('#dlg [name=amount]'); if (i) { i.value = /قديم/.test(n) ? amt / oldF() : amt; i.dispatchEvent(new Event('input', { bubbles: true })); } }, 350);
      return say(`سند ${m[1]}${a ? ' — ' + a.name : ''}${amt ? ' — ' + fmt(amt) : ''}`);
    }
    // كشف حساب
    let name = after(n, /^(?:كشف\s*حساب|كشف)\s*/);
    if (name !== null) { const a = findParty(name); const f = a => { go('#/report/statement?acc=' + a.id); say('كشف حساب ' + a.name); }; return a ? f(a) : askParty(name, f); }
    // إرسال رصيد واتساب
    name = after(n, /^(?:ابعت|ابعث|ارسل|بعت)\s*(?:ل)?\s*(?:رصيد|حساب)\s*/);
    if (name !== null) { name = name.replace(/(ع|على|عال|عل)\s*(ال)?واتس.*$/, '').replace(/واتس.*$/, ''); const a = findParty(name); const f = a => { waSend(a, waBalanceText(a)); say('رصيد ' + a.name + ' على واتساب'); }; return a ? f(a) : askParty(name, f); }
    // رصيد
    name = after(n, /^(?:رصيد|قديش\s*(?:عليه|عليها|له|لها)|قديش\s*رصيد|حساب)\s*/);
    if (name !== null && name) { const a = findParty(name); return a ? showBal(a) : askParty(name, showBal); }

    // أوامر داخل الفاتورة
    if (onInv) {
      if (/^(احفظ|حفظ|خلص|سجل|احفظها)/.test(n)) { InvHook.save(); return; }
      if (/^(امسح|احذف|شيل)\s*(اخر|آخر)/.test(n)) { InvHook.undo(); return say('شلت آخر مادة'); }
      if (/^(دفعه|دفعة|دفع|واصل|مقبوض)/.test(n)) { const v = /\d/.test(raw) && /مليون|الف|ألف/.test(raw) ? OrderPaste.parseMoney(raw) : (firstNum(t) || OrderPaste.parseMoney(raw)); const old = oldOn() && (v >= 100000 || /قديم/.test(n)); const base = old ? v / oldF() : v; InvHook.setPay(r2(base)); return say(`دفعة ${fmt(base)}${old ? ` (بالقديم ${fmt(v)})` : ''}`); }
      name = after(n, /^(?:الزبون|العميل|الزبونه|المورد|لل|ل)\s+/);
      if (name) { const a = findParty(name); const f = a => { InvHook.setParty(a.id); say('الزبون: ' + a.name); }; return a ? f(a) : askParty(name, f); }
      return InvHook.addSpoken(t, raw);
    }
    // أي شي تاني: إذا شكله مادة بنفتح فاتورة مبيع ومنضيفه
    const pl = OrderPaste.parseLine(t);
    if (pl && pl.kind === 'item') { pending = { line: t, raw }; go('#/invoice/new?type=sale'); return; }
    const a = findParty(n);
    if (a) { showBal(a); return; }
    say('ما فهمت: «' + raw + '»', 1);
  }

  /* ---------- لما ما يعرف الاسم: بيسألك شو هو وبيحفظه ---------- */
  function pick(title, list, label, sub) {
    return new Promise(done => {
      let chosen = null;
      modal(title, `<input class="search" id="pkQ" placeholder="🔎 دوّر…" style="width:100%;margin-bottom:8px">
        <div id="pkL" class="pk-list"></div>
        <p class="muted" style="font-size:13px;margin:8px 0 0">${sub || 'اختار الصح، والبرنامج بيحفظ هالتسمية للمرة الجاية.'}</p>`);
      const d = $('#dlg'), L = $('#pkL', d), Q = $('#pkQ', d);
      const draw = () => {
        const q = N(Q.value);
        const rows = list.filter(x => !q || N(label(x)).includes(q)).slice(0, 60);
        L.innerHTML = rows.map(x => `<button type="button" class="pk-row" data-id="${x.id}">${esc(label(x))}</button>`).join('') || '<p class="muted">ما في نتائج</p>';
      };
      L.onclick = e => { const b = e.target.closest('[data-id]'); if (!b) return; chosen = list.find(x => x.id === b.dataset.id); d.close(); };
      Q.oninput = draw; draw();
      d.addEventListener('close', () => done(chosen), { once: true });
    });
  }
  async function askItem(line, raw) {
    const items = [...db.items].sort(byCode);
    const it = await pick(`❓ شو يعني «${raw}»؟`, items, i => i.code + ' - ' + i.name);
    if (!it) return null;
    OrderPaste.learn(line, it.id); save();
    toast(`👍 حفظت: «${line.text}» = ${it.name}`);
    return it;
  }
  async function askParty(name, then) {
    const pool = [...customers(), ...suppliers()];
    const a = await pick(`❓ مين «${name}»؟`, pool, x => x.name);
    if (!a) return;
    a.aliases = [...new Set([...(a.aliases || []), name.trim()])]; save();
    toast(`👍 حفظت: «${name}» = ${a.name}`);
    then(a);
  }

  function showBal(a) {
    const b = partyBal(a);
    modal('💰 رصيد ' + a.name, `<p style="font-size:18px;white-space:pre-line">${esc(balWords(a, b).replace(/\*/g, ''))}</p>`,
      { extra: `<button type="button" class="btn wa" id="vWa">واتساب</button><a class="btn" href="#/report/statement?acc=${a.id}" id="vSt">كشف حساب</a>` });
    $('#vWa').onclick = () => waSend(a, waBalanceText(a));
    $('#vSt').onclick = () => $('#dlg').close();
  }
  function say(msg, bad) { toast((bad ? '' : '🎤 ') + msg, bad); }

  // يُستدعى من شاشة الفاتورة بعد ما تنرسم
  function invReady() {
    if (!pending) return;
    const p = pending; pending = null;
    setTimeout(() => {
      if (p.party) { const a = findParty(p.party); if (a) InvHook.setParty(a.id); else askParty(p.party, a => InvHook.setParty(a.id)); }
      if (p.line) InvHook.addSpoken(p.line, p.raw);
    }, 50);
  }

  /* ---------- الاستماع ---------- */
  let rec = null;
  function listen() {
    if (!SR) return toast('المتصفح ما بيدعم الأوامر الصوتية. استعمل Chrome.', 1);
    if (rec) { rec.stop(); return; }
    const ov = document.createElement('div'); ov.className = 'v-ov';
    ov.innerHTML = '<div class="v-box"><div class="v-mic">🎤</div><div class="v-txt">احكي هلق…</div><small>مثلاً: «فاتورة مبيع لأم عطا» — «بسكوت خمسة آلاف اتنعش قطعة عدد أربعة» — «احفظ»</small></div>';
    document.body.appendChild(ov);
    rec = new SR(); rec.lang = 'ar-SY'; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
    let final = '';
    rec.onresult = e => { let s = ''; for (const r of e.results) { s += r[0].transcript; if (r.isFinal) final = s; } $('.v-txt', ov).textContent = s; };
    rec.onerror = e => { toast(e.error === 'not-allowed' ? 'اسمح للمتصفح يستعمل المايك' : e.error === 'network' ? 'التعرف على الصوت بدو إنترنت (جرّب مع VPN)' : e.error === 'no-speech' ? 'ما سمعت شي' : 'تعذّر التعرف على الصوت', 1); };
    rec.onend = () => { ov.remove(); rec = null; if (final.trim()) { try { exec(final.trim()); } catch (err) { console.error(err); toast('صار خطأ بتنفيذ الأمر', 1); } } };
    ov.onclick = () => rec && rec.stop();
    rec.start();
  }
  return { listen, exec, spokenNums, findParty, invReady, askItem, supported: !!SR };
})();
window.Voice = Voice;
