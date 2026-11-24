'use strict';
/* =====================================================================
   المزامنة السحابية (Supabase) — بدون مكتبات خارجية
   - التطبيق يبقى يعمل بدون إنترنت، وكل تغيير يُحفظ محلياً أولاً
   - عند توفر الإنترنت: تُرفع التغييرات وتُنزّل تغييرات الأجهزة الأخرى
   ===================================================================== */
const Cloud = (() => {
  const SKEY = 'daftar-cloud-v1';
  const DBKEY = 'daftar-db-v1';
  const KINDS = ['accounts', 'items', 'groups', 'invoices', 'vouchers', 'entries'];
  let st = (() => { try { return JSON.parse(localStorage.getItem(SKEY)) || {}; } catch (e) { return {}; } })();
  st.dirty = st.dirty || {};
  let snap = null, busy = false, lastErr = '', debounce = null;

  const saveSt = () => { try { localStorage.setItem(SKEY, JSON.stringify(st)); } catch (e) { /* */ } };
  const cfg = () => { const c = window.DAFTAR_CLOUD || {}; return { url: (st.url || c.url || '').trim().replace(/\/+$/, ''), key: (st.key || c.key || '').trim() }; };
  const configured = () => !!(cfg().url && cfg().key);
  const linked = () => configured() && !!st.session && !!st.company;
  const pending = () => Object.keys(st.dirty).length;

  /* ---------- تتبّع التغييرات ---------- */
  function recs() {
    const m = {};
    for (const k of KINDS) for (const r of db[k]) m[k + '/' + r.id] = JSON.stringify(r);
    m['settings/main'] = JSON.stringify(db.settings);
    m['seq/main'] = JSON.stringify(db.seq);
    return m;
  }
  function track() {
    if (window.__tabInactive) return;
    const now = recs();
    // منسجّل التغييرات حتى لو انتهى تسجيل الدخول (الشركة لسا مربوطة) — هيك بترتفع أول ما ترجع تسجّل دخول
    if (snap && configured() && st.company) {
      for (const k in now) if (now[k] !== snap[k]) st.dirty[k] = 1;
      for (const k in snap) if (!(k in now)) st.dirty[k] = 1;
      saveSt(); if (linked()) schedule(1500);
    }
    snap = now; pill();
  }
  function markAllDirty() { st.dirty = {}; Object.keys(recs()).forEach(k => (st.dirty[k] = 1)); saveSt(); }

  /* ---------- الاتصال بـ Supabase ---------- */
  async function http(path, opt = {}, auth = true) {
    const { url, key } = cfg();
    if (auth) await ensureToken();
    const h = { apikey: key, 'Content-Type': 'application/json', ...(opt.headers || {}) };
    if (auth) h.Authorization = 'Bearer ' + st.session.access_token;
    let r;
    try { r = await fetch(url + path, { ...opt, headers: h }); }
    catch (e) { throw new Error('تعذّر الاتصال بالسيرفر (تحقق من الإنترنت أو رابط المشروع)'); }
    const txt = await r.text(); let j = null;
    try { j = txt ? JSON.parse(txt) : null; } catch (e) { /* */ }
    if (!r.ok) {
      const msg = (j && (j.msg || j.message || j.error_description || j.error)) || ('HTTP ' + r.status);
      const e = new Error(translate(msg)); e.status = r.status; throw e;
    }
    return j;
  }
  function translate(m) {
    const t = String(m);
    if (/Invalid login credentials/i.test(t)) return 'الإيميل أو كلمة السر غير صحيحة';
    if (/Email not confirmed/i.test(t)) return 'لم يتم تأكيد الإيميل بعد — افتح رسالة التأكيد في بريدك';
    if (/already registered/i.test(t)) return 'هذا الإيميل مسجّل مسبقاً — استخدم «دخول»';
    if (/Password should be/i.test(t)) return 'كلمة السر قصيرة (6 أحرف على الأقل)';
    if (/Invalid API key|No API key/i.test(t)) return 'مفتاح الربط غير صحيح';
    if (/relation .* does not exist|Could not find the table/i.test(t)) return 'جداول قاعدة البيانات غير موجودة — شغّل ملف supabase.sql أولاً';
    return t;
  }
  function setSession(j) {
    st.session = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, email: j.user?.email, uid: j.user?.id };
    saveSt();
  }
  async function ensureToken() {
    if (!st.session) throw new Error('يجب تسجيل الدخول');
    if (Date.now() < st.session.expires_at - 60000) return;
    const { url, key } = cfg();
    const r = await fetch(url + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: st.session.refresh_token }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 400 || r.status === 401) { st.session = null; saveSt(); }
      throw new Error('انتهت الجلسة، سجّل الدخول من جديد');
    }
    setSession(j);
  }

  /* ---------- رفع وتنزيل ---------- */
  async function push() {
    // موبايل المندوب (وضع البيّاع) بيرفع فواتيره وسنداتها بس — ما بيلمس المواد ولا الحسابات ولا الإعدادات
    // (هيك ما بيرجّع سعر قديم فوق تعديلات المدير)
    if (typeof isSeller === 'function' && isSeller()) {
      let dropped = false;
      for (const k of Object.keys(st.dirty)) if (!/^(invoices|vouchers|seq)\//.test(k)) { delete st.dirty[k]; dropped = true; }
      // تنزيل كامل من جديد (مرة وحدة، أو إذا انشالت تعديلات محلية): هيك بياخد أسعار المدير يلي كانت متجاهلة
      if (dropped || !st.fullPull1) { st.lastPull = null; st.fullPull1 = 1; saveSt(); }
    }
    const keys = Object.keys(st.dirty); if (!keys.length) return;
    const cur = recs(), sent = {};
    const rows = keys.map(k => {
      const i = k.indexOf('/'), kind = k.slice(0, i), id = k.slice(i + 1);
      sent[k] = cur[k];
      return { company_id: st.company, kind, id, data: cur[k] ? JSON.parse(cur[k]) : null, deleted: !cur[k] };
    });
    const up = list => http('/rest/v1/records?on_conflict=company_id,kind,id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(list) });
    const denied = e => e && (e.status === 403 || e.status === 401 && /row-level|policy/i.test(e.message) || /row-level security|violates/i.test(e.message));
    for (let i = 0; i < rows.length; i += 400) {
      const part = rows.slice(i, i + 400);
      try { await up(part); }
      catch (e) {
        if (!denied(e)) throw e;
        // السيرفر رفض شي (مثلاً المندوب عم يعدّل فاتورة عدّلها المدير): منرفع وحدة وحدة، والمرفوض منرجّعه من السحابة
        let bad = 0;
        for (const r of part) {
          try { await up([r]); }
          catch (e2) { if (!denied(e2)) throw e2; bad++; delete st.dirty[r.kind + '/' + r.id]; sent[r.kind + '/' + r.id] = undefined; }
        }
        if (bad) { st.lastPull = null; saveSt(); toast(`⚠️ ${bad} تعديل ما انقبل بالسحابة (مسموح بس للمدير) — رجّعنا النسخة الأصلية`, 1); }
      }
    }
    const now = recs();
    keys.forEach(k => { if (now[k] === sent[k]) delete st.dirty[k]; });
    saveSt();
  }
  // مقارنة بغض النظر عن ترتيب المفاتيح (السيرفر بيرجّع المفاتيح بترتيب تاني)
  const canon = v => Array.isArray(v) ? '[' + v.map(canon).join(',') + ']'
    : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
    : JSON.stringify(v ?? null);
  const same = (a, b) => canon(a) === canon(b);
  /* ---------- تنظيف يلي جاي من السحابة ----------
     الفواتير والسندات والترقيم ممكن يكتبهن موبايل المندوب، فما منثق فيهن: منتأكد من شكل كل خانة
     (رقم = رقم، تاريخ = تاريخ، نوع من الأنواع المعروفة…) وأي شي غريب منرفضه — هيك ما بيوصل كود مخبّى لشاشة المدير */
  const RX_ID = /^[A-Za-z0-9_-]{1,80}$/, RX_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const nOr = (v, d = 0) => { const x = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN; return Number.isFinite(x) ? x : d; };
  const idOr = v => (v == null || v === '' ? '' : typeof v === 'string' && RX_ID.test(v) ? v : null);
  const txt = (v, max = 300) => (v == null ? '' : String(v).replace(/[\u0000-\u001f<>]/g, ' ').slice(0, max));
  function cleanDoc(kind, d, rid) {
    if (!d || typeof d !== 'object' || Array.isArray(d) || d.id !== rid || !RX_ID.test(String(d.id))) return null;
    if (!RX_DATE.test(String(d.date || '')) || !['base', 'fx', undefined, ''].includes(d.cur)) return null;
    const refs = kind === 'invoices' ? [d.party, d.cashAcc] : [d.acc, d.cashAcc, d.inv];
    if (refs.some(v => idOr(v) === null)) return null;
    if (!Number.isFinite(nOr(d.no, NaN))) return null; // رقم المستند لازم يكون رقم
    const o = { ...d, no: nOr(d.no), created: nOr(d.created), cur: d.cur || 'base', rate: d.cur === 'fx' ? nOr(d.rate) : '' };
    if ('rep' in d) { if (d.rep == null || d.rep === '') delete o.rep; else o.rep = txt(d.rep, 60); }
    if ('note' in d) o.note = txt(d.note, 500);
    ['waReq', 'waSent', 'waSkip'].forEach(k => { if (k in d) o[k] = nOr(d[k]); });
    if (kind === 'invoices') {
      if (!['sale', 'purchase', 'saleReturn', 'purchaseReturn'].includes(d.type) || !['cash', 'credit'].includes(d.pay) || !Array.isArray(d.lines)) return null;
      if (d.lines.some(l => !l || typeof l !== 'object' || !RX_ID.test(String(l.item || '')))) return null;
      o.lines = d.lines.map(l => ({ ...l, qty: nOr(l.qty), price: nOr(l.price), cp: l.cp === '' || l.cp == null ? '' : nOr(l.cp) }));
      o.discount = nOr(d.discount); o.addition = nOr(d.addition);
      if ('addNote' in d) o.addNote = txt(d.addNote, 200);
    } else {
      if (!['receipt', 'payment'].includes(d.type)) return null;
      o.amount = nOr(d.amount);
    }
    return o;
  }
  let rejected = 0;
  function apply(r) {
    const k = r.kind + '/' + r.id;
    if (r.kind === 'seq') {
      const s = r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : {}; let ch = false;
      for (const x in s) { const v = nOr(s[x], -1); if (v >= 0 && v < 1e9 && (db.seq[x] || 0) < v) { db.seq[x] = v; ch = true; } }
      return ch;
    }
    if ((r.kind === 'invoices' || r.kind === 'vouchers') && !r.deleted && r.data) {
      const c = cleanDoc(r.kind, r.data, r.id);
      if (!c) { rejected++; return false; }
      r = { ...r, data: c };
    }
    if (st.dirty[k]) return false; // تعديلي المحلي له الأولوية وسيُرفع
    if (r.kind === 'settings') {
      if (!r.data || same(r.data, db.settings)) return false;
      db.settings = { ...db.settings, ...r.data }; return true;
    }
    if (!KINDS.includes(r.kind)) return false;
    const arr = db[r.kind], i = arr.findIndex(x => x.id === r.id);
    if (r.deleted || !r.data) { if (i < 0) return false; arr.splice(i, 1); return true; }
    if (i >= 0) {
      if (same(arr[i], r.data)) return false;
      // منعدّل نفس الكائن بمكانه (مش منبدّله بكائن جديد) — هيك أي شاشة مفتوحة عليه (فاتورة، سند…) بتضل مربوطة فيه وما بيضيع حفظها
      const o = arr[i]; Object.keys(o).forEach(x => delete o[x]); Object.assign(o, r.data);
    }
    else arr.push(r.data);
    return true;
  }
  async function pull() {
    let changed = false, first = true, since = st.lastPull, newest = st.lastPull, remoteSeq = null;
    for (;;) {
      let q = `/rest/v1/records?company_id=eq.${st.company}&select=kind,id,data,deleted,updated_at&order=updated_at.asc&limit=1000`;
      if (since) {
        // تداخل 10 ثوانٍ في أول صفحة حتى لا تضيع أي تعديلات متزامنة
        const s = first ? new Date(new Date(since).getTime() - 10000).toISOString() : since;
        q += `&updated_at=gt.${encodeURIComponent(s)}`;
      }
      const rows = await http(q);
      for (const r of rows) {
        if (r.kind === 'seq') remoteSeq = r.data;
        if (apply(r)) changed = true;
        since = r.updated_at;
        if (!newest || new Date(r.updated_at) > new Date(newest)) newest = r.updated_at;
      }
      first = false;
      if (rows.length < 1000) break;
    }
    st.lastPull = newest;
    if (rejected) { console.warn('daftar: rejected', rejected, 'invalid records from cloud'); rejected = 0; }
    if (changed) {
      try { const j = JSON.stringify(db); if (window.Store) Store.write(j); else localStorage.setItem(DBKEY, j); } catch (e) { /* */ }
      _eng = null; _acc = null;
      $('#coName').textContent = db.settings.company;
    }
    snap = recs();
    if (remoteSeq && Object.keys(db.seq).some(x => (remoteSeq[x] || 0) < db.seq[x])) st.dirty['seq/main'] = 1;
    saveSt();
    return changed;
  }
  /* ---------- موبايل نقطة البيع خسر جلسته ----------
     حسابه انعمل لحاله وما إله كلمة سر يعرفها حدا، فما فيه «يسجّل دخول». منعمله حساب جديد ومنبعت طلب تفعيل للمدير،
     وبلا ما نمسح شي: بيكمّل بيع، وأول ما المدير يفعّله بترتفع كل المبيعات */
  async function relink(manual) {
    busy = true; pill();
    try {
      await posJoin(st.posReq.company, st.posReq.name);
      st.relink = 1; saveSt();
      toast('🔄 هالموبايل بحاجة تفعيل من جديد — وصل طلب للمدير، ومبيعاتك محفوظة', 1);
    } catch (e) { lastErr = e.message; if (manual) toast(e.message, 1); }
    busy = false; pill();
  }
  /* ---------- مبيعات ما ارتفعت على موبايل انوقف ----------
     قبل ما نمسح بيانات الشركة من موبايل مندوب انوقف: الفواتير والسندات يلي لسا ما ارتفعت منحفظها لحالها
     (بلا أسعار ولا أرصدة) — بترتفع لحالها إذا المدير رجع فعّله، أو بيبعتها للمدير بالواتساب */
  const STASH = 'daftar_stash';
  function makeStash() {
    const docs = [], names = {};
    for (const k of Object.keys(st.dirty)) {
      const m = /^(invoices|vouchers)\/(.+)$/.exec(k); if (!m) continue;
      const d = db[m[1]].find(x => x.id === m[2]); if (d) docs.push({ kind: m[1], ...d });
    }
    if (!docs.length) return null;
    docs.forEach(d => {
      [d.party, d.acc].forEach(id => { const a = id && db.accounts.find(x => x.id === id); if (a) names[id] = a.name; });
      (d.lines || []).forEach(l => { const it = db.items.find(x => x.id === l.item); if (it) names[l.item] = it.name; });
    });
    return { company: st.company, at: Date.now(), docs, names, cur: db.settings.currency || 'ل.س', fx: db.settings.currency2 || '$' };
  }
  const readStash = () => { try { return JSON.parse(localStorage.getItem(STASH) || 'null'); } catch (e) { return null; } };
  function keepStash(x) {
    if (!x) return;
    const old = readStash();
    if (old && old.company === x.company) { const ids = new Set(x.docs.map(d => d.id)); x.docs.push(...old.docs.filter(d => !ids.has(d.id))); Object.assign(x.names, old.names); }
    try { localStorage.setItem(STASH, JSON.stringify(x)); } catch (e) { /* */ }
  }
  async function sync(manual) {
    if (busy || window.__tabInactive) return; // تبويب تاني هو الشغّال
    if (configured() && !st.session && st.company && !st.owner && st.posReq && navigator.onLine) await relink(manual);
    if (!linked() || busy) return;
    if (!navigator.onLine) { lastErr = 'offline'; pill(); if (manual) toast('لا يوجد اتصال بالإنترنت — التغييرات محفوظة على الجهاز', 1); return; }
    // مرة وحدة على موبايل صاحب الشركة: رفع كل البيانات (يلي تعدّلت وقت كان تسجيل الدخول منتهي وما ارتفعت)
    if (st.owner && !st.fullPush1) { markAllDirty(); st.fullPush1 = 1; saveSt(); }
    busy = true; pill();
    try {
      // موبايل مندوب: إذا المدير وقّفه (ما عاد عضو بالشركة) منمسح بيانات الشركة من الموبايل كلها
      if (!st.owner) {
        const l = await http('/rest/v1/companies?select=id&id=eq.' + encodeURIComponent(st.company));
        const member = Array.isArray(l) && l.length > 0;
        if (member && st.relink) { st.relink = 0; st.lastPull = null; saveSt(); toast('✓ رجع هالموبايل مفعّل — عم ترتفع المبيعات'); }
        if (Array.isArray(l) && !member) {
          if (st.relink) {
            // لسا بانتظار تفعيل المدير؟ ما منرفع ولا منمسح شي
            const r = await http('/rest/v1/pos_requests?select=approved&company_id=eq.' + encodeURIComponent(st.company)).catch(() => [{}]);
            if (Array.isArray(r) && r.length) { busy = false; pill(); return; }
          }
          // انوقف (أو المدير رفض إعادة التفعيل): منحفظ يلي ما ارتفع، ومنمسح باقي بيانات الشركة
          const x = makeStash(); keepStash(x);
          Object.assign(st, { company: null, companyName: null, lastPull: null, lastSync: null, dirty: {}, res: {}, relink: 0 }); saveSt();
          if (typeof wipeLocalData === 'function') await wipeLocalData(true);
          busy = false; pill(); route();
          toast(x ? `⛔ هالموبايل انوقف — في ${x.docs.length} فاتورة/سند ما وصلوا للمدير، محفوظين عالموبايل` : '⛔ هالموبايل انوقف من المدير — انمسحت بيانات الشركة منه', 1);
          return;
        }
      }
      await push();
      // وإنت جوّا فاتورة أو قيد (أو نافذة مفتوحة) منرفع شغلك بس وما منلمس شي — منكمّل التنزيل لما تطلع
      let changed = false;
      if (manual || !editingNow()) { changed = await pull(); pullLater = false; await fixDupNumbers(); }
      else pullLater = true;
      st.lastSync = Date.now(); lastErr = ''; saveSt();
      if (changed) refreshView();
      if (st.owner) { posNotify(); if (typeof waOutboxBar === 'function') waOutboxBar(); }
      if (manual) toast('تمت المزامنة ✓');
    } catch (e) {
      lastErr = e.message;
      if (manual) toast('فشلت المزامنة: ' + e.message, 1);
    }
    busy = false; pill();
  }
  const editingNow = () => $('#dlg').open || /^#\/(invoice|entry)\//.test(location.hash);
  let pullLater = false;
  function schedule(ms) { clearTimeout(debounce); debounce = setTimeout(() => sync(), ms); }
  function refreshView() {
    const h = location.hash;
    const editing = $('#dlg').open || /^#\/(invoice|entry)\//.test(h) || /^#\/settings/.test(h);
    if (editing) toast('☁️ وصلت تحديثات من جهاز آخر');
    else route();
  }

  /* ---------- مؤشر الحالة ---------- */
  // زر المزامنة بالرئيسية: بيبيّن الحالة وكم تغيير لسا ما انرفع
  function homeBtn() {
    const b = document.getElementById('homeSync'); if (!b) return;
    const n = pending();
    if (!linked()) { b.textContent = '🔄 مزامنة (مش مربوطة)'; b.className = 'btn sync-btn'; return; }
    b.disabled = busy;
    if (busy) { b.textContent = '⏳ عم يزامن…'; b.className = 'btn sync-btn'; }
    else if (n) { b.textContent = `🔄 مزامنة — ${n} تغيير لسا ما انرفع`; b.className = 'btn pri sync-btn warn'; }
    else if (lastErr && lastErr !== 'offline') { b.textContent = '⚠️ فشلت آخر مزامنة — كبّس لتعيد'; b.className = 'btn pri sync-btn bad'; }
    else { b.textContent = `☁️ متزامن${st.lastSync ? ' — ' + ago(st.lastSync) : ''}`; b.className = 'btn sync-btn ok'; }
  }
  function pill() {
    const p = $('#syncPill'); if (!p) { homeBtn(); return; }
    if (!linked()) { p.hidden = true; homeBtn(); return; }
    p.hidden = false;
    const n = pending();
    let t, c = '';
    if (busy) t = '⏳ جاري المزامنة…';
    else if (!navigator.onLine || lastErr === 'offline') { t = `📴 بدون إنترنت${n ? ` — ${n} تغيير محفوظ` : ''}`; c = 'warn'; }
    else if (lastErr) { t = '⚠️ خطأ بالمزامنة'; c = 'bad'; }
    else if (n) t = `⏳ ${n} تغيير بانتظار الرفع`;
    else { t = '☁️ متزامن'; c = 'ok'; }
    p.textContent = t; p.className = 'sync-pill ' + c; p.title = lastErr && lastErr !== 'offline' ? lastErr : '';
    homeBtn();
  }

  /* ---------- واجهة الإعدادات ---------- */
  const ago = ts => { if (!ts) return 'لم تتم بعد'; const s = Math.round((Date.now() - ts) / 1000); return s < 60 ? 'قبل لحظات' : s < 3600 ? `قبل ${Math.round(s / 60)} دقيقة` : new Date(ts).toLocaleString('ar-SY'); };

  function card(el, opt = {}) {
    if (!el) return;
    const rerender = () => card(el, opt);
    const wrap = html => { el.innerHTML = `<h3>☁️ المزامنة السحابية</h3>${html}`; };

    if (!configured()) {
      wrap(`<p class="muted">اربط التطبيق بمشروعك على Supabase لتصل لبياناتك من أي جهاز. انسخ القيمتين من: Project Settings ← API (أو Data API / API Keys).</p>
        ${fields([{ k: 'url', l: 'Project URL (رابط المشروع)', ph: 'https://xxxx.supabase.co', full: 1 }, { k: 'key', l: 'المفتاح العام (anon / publishable key)', full: 1 }], { url: st.url, key: st.key })}
        <div class="form-actions"><button class="btn pri" id="cSave">حفظ الربط</button></div>`);
      $('#cSave', el).onclick = () => {
        const url = $('[name=url]', el).value.trim(), key = $('[name=key]', el).value.trim();
        if (!/^https?:\/\/.+/.test(url) || key.length < 20) return toast('تأكد من الرابط والمفتاح', 1);
        st.url = url; st.key = key; saveSt(); rerender();
      };
      return;
    }

    if (!st.session) {
      wrap(`<p class="muted">سجّل الدخول أو أنشئ حساباً جديداً. كل الأجهزة التي تدخل بنفس الحساب ترى نفس البيانات.</p>
        ${fields([{ k: 'email', l: 'الإيميل', t: 'email' }, { k: 'password', l: 'كلمة السر (6 أحرف على الأقل)', t: 'password' }])}
        <div class="form-actions"><button class="btn pri" id="cIn">دخول</button><button class="btn" id="cUp">إنشاء حساب جديد</button><button class="btn" id="cReset">تغيير رابط المشروع</button></div>`);
      const creds = () => ({ email: $('[name=email]', el).value.trim(), password: $('[name=password]', el).value });
      const run = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (e) { toast(e.message, 1); } btn.disabled = false; };
      $('#cIn', el).onclick = e => run(e.target, async () => {
        const c = creds(); await http('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify(c) }, false).then(setSession);
        toast('تم تسجيل الدخول');
        // الشركة لسا محفوظة عالموبايل: منتأكد مين صاحبها (إذا المدير دخل بموبايل كان عليه نقطة بيع ← بيرجع دفتر كامل)
        if (st.company) {
          const l = await http('/rest/v1/companies?select=id,name,owner&id=eq.' + encodeURIComponent(st.company));
          if (!l || !l.length) Object.assign(st, { company: null, companyName: null, owner: false, lastPull: null });
          else st.owner = l[0].owner === st.session.uid;
          saveSt();
          if (st.owner) { ownerHere(); return; }
        }
        rerender();
      });
      if (opt.gate) { $('#cUp', el).remove(); $('#cReset', el).remove(); }
      else $('#cUp', el).onclick = e => run(e.target, async () => {
        const c = creds(); if (c.password.length < 6) throw new Error('كلمة السر قصيرة (6 أحرف على الأقل)');
        const j = await http('/auth/v1/signup', { method: 'POST', body: JSON.stringify(c) }, false);
        if (j && j.access_token) { setSession(j); toast('تم إنشاء الحساب'); rerender(); }
        else toast('تم إنشاء الحساب ✓ افتح بريدك واضغط رابط التأكيد، ثم اضغط «دخول»');
      });
      if (!opt.gate) $('#cReset', el).onclick = () => { st.url = ''; st.key = ''; saveSt(); rerender(); };
      return;
    }

    if (!st.company) {
      wrap(`<p>مسجّل باسم: <b>${esc(st.session.email || '')}</b></p><div id="cList" class="muted">جاري تحميل الشركات…</div>
        <hr style="border:0;border-top:1px solid var(--line);margin:14px 0">
        <p><b>شركة جديدة على السحابة</b> — سيتم رفع بياناتك الموجودة على هذا الجهاز إليها.</p>
        ${fields([{ k: 'cname', l: 'اسم الشركة', full: 1 }], { cname: db.settings.company })}
        <div class="form-actions"><button class="btn pri" id="cNew">إنشاء ورفع بياناتي</button><button class="btn" id="cOut">تسجيل الخروج</button></div>`);
      $('#cOut', el).onclick = () => { logout(); if (/^#\/(pos|sellersetup)/.test(location.hash)) route(); else rerender(); };
      if (opt.gate) { const n = $('#cNew', el); n.closest('.form-actions').previousElementSibling.remove(); n.closest('.form-actions').previousElementSibling.remove(); n.remove(); }
      else $('#cNew', el).onclick = async e => {
        const name = $('[name=cname]', el).value.trim() || 'شركتي';
        e.target.disabled = true;
        try {
          const id = crypto.randomUUID();
          await http('/rest/v1/companies', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ id, name }) });
          Object.assign(st, { company: id, companyName: name, owner: true, lastPull: null }); markAllDirty();
          snap = recs(); await sync(true); rerender();
        } catch (err) { toast(err.message, 1); e.target.disabled = false; }
      };
      http('/rest/v1/companies?select=id,name,owner&order=created_at').then(list => {
        const box = $('#cList', el); if (!box) return;
        box.innerHTML = list.length
          ? `<p><b>شركاتك على السحابة</b> — فتح شركة سيستبدل البيانات الموجودة على هذا الجهاز ببيانات السحابة.</p>` + list.map(c => `<div class="acts" style="margin-bottom:6px"><button class="btn" data-cid="${c.id}">📂 فتح: ${esc(c.name)}</button></div>`).join('')
          : 'لا توجد شركات على السحابة بعد.';
        $$('[data-cid]', box).forEach(b => (b.onclick = async () => {
          const c = list.find(x => x.id === b.dataset.cid);
          if ((db.invoices.length || db.items.length) && !confirm(`سيتم استبدال بيانات هذا الجهاز ببيانات "${c.name}" من السحابة. متابعة؟`)) return;
          b.disabled = true;
          try { await openCompany(c); rerender(); toast('تم فتح الشركة وتنزيل البيانات ✓'); }
          catch (err) { toast(err.message, 1); b.disabled = false; }
        }));
      }).catch(err => { const box = $('#cList', el); if (box) box.innerHTML = `<span class="bad">${esc(err.message)}</span>`; });
      return;
    }

    wrap(`<p>الشركة: <b>${esc(st.companyName || '')}</b><br>الحساب: ${esc(st.session.email || '')}<br>آخر مزامنة: ${ago(st.lastSync)}${pending() ? ` — <b>${pending()}</b> تغيير بانتظار الرفع` : ''}</p>
      ${lastErr && lastErr !== 'offline' ? `<p class="bad">${esc(lastErr)}</p>` : ''}
      <div class="acts"><button class="btn pri" id="cSync">🔄 مزامنة الآن</button>${st.owner ? '<button class="btn" id="cAdd">👤 إضافة مستخدم</button>' : ''}<button class="btn red" id="cOut">تسجيل الخروج</button><button class="btn red" id="cWipe">🚪 خروج ومسح البيانات من هالموبايل</button></div>
      <p class="muted" style="margin-top:10px">التطبيق يعمل بدون إنترنت، وتُرفع التغييرات تلقائياً عند عودة الاتصال.</p>`);
    $('#cSync', el).onclick = async () => { await sync(true); rerender(); };
    $('#cOut', el).onclick = () => {
      if (pending() && !confirm(`يوجد ${pending()} تغيير لم يُرفع بعد. تسجيل الخروج الآن قد يفقدها من السحابة. متابعة؟`)) return;
      logout(); if (/^#\/(pos|sellersetup)/.test(location.hash)) route(); else rerender();
    };
    // خروج ومسح: بس بعد ما يتأكد إنه كل شي ارتفع عالسحابة (ما بيضيع شي)
    $('#cWipe', el).onclick = async e => {
      const b = e.target; b.disabled = true;
      try {
        if (!navigator.onLine) throw new Error('بدها نت — لازم نتأكد إنه كل شي ارتفع عالسحابة قبل المسح');
        await sync(true);
        if (pending()) throw new Error(`في ${pending()} تغيير لسا ما ارتفع — جرّب «🔄 مزامنة الآن» وبعدين ارجع`);
        if (!confirm('رح يتسكّر البرنامج على هالموبايل وتنمسح منه كل البيانات (الفواتير والزباين والمواد والنسخ الأوتوماتيكية).\n\nبياناتك بتضل محفوظة بالسحابة، وبترجع إذا دخلت من جديد.\n\nمتابعة؟')) { b.disabled = false; return; }
        logout();
        if (typeof wipeLocalData === 'function') await wipeLocalData(false);
        try { localStorage.removeItem(SKEY); } catch (er) { /* */ }
        toast('✓ انمسحت البيانات من هالموبايل');
        setTimeout(() => { location.hash = '#/'; location.reload(); }, 600);
      } catch (err) { toast(err.message, 1); b.disabled = false; }
    };
    if (st.owner) $('#cAdd', el).onclick = () => modal('إضافة مستخدم للشركة',
      `<p class="muted">يجب أن يكون المستخدم قد أنشأ حساباً من التطبيق أولاً (من جهازه: الإعدادات ← إنشاء حساب جديد). بعد إضافته يسجّل الدخول ويختار الشركة.</p>` + fields([{ k: 'email', l: 'إيميل المستخدم', t: 'email', req: 1, full: 1 }]), {
        saveText: 'إضافة',
        onSave: d => {
          http('/rest/v1/rpc/add_member', { method: 'POST', body: JSON.stringify({ p_company: st.company, p_email: d.email }) })
            .then(r => toast(r === 'ok' ? 'تمت إضافة المستخدم ✓' : 'لا يوجد حساب بهذا الإيميل — اطلب منه إنشاء حساب أولاً', r !== 'ok'))
            .catch(e => toast(e.message, 1));
        },
      });
  }
  // من شاشة نقطة البيع: المدير بيدخل بإيميله ← بيرجع الموبايل دفتر كامل (ما منلمس الجلسة إلا إذا الحساب صاحب شركة)
  async function ownerSwitch(email, password) {
    const j = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) }, false);
    const uid = j.user && j.user.id; if (!uid) throw new Error('ما زبط تسجيل الدخول');
    const { url, key } = cfg();
    const r = await fetch(url + '/rest/v1/companies?select=id,name,owner&owner=eq.' + uid + '&order=created_at', { headers: { apikey: key, Authorization: 'Bearer ' + j.access_token } });
    const list = r.ok ? await r.json() : [];
    if (!list.length) throw new Error('هالحساب مش صاحب شركة — جرّب إيميل المدير يلي عمل الشركة');
    if (pending() && !confirm(`في ${pending()} تغيير لسا ما ارتفع من نقطة البيع. إذا كمّلت ممكن يضيع. متابعة؟`)) return;
    setSession(j); st.posReq = null;
    const same = list.find(c => c.id === st.company);
    if (same) { st.owner = true; saveSt(); ownerHere(); return; }
    await openCompany(list[0]);
  }
  // موبايل المدير: بيرجع دفتر كامل (منشيل قفل نقطة البيع ووضع البيّاع عنه)
  function ownerHere() {
    try { localStorage.removeItem('daftar_seller'); localStorage.removeItem('daftar_pos_device'); localStorage.removeItem('daftar_rep_name'); } catch (e) { /* */ }
    st.posReq = null; saveSt();
    if (typeof applySellerUI === 'function') { applySellerUI(); location.hash = '#/'; route(); }
    toast('✓ أهلاً — هاد موبايل المدير، رجع دفتر كامل');
  }
  async function openCompany(c) {
    const backup = db;
    Object.assign(st, { company: c.id, companyName: c.name, owner: c.owner === st.session.uid, lastPull: null, dirty: {} });
    db = { ...seed(), accounts: [], items: [], groups: [], invoices: [], vouchers: [], entries: [], seq: {} };
    try {
      await pull();
      if (!db.accounts.length) { db = { ...seed(), settings: { ...seed().settings, ...db.settings } }; markAllDirty(); }
      { const j = JSON.stringify(db); if (window.Store) Store.write(j); else localStorage.setItem(DBKEY, j); } _eng = null; _acc = null; snap = recs();
      $('#coName').textContent = db.settings.company;
      // مبيعات كانت محفوظة من قبل ما ينوقف هالموبايل: بترجع وبترتفع هلق
      const sx = readStash();
      if (sx && sx.company === c.id) {
        let n = 0;
        for (const { kind, ...d } of sx.docs) if (KINDS.includes(kind) && !db[kind].some(x => x.id === d.id)) { db[kind].push(d); n++; }
        localStorage.removeItem(STASH);
        if (n) { save(); toast(`✓ ${n} فاتورة/سند كانوا محفوظين — عم يرتفعوا للمدير`); }
      }
      await sync();
      if (st.owner) ownerHere();
      else if (typeof applySellerUI === 'function') { applySellerUI(); setTimeout(() => { location.hash = '#/'; route(); }, 50); }
    } catch (e) {
      db = backup; Object.assign(st, { company: null, companyName: null, lastPull: null, dirty: {} }); saveSt(); snap = recs();
      throw e;
    }
  }
  /* ---------- نقطة البيع: طلب تفعيل من موبايل المندوب، والمدير بيفعّل من موبايله ---------- */
  const noTable = e => /pos_requests|approve_pos|revoke_pos|Could not find/i.test(e.message) ? new Error('لازم تحدّث قاعدة البيانات: شغّل ملف supabase.sql من جديد بـ Supabase ← SQL Editor') : e;
  const rnd = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), x => 'abcdefghijkmnpqrstuvwxyz23456789'[x % 32]).join('');
  // موبايل المندوب: حساب لحاله (بلا إيميل ولا كلمة سر) + طلب تفعيل للشركة
  async function posJoin(company, name) {
    if (!configured()) throw new Error('رابط السحابة مش مضبوط بـ config.js');
    if (st.session && st.owner && st.company) throw new Error('هالموبايل مسجّل بحساب المدير');
    if (!st.session) {
      const j = await http('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email: `pos-${rnd(10)}@pos.daftar.app`, password: rnd(24) }) }, false);
      if (!j || !j.access_token) throw new Error('السيرفر طالب تأكيد إيميل — المدير لازم يطفّي «Confirm email» من Supabase ← Authentication ← Sign In / Providers ← Email');
      setSession(j);
    }
    st.posReq = { company, name }; saveSt();
    try {
      await http('/rest/v1/pos_requests?on_conflict=company_id,user_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify({ company_id: company, name }) });
    } catch (e) { throw noTable(e); }
  }
  // موبايل المندوب: تفعّل؟ إذا إيه منفتح الشركة
  async function posCheck() {
    if (!st.posReq || !st.session) return 'none';
    const list = await http('/rest/v1/companies?select=id,name,owner&id=eq.' + encodeURIComponent(st.posReq.company));
    if (list && list.length) { await openCompany(list[0]); return 'ok'; }
    const r = await http('/rest/v1/pos_requests?select=approved&company_id=eq.' + encodeURIComponent(st.posReq.company)).catch(e => { throw noTable(e); });
    return r && r.length ? 'wait' : 'rejected'; // ما في طلب = المدير رفضه أو وقّفه
  }
  // موبايل المدير: الطلبات والموبايلات المفعّلة
  async function posList() {
    if (!linked() || !st.owner) return [];
    try { return await http('/rest/v1/pos_requests?select=user_id,name,approved,created_at&order=created_at&company_id=eq.' + st.company) || []; }
    catch (e) { throw noTable(e); }
  }
  const posApprove = uid => http('/rest/v1/rpc/approve_pos', { method: 'POST', body: JSON.stringify({ p_company: st.company, p_user: uid }) }).catch(e => { throw noTable(e); });
  const posRevoke = uid => http('/rest/v1/rpc/revoke_pos', { method: 'POST', body: JSON.stringify({ p_company: st.company, p_user: uid }) }).catch(e => { throw noTable(e); });
  // شريط فوق بموبايل المدير: «في موبايل بدو يفتح نقطة البيع»
  let reqBusy = false;
  async function posNotify() {
    if (reqBusy || !linked() || !st.owner) return;
    reqBusy = true;
    let list = []; try { list = (await posList()).filter(r => !r.approved); } catch (e) { /* الجدول لسا ما انعمل */ }
    reqBusy = false;
    let bar = document.getElementById('posReqBar');
    if (!list.length) { if (bar) bar.remove(); return; }
    if (!bar) { bar = document.createElement('div'); bar.id = 'posReqBar'; document.body.appendChild(bar); }
    const r = list[0];
    bar.innerHTML = `<b>📲 موبايل «${esc(r.name || 'مندوب')}» بدو يفتح نقطة البيع</b>${list.length > 1 ? ` <small>(+${list.length - 1})</small>` : ''}<div><button class="btn pri" data-a="ok">✓ تفعيل</button><button class="btn red" data-a="no">✕ رفض</button></div>`;
    bar.onclick = async e => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      a.disabled = true;
      try {
        if (a.dataset.a === 'ok') { await posApprove(r.user_id); if (typeof ensureRepBox === 'function') ensureRepBox(r.name); toast('✓ تفعّلت نقطة البيع على موبايل ' + (r.name || 'المندوب')); }
        else { await posRevoke(r.user_id); toast('انرفض الطلب'); }
      } catch (err) { toast(err.message, 1); }
      bar.remove(); posNotify(); if (/^#\/settings/.test(location.hash)) route();
    };
  }

  /* ---------- الترقيم: كل جهاز بيحجز الرقم الجاي من السيرفر سلفاً — ما بيتكرر رقم بين جهازين ---------- */
  st.res = st.res || {};
  const resBusy = {};
  async function reserve(key) {
    if (!key || !linked() || st.res[key] || resBusy[key] || !navigator.onLine) return;
    resBusy[key] = 1;
    try {
      const n = await http('/rest/v1/rpc/take_no', { method: 'POST', body: JSON.stringify({ p_company: st.company, p_key: key, p_min: num(db.seq[key]) }) });
      if (num(n) > 0) { st.res[key] = num(n); saveSt(); }
    } catch (e) { /* الدالة لسا ما انعملت بالسيرفر، أو ما في نت — منرجع للترقيم المحلي */ }
    resBusy[key] = 0;
  }
  // الرقم المحجوز (إذا في) — وبعدها منحجز يلي بعده بالخلفية
  function take(key) {
    const n = st.res[key]; if (!n) return 0;
    delete st.res[key]; saveSt(); setTimeout(() => reserve(key), 300);
    return n;
  }
  const seqKey = (d, kind) => (kind === 'entries' ? 'entry' : d.type + (d.rep ? '@' + d.rep : ''));
  // رقم انعمل بلا نت (محلي) وطلع مكرر مع جهاز تاني: منعطيه رقم جديد من السيرفر
  async function fixDupNumbers() {
    if (!linked()) return;
    const fixed = [];
    for (const kind of ['invoices', 'vouchers', 'entries']) {
      const groups = {};
      for (const d of db[kind]) { const k = seqKey(d, kind) + '#' + d.no; (groups[k] = groups[k] || []).push(d); }
      for (const k in groups) {
        const g = groups[k]; if (g.length < 2) continue;
        const local = g.filter(d => d.nl).sort((a, b) => num(b.created) - num(a.created));
        // منخلّي واحد (يلي رقمه من السيرفر، أو الأقدم) ومنغيّر رقم الباقي المحليين
        const keep = g.find(d => !d.nl) || local[local.length - 1];
        for (const d of local) {
          if (d === keep) continue;
          let n = 0;
          const sk = seqKey(d, kind);
          try { n = num(await http('/rest/v1/rpc/take_no', { method: 'POST', body: JSON.stringify({ p_company: st.company, p_key: sk, p_min: num(db.seq[sk]) }) })); } catch (e) { /* */ }
          if (!n) continue;
          const old = d.no; d.no = n; delete d.nl; db.seq[sk] = Math.max(num(db.seq[sk]), n);
          fixed.push(`${kind === 'invoices' ? 'فاتورة' : kind === 'vouchers' ? 'سند' : 'قيد'} ${old} ← ${n}`);
        }
      }
    }
    if (fixed.length) { save(); toast('🔢 تغيّر رقم مكرر (انعمل بلا نت): ' + fixed.join('، '), 1); }
  }

  function logout() {
    const { url, key } = cfg();
    if (st.session) fetch(url + '/auth/v1/logout', { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + st.session.access_token } }).catch(() => {});
    Object.assign(st, { session: null, company: null, companyName: null, owner: false, lastPull: null, lastSync: null, dirty: {}, posReq: null });
    saveSt(); pill();
  }

  /* ---------- الإقلاع ---------- */
  snap = recs();
  window.addEventListener('online', () => { lastErr = ''; sync(); });
  window.addEventListener('offline', pill);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  // أول ما تطلع من الفاتورة/القيد: منزّل يلي فاتك
  window.addEventListener('hashchange', () => { if (!editingNow() && (pullLater || pending())) schedule(400); });
  setInterval(() => sync(), 30000);
  $('#syncPill').onclick = () => go('#/settings');
  pill();
  setTimeout(() => sync(), 800);

  // عضو بشركة مش صاحبها (متل المندوب) = وضع البيّاع تلقائياً على موبايله
  if (typeof applySellerUI === 'function') setTimeout(() => { applySellerUI(); route(); }, 0); // كمان شاشة القفل بتحتاج Cloud جاهز
  return { track, card, sync, pill, reserve, take, posJoin, posCheck, ownerSwitch, posList, posApprove, posRevoke, posNotify, info: () => ({ linked: linked(), pending: pending(), busy, lastSync: st.lastSync, configured: configured(), owner: !!(linked() && st.owner), member: !!(configured() && st.company && !st.owner), company: st.company || '', posReq: st.posReq || null, signedIn: !!st.session, relink: !!st.relink, stash: readStash(), email: st.session?.email || '' }) };
})();
window.Cloud = Cloud;
if (/^#\/settings/.test(location.hash)) route();
