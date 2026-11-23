'use strict';
/* =====================================================================
   تخزين البيانات بـ IndexedDB (مساحة أكبر بكتير من localStorage)
   - أول مرة: بينقل البيانات من localStorage لحاله، وبعد ما تنحفظ هون بيمسح القديمة
   - البرنامج بيشتغل بالذاكرة، والحفظ بيصير بالخلفية بالترتيب (آخر نسخة بتغلب)
   - إذا IndexedDB مش متوفر: منرجع لـ localStorage متل قبل
   ===================================================================== */
const Store = (() => {
  const KEY = 'daftar-db-v1', DBN = 'daftar', OS = 'kv';
  let idb = null, ok = false, boot = null, pending = null, chain = Promise.resolve(), lastErr = '';

  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open(DBN, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(OS);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('blocked'));
  });
  const get = k => new Promise((res, rej) => {
    const q = idb.transaction(OS).objectStore(OS).get(k);
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
  const put = (k, v) => new Promise((res, rej) => {
    const tx = idb.transaction(OS, 'readwrite');
    tx.objectStore(OS).put(v, k);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('abort'));
  });
  const del = k => new Promise((res, rej) => {
    const tx = idb.transaction(OS, 'readwrite'); tx.objectStore(OS).delete(k);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
  const keys = () => new Promise((res, rej) => {
    const q = idb.transaction(OS).objectStore(OS).getAllKeys();
    q.onsuccess = () => res(q.result.map(String)); q.onerror = () => rej(q.error);
  });
  const timeout = (p, ms) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error('timeout')), ms))]);

  async function init() {
    let ls = null; try { ls = localStorage.getItem(KEY); } catch (e) { /* */ }
    try {
      if (!window.indexedDB) throw new Error('no idb');
      idb = await timeout(open(), 4000);
      let s = await get(KEY);
      // بيانات بـ localStorage = يا أول نقل، يا نسخة أحدث كتبها إصدار قديم: هي يلي منعتمدها
      if (ls) { await put(KEY, ls); s = ls; try { localStorage.removeItem(KEY); } catch (e) { /* */ } }
      boot = s == null ? null : s; ok = true;
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* */ }
    } catch (e) { ok = false; boot = ls; lastErr = String(e && e.message || e); }
  }
  // البيانات وقت فتح البرنامج (نص JSON)
  function read() { const b = boot; boot = null; return b; }
  // حفظ: بالترتيب، وإذا في كذا حفظ ورا بعض منكتب آخر وحدة بس
  function write(str) {
    if (!ok) { localStorage.setItem(KEY, str); return; } // نفس السلوك القديم (بيرمي خطأ إذا امتلت المساحة)
    pending = str;
    chain = chain.then(async () => {
      if (pending == null) return;
      const v = pending; pending = null;
      try { await put(KEY, v); lastErr = ''; }
      catch (e) {
        lastErr = String(e && e.message || e);
        try { localStorage.setItem(KEY, v); } // احتياط: ما منضيّع الحفظ
        catch (e2) { if (window.toast) toast('تعذّر الحفظ: مساحة التخزين ممتلئة', 1); }
      }
    });
  }
  const flush = () => chain;
  async function usage() {
    try { const e = await navigator.storage.estimate(); return { used: e.usage || 0, quota: e.quota || 0 }; } catch (e) { return null; }
  }
  // تحميل باقي ملفات البرنامج بالترتيب بعد ما تجهز البيانات
  function start(files, done) {
    init().then(() => {
      let i = 0;
      const next = () => {
        if (i >= files.length) { if (done) done(); return; }
        const sc = document.createElement('script'); sc.src = files[i++];
        sc.onload = next; sc.onerror = next;
        document.body.appendChild(sc);
      };
      next();
    });
  }
  // مفاتيح إضافية (للنسخ الاحتياطية الأوتوماتيكية) — بس إذا IndexedDB شغّال
  const extra = {
    get: k => (ok ? get(k) : Promise.resolve(null)),
    put: (k, v) => (ok ? put(k, v) : Promise.reject(new Error('no idb'))),
    del: k => (ok ? del(k) : Promise.resolve()),
    keys: pre => (ok ? keys().then(l => l.filter(k => k.startsWith(pre))) : Promise.resolve([])),
  };
  return { start, read, write, flush, usage, ...extra, info: () => ({ idb: ok, err: lastErr }) };
})();
window.Store = Store;
