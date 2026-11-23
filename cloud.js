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
    for (let i = 0; i < rows.length; i += 400) {
      await http('/rest/v1/records?on_conflict=company_id,kind,id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows.slice(i, i + 400)) });
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
  function apply(r) {
    const k = r.kind + '/' + r.id;
    if (r.kind === 'seq') {
      const s = r.data || {}; let ch = false;
      for (const x in s) if ((db.seq[x] || 0) < s[x]) { db.seq[x] = s[x]; ch = true; }
      return ch;
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
    if (changed) {
      try { localStorage.setItem(DBKEY, JSON.stringify(db)); } catch (e) { /* */ }
      _eng = null;
      $('#coName').textContent = db.settings.company;
    }
    snap = recs();
    if (remoteSeq && Object.keys(db.seq).some(x => (remoteSeq[x] || 0) < db.seq[x])) st.dirty['seq/main'] = 1;
    saveSt();
    return changed;
  }
  async function sync(manual) {
    if (!linked() || busy) return;
    if (!navigator.onLine) { lastErr = 'offline'; pill(); if (manual) toast('لا يوجد اتصال بالإنترنت — التغييرات محفوظة على الجهاز', 1); return; }
    // مرة وحدة على موبايل صاحب الشركة: رفع كل البيانات (يلي تعدّلت وقت كان تسجيل الدخول منتهي وما ارتفعت)
    if (st.owner && !st.fullPush1) { markAllDirty(); st.fullPush1 = 1; saveSt(); }
    busy = true; pill();
    try {
      await push();
      // وإنت جوّا فاتورة أو قيد (أو نافذة مفتوحة) منرفع شغلك بس وما منلمس شي — منكمّل التنزيل لما تطلع
      let changed = false;
      if (manual || !editingNow()) { changed = await pull(); pullLater = false; }
      else pullLater = true;
      st.lastSync = Date.now(); lastErr = ''; saveSt();
      if (changed) refreshView();
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

  function card(el) {
    if (!el) return;
    const rerender = () => card(el);
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
      $('#cIn', el).onclick = e => run(e.target, async () => { const c = creds(); await http('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify(c) }, false).then(setSession); toast('تم تسجيل الدخول'); rerender(); });
      $('#cUp', el).onclick = e => run(e.target, async () => {
        const c = creds(); if (c.password.length < 6) throw new Error('كلمة السر قصيرة (6 أحرف على الأقل)');
        const j = await http('/auth/v1/signup', { method: 'POST', body: JSON.stringify(c) }, false);
        if (j && j.access_token) { setSession(j); toast('تم إنشاء الحساب'); rerender(); }
        else toast('تم إنشاء الحساب ✓ افتح بريدك واضغط رابط التأكيد، ثم اضغط «دخول»');
      });
      $('#cReset', el).onclick = () => { st.url = ''; st.key = ''; saveSt(); rerender(); };
      return;
    }

    if (!st.company) {
      wrap(`<p>مسجّل باسم: <b>${esc(st.session.email || '')}</b></p><div id="cList" class="muted">جاري تحميل الشركات…</div>
        <hr style="border:0;border-top:1px solid var(--line);margin:14px 0">
        <p><b>شركة جديدة على السحابة</b> — سيتم رفع بياناتك الموجودة على هذا الجهاز إليها.</p>
        ${fields([{ k: 'cname', l: 'اسم الشركة', full: 1 }], { cname: db.settings.company })}
        <div class="form-actions"><button class="btn pri" id="cNew">إنشاء ورفع بياناتي</button><button class="btn" id="cOut">تسجيل الخروج</button></div>`);
      $('#cOut', el).onclick = () => { logout(); if (/^#\/(pos|sellersetup)/.test(location.hash)) route(); else rerender(); };
      $('#cNew', el).onclick = async e => {
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
      <div class="acts"><button class="btn pri" id="cSync">🔄 مزامنة الآن</button>${st.owner ? '<button class="btn" id="cAdd">👤 إضافة مستخدم</button>' : ''}<button class="btn red" id="cOut">تسجيل الخروج</button></div>
      <p class="muted" style="margin-top:10px">التطبيق يعمل بدون إنترنت، وتُرفع التغييرات تلقائياً عند عودة الاتصال.</p>`);
    $('#cSync', el).onclick = async () => { await sync(true); rerender(); };
    $('#cOut', el).onclick = () => {
      if (pending() && !confirm(`يوجد ${pending()} تغيير لم يُرفع بعد. تسجيل الخروج الآن قد يفقدها من السحابة. متابعة؟`)) return;
      logout(); if (/^#\/(pos|sellersetup)/.test(location.hash)) route(); else rerender();
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
  async function openCompany(c) {
    const backup = db;
    Object.assign(st, { company: c.id, companyName: c.name, owner: c.owner === st.session.uid, lastPull: null, dirty: {} });
    db = { ...seed(), accounts: [], items: [], groups: [], invoices: [], vouchers: [], entries: [], seq: {} };
    try {
      await pull();
      if (!db.accounts.length) { db = { ...seed(), settings: { ...seed().settings, ...db.settings } }; markAllDirty(); }
      localStorage.setItem(DBKEY, JSON.stringify(db)); _eng = null; snap = recs();
      $('#coName').textContent = db.settings.company;
      await sync();
      if (typeof applySellerUI === 'function') { applySellerUI(); if (!st.owner) setTimeout(() => { location.hash = '#/'; route(); }, 50); }
    } catch (e) {
      db = backup; Object.assign(st, { company: null, companyName: null, lastPull: null, dirty: {} }); saveSt(); snap = recs();
      throw e;
    }
  }
  /* ---------- حساب نقطة بيع تلقائي (بلا ما المندوب يكتب إيميل ولا كلمة سر) ---------- */
  // المدير بيعمل حساب للمندوب لحاله وبيضيفه للشركة، والإيميل وكلمة السر بينحطّوا جوّا الباركود
  async function makeRep() {
    if (!linked() || !st.owner) throw new Error('لازم تكون مسجّل دخول بحساب المدير وفاتح الشركة (الإعدادات ← المزامنة السحابية)');
    const rnd = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
    const email = `pos-${rnd(10)}@pos.daftar.app`, password = rnd(20);
    const j = await http('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email, password }) }, false);
    if (!j || !j.access_token) throw new Error('السيرفر طالب تأكيد إيميل — من Supabase: Authentication ← Sign In / Providers ← Email ← طفّي «Confirm email» وجرّب مرة تانية');
    const r = await http('/rest/v1/rpc/add_member', { method: 'POST', body: JSON.stringify({ p_company: st.company, p_email: email }) });
    if (r !== 'ok') throw new Error('ما قدرت ضيف حساب نقطة البيع للشركة');
    return { e: email, p: password, c: st.company };
  }
  // موبايل المندوب: بيسجّل دخول وبيفتح الشركة لحاله من معلومات الباركود
  async function posLogin(k) {
    if (st.session && st.company && !st.owner) return false; // مربوط من قبل
    if (st.session && st.owner) throw new Error('هالموبايل مسجّل بحساب المدير');
    const j = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: k.e, password: k.p }) }, false);
    setSession(j);
    const list = await http('/rest/v1/companies?select=id,name,owner&id=eq.' + encodeURIComponent(k.c));
    if (!list || !list.length) throw new Error('الشركة مش موجودة أو المندوب مش مضاف إلها');
    await openCompany(list[0]);
    return true;
  }

  function logout() {
    const { url, key } = cfg();
    if (st.session) fetch(url + '/auth/v1/logout', { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + st.session.access_token } }).catch(() => {});
    Object.assign(st, { session: null, company: null, companyName: null, owner: false, lastPull: null, lastSync: null, dirty: {} });
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
  if (typeof applySellerUI === 'function') setTimeout(() => { applySellerUI(); if ((st.company && !st.owner) || /^#\/(pos|sellersetup)/.test(location.hash)) route(); }, 0);
  return { track, card, sync, pill, makeRep, posLogin, info: () => ({ linked: linked(), pending: pending(), busy, lastSync: st.lastSync, member: !!(configured() && st.company && !st.owner), company: st.company || '', email: st.session?.email || '' }) };
})();
window.Cloud = Cloud;
if (/^#\/settings/.test(location.hash)) route();
