'use strict';
/* =====================================================================
   آلة حاسبة عائمة — زر 🧮 ظاهر دايماً بكل الصفحات (حتى نقطة البيع)
   - بتنسحب لأي مكان بالشاشة وبتتذكر مكانها
   - «⬇️ حط بالخانة»: بيحط النتيجة بآخر خانة كنت عم تكتب فيها
   ===================================================================== */
(() => {
  const POS_KEY = 'daftar_calc_pos';
  const root = document.createElement('div');
  root.id = 'calc';
  root.innerHTML = `
    <button type="button" id="calcFab" aria-label="آلة حاسبة">🧮</button>
    <div id="calcBox" hidden>
      <div class="calc-head"><span>🧮 آلة حاسبة</span><button type="button" data-k="close" aria-label="إغلاق">✕</button></div>
      <div class="calc-exp" id="calcExp"></div>
      <div class="calc-out" id="calcOut">0</div>
      <div class="calc-keys">
        ${['C', '⌫', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '00', '0', '.', '=']
          .map(k => `<button type="button" data-k="${k}" class="${'÷×−+='.includes(k) ? 'op' : k === 'C' || k === '⌫' ? 'fn' : ''}${k === '=' ? ' eq' : ''}">${k}</button>`).join('')}
      </div>
      <button type="button" class="calc-put" data-k="put" id="calcPut" hidden>⬇️ حط النتيجة بالخانة</button>
    </div>`;

  let exp = '', last = null, target = null, justEq = false;
  const $c = s => root.querySelector(s);
  const fmtN = n => (Math.round(n * 1e6) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 6 });

  // حساب بلا eval: + − × ÷ و % (النسبة من الرقم يلي قبلها)
  function calc(s) {
    const t = s.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').match(/\d*\.?\d+|[-+*/%]/g) || [];
    let i = 0, pct = false;
    const num = () => {
      let sg = 1; while (t[i] === '-' || t[i] === '+') { if (t[i] === '-') sg = -sg; i++; }
      const v = parseFloat(t[i++]); if (isNaN(v)) throw 0;
      let r = sg * v; pct = false; while (t[i] === '%') { r /= 100; i++; pct = true; }
      return r;
    };
    const term = () => {
      let v = num(), solo = pct;
      while (t[i] === '*' || t[i] === '/') { const o = t[i++]; const b = num(); v = o === '*' ? v * b : v / b; solo = false; }
      pct = solo; return v;
    };
    let v = term();
    while (t[i] === '+' || t[i] === '-') {
      const o = t[i++]; let b = term();
      if (pct) b = v * b; // 200 + 10% = 220
      v = o === '+' ? v + b : v - b;
    }
    if (i < t.length || !isFinite(v)) throw 0;
    return v;
  }
  function show() {
    $c('#calcExp').textContent = exp || '';
    let r = null; try { r = exp ? calc(exp) : 0; } catch (e) { r = null; }
    if (r !== null) last = r;
    $c('#calcOut').textContent = r === null ? (exp ? '…' : '0') : fmtN(r);
    $c('#calcPut').hidden = !(target && document.contains(target) && last !== null && exp);
  }
  function press(k) {
    const ops = '÷×−+';
    if (k === 'close') return open(false);
    if (k === 'put') {
      if (!target || last === null) return;
      target.value = String(Math.round(last * 100) / 100);
      target.dispatchEvent(new Event('input', { bubbles: true })); target.dispatchEvent(new Event('change', { bubbles: true }));
      open(false); try { target.focus(); } catch (e) { /* */ }
      return;
    }
    if (k === 'C') { exp = ''; justEq = false; }
    else if (k === '⌫') { exp = exp.slice(0, -1); justEq = false; }
    else if (k === '=') { try { const r = calc(exp); exp = String(Math.round(r * 1e6) / 1e6); justEq = true; } catch (e) { /* */ } }
    else if (ops.includes(k)) {
      if (!exp && k !== '−') return;
      exp = ops.includes(exp.slice(-1)) ? exp.slice(0, -1) + k : exp + k; justEq = false;
    } else if (k === '%') { if (exp && !ops.includes(exp.slice(-1))) exp += '%'; }
    else {
      if (justEq) { exp = ''; justEq = false; }
      if (exp.slice(-1) === '%') exp += '×';
      if (k === '.') { const seg = exp.split(/[÷×−+%]/).pop(); if (seg.includes('.')) return; if (!seg) exp += '0'; }
      exp += k;
    }
    show();
  }
  function open(on) {
    const box = $c('#calcBox');
    // لما تسكّر: النتيجة بتضل ظاهرة، وأول رقم بتكبسه بعدين بيبلّش حساب جديد
    if (!on && exp && last !== null) { exp = String(Math.round(last * 1e6) / 1e6); justEq = true; }
    box.hidden = !on; root.classList.toggle('on', on);
    if (on) { place(); show(); }
  }
  // خانة الكتابة الأخيرة (برّا الحاسبة) — لزر «حط بالخانة»
  document.addEventListener('focusin', e => {
    const el = e.target;
    if (root.contains(el)) return;
    if (el.matches && el.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=date]):not([type=search]):not([type=password]):not([type=email]), textarea')) target = el;
  });

  // السحب
  let pos = null; try { pos = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch (e) { /* */ }
  const fab = $c('#calcFab');
  function place() {
    const w = innerWidth, h = innerHeight, fw = 54;
    let p = pos || { x: 14, y: h - fw - 90 };
    p.x = Math.min(Math.max(6, p.x), w - fw - 6); p.y = Math.min(Math.max(60, p.y), h - fw - 6);
    // ما منغطّي شريط المجموع والحفظ تحت الفاتورة: منطلع فوقه
    let y = p.y;
    const bar = document.querySelector('.inv-bar');
    if (bar && !root.closest('dialog')) { const r = bar.getBoundingClientRect(); if (r.height && y + fw > r.top - 6 && y < r.bottom) y = Math.max(60, r.top - fw - 10); }
    fab.style.left = p.x + 'px'; fab.style.top = y + 'px'; p = { x: p.x, y };
    const box = $c('#calcBox'); if (box.hidden) return;
    const bw = Math.min(300, w - 12), bh = box.offsetHeight || 420;
    let bx = p.x + fw / 2 - bw / 2, by = p.y - bh - 8;
    if (by < 8) by = Math.min(p.y + fw + 8, h - bh - 8);
    bx = Math.min(Math.max(6, bx), w - bw - 6);
    box.style.width = bw + 'px'; box.style.left = bx + 'px'; box.style.top = Math.max(6, by) + 'px';
  }
  let drag = null;
  fab.addEventListener('pointerdown', e => { drag = { sx: e.clientX, sy: e.clientY, x: fab.offsetLeft, y: fab.offsetTop, moved: false }; fab.setPointerCapture(e.pointerId); });
  fab.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 8) return;
    drag.moved = true; pos = { x: drag.x + dx, y: drag.y + dy }; place();
  });
  fab.addEventListener('pointerup', () => {
    if (!drag) return;
    const moved = drag.moved; drag = null;
    if (moved) { try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (e) { /* */ } }
    else open($c('#calcBox').hidden);
  });
  fab.addEventListener('pointercancel', () => { drag = null; });
  // ما منخلّي الكبس على الحاسبة يسرق الكتابة من الخانة
  root.addEventListener('pointerdown', e => { if (e.target.closest('#calcBox button')) e.preventDefault(); });
  root.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); });
  addEventListener('resize', place);
  addEventListener('hashchange', () => setTimeout(place, 120));
  let raf = 0; addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; place(); }); }, { passive: true });

  // النوافذ (dialog) بتطلع فوق كل شي — منحط الحاسبة جوّاها وهي مفتوحة
  const home = () => { const d = document.querySelector('dialog[open]'); const want = d || document.body; if (root.parentNode !== want) { want.appendChild(root); place(); } };
  new MutationObserver(home).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });

  document.body.appendChild(root); place();
})();
