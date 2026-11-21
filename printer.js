/* طباعة إيصال حراري (58/80 مم) عبر البلوتوث مباشرة من المتصفح
   يرسم الإيصال كصورة (لدعم العربي) ثم يرسلها للطابعة بأوامر ESC/POS */
'use strict';
const Receipt = (() => {
  const SERVICES = [
    '000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    '49535343-fe7d-4ae5-8fa9-9fafd205e455', '0000ff00-0000-1000-8000-00805f9b34fb',
    '0000ffe0-0000-1000-8000-00805f9b34fb', '0000fee7-0000-1000-8000-00805f9b34fb',
    '0000ae30-0000-1000-8000-00805f9b34fb', '0000ae3a-0000-1000-8000-00805f9b34fb',
    '0000ff12-0000-1000-8000-00805f9b34fb', '0000fff0-0000-1000-8000-00805f9b34fb',
    '0000ff80-0000-1000-8000-00805f9b34fb',
  ];
  const FONT = 'Tahoma,"Noto Sans Arabic","Noto Kufi Arabic",Arial,sans-serif';
  let dev = null, ch = null, chunk = 180;

  const paperW = () => (String(db.settings.paperWidth) === '58' ? 384 : 576);

  /* ---------- رسم الإيصال ---------- */
  // أرصدة الزبون: قبل الفاتورة، بعدها، وهلق
  function balances(inv) {
    const a = acc(inv.party); if (!a) return null;
    const sign = a.type === 'asset' ? 1 : -1;
    const links = new Set(db.vouchers.filter(v => v.inv === inv.id).map(v => 'v-' + v.id));
    let run = 0, before = null, eff = 0;
    for (const e of engine().entries) {
      const d = e.lines.filter(l => l.acc === a.id).reduce((s, l) => s + (l.dr - l.cr) * sign, 0);
      if (e.id === 'inv-' + inv.id) { before = run; eff += d; continue; }
      if (links.has(e.id)) { eff += d; continue; }
      run += d;
    }
    if (before === null) before = run;
    return { before: r2(before), after: r2(before + eff), now: r2(partyBal(a)) };
  }
  const paidFor = inv => db.vouchers.filter(v => v.inv === inv.id).reduce((s, v) => s + num(v.amount), 0);

  function build(inv) {
    const s = db.settings, t = invTotals(inv), sym = docSym(inv), a = acc(inv.party);
    const hasCp = inv.lines.some(l => num(l.cp));
    const ops = [];
    const txt = (text, o = {}) => ops.push({ k: 't', text: String(text ?? ''), ...o });
    const pair = (l, r, o = {}) => ops.push({ k: 'p', l: String(l), r: String(r), ...o });
    const line = () => ops.push({ k: 'hr' });
    const gap = h => ops.push({ k: 'gap', h });
    const kindTxt = { sale: 'مبيع', purchase: 'شراء', saleReturn: 'مرتجع مبيع', purchaseReturn: 'مرتجع شراء' }[inv.type] || '';
    const tm = inv.created ? new Date(inv.created) : null;

    if (logoImg) ops.push({ k: 'img', img: logoImg, h: 130 });
    txt(s.company, { size: 30, bold: 1, align: 'c' });
    if (s.receiptHeader) txt(s.receiptHeader, { size: 20, align: 'c' });
    if (s.address) txt(s.address, { size: 20, align: 'c' });
    line();
    txt(`${kindTxt} - ${inv.pay === 'cash' ? 'نقدي' : 'آجل'}`, { size: 26, bold: 1, align: 'c' });
    line();
    txt(`رقم الفاتورة ${inv.no}`, { size: 26, bold: 1, align: 'c' });
    txt(`تاريخ الفاتورة: ${inv.date}`, { size: 22 });
    if (tm) txt(`وقت الفاتورة: ${tm.toTimeString().slice(0, 8)}`, { size: 22 });
    line();
    txt(`${['sale', 'saleReturn'].includes(inv.type) ? 'السيد' : 'المورد'} : ${a ? a.name : 'زبون عام'}`, { size: 26, bold: 1, align: 'c' });
    gap(6);
    const cols = hasCp
      ? [{ h: 'اسم المادة', w: 0.36 }, { h: 'العدد', w: 0.1 }, { h: 'الإفرادي', w: 0.18 }, { h: 'المستهلك', w: 0.17 }, { h: 'الإجمالي', w: 0.19 }]
      : [{ h: 'اسم المادة', w: 0.42 }, { h: 'العدد', w: 0.12 }, { h: 'الإفرادي', w: 0.22 }, { h: 'الإجمالي', w: 0.24 }];
    const rows = inv.lines.map(l => {
      const it = db.items.find(x => x.id === l.item) || {};
      const r = [it.name || '', fmt(l.qty), fmt(l.price)];
      if (hasCp) r.push(num(l.cp) ? fmt(l.cp) : '');
      r.push(fmt(num(l.qty) * num(l.price)));
      return r;
    });
    ops.push({ k: 'table', cols, rows, size: hasCp ? 20 : 22 });
    txt(`مجموع الكميات ${fmt(inv.lines.reduce((x, l) => x + num(l.qty), 0))}`, { size: 22 });
    line();
    txt(`مجموع الفاتورة ${fmt(t.gross)}`, { size: 24, bold: 1 });
    const paid = paidFor(inv);
    pair(`دفعة نقدية ${fmt(inv.pay === 'cash' ? t.net : paid)}`, `الخصم/الإضافة ${fmt(t.disc ? -t.disc : 0)}`, { size: 21, swap: 1 });
    gap(4);
    txt('المبلغ المستحق', { size: 24, bold: 1, align: 'c' });
    ops.push({ k: 'box', text: `${fmt(t.net)} ${inv.cur === 'fx' ? FX().name : (s.currencyName || cur())}`, size: 28 });
    if (inv.cur === 'fx') txt(`المعادل: ${fmt(t.net * num(inv.rate))} ${cur()}`, { size: 20, align: 'c' });
    else if (oldOn()) txt(`بالقديم: ${oldAmt(t.net)}`, { size: 20, align: 'c' });
    const B = balances(inv);
    gap(4);
    pair('رصيده قبل الفاتورة', fmt(B ? B.before : 0), { size: 22 });
    pair('رصيده بعد الفاتورة', fmt(B ? B.after : 0), { size: 22 });
    pair('رصيد الحساب الحالي', fmt(B ? B.now : 0), { size: 22 });
    line();
    if (s.phone) txt(`عند وجود أي استفسار يرجى التواصل مع هذا الرقم: ${s.phone}`, { size: 20, align: 'c' });
    if (s.receiptFooter) { gap(8); txt(s.receiptFooter, { size: 22, bold: 1, align: 'c' }); }
    gap(10);
    const now = new Date();
    txt(`تاريخ الطباعة ${today()} ${now.toTimeString().slice(0, 8)}`, { size: 18, align: 'c' });
    gap(30);
    return render(ops);
  }

  // الشعار (من الإعدادات) يتحمّل مرة وحدة
  let logoImg = null, logoSrc = '';
  function loadLogo() {
    const src = db.settings.logo || '';
    if (src === logoSrc) return Promise.resolve();
    logoSrc = src; logoImg = null;
    if (!src) return Promise.resolve();
    return new Promise(ok => { const im = new Image(); im.onload = () => { logoImg = im; ok(); }; im.onerror = ok; im.src = src; });
  }

  function render(ops) {
    const W = paperW(), P = 8, c = document.createElement('canvas'), x = c.getContext('2d');
    const scale = W / 576;
    const font = o => `${o.bold ? 'bold ' : ''}${Math.round((o.size || 24) * (W < 576 ? 0.82 : 1))}px ${FONT}`;
    const wrap = (text, o, max) => {
      x.font = font(o); const out = []; let cur = '';
      for (const w of String(text).split(/\s+/)) { const tr = cur ? cur + ' ' + w : w; if (x.measureText(tr).width > max && cur) { out.push(cur); cur = w; } else cur = tr; }
      out.push(cur); return out;
    };
    let H = P; const plan = [];
    for (const o of ops) {
      const sz = (o.size || 24) * (W < 576 ? 0.82 : 1), lh = Math.round(sz * 1.45);
      if (o.k === 't') { const ls = wrap(o.text, o, W - 2 * P); plan.push({ o, ls, y: H, lh }); H += ls.length * lh; }
      else if (o.k === 'p') { plan.push({ o, y: H, lh }); H += lh; }
      else if (o.k === 'hr') { plan.push({ o, y: H }); H += 18; }
      else if (o.k === 'img') { const h = Math.round(o.h * scale), w = Math.round(o.img.width * h / o.img.height); plan.push({ o, y: H, h, w: Math.min(w, W - 2 * P) }); H += h + 8; }
      else if (o.k === 'box') { plan.push({ o, y: H, lh }); H += lh + 16; }
      else if (o.k === 'table') {
        const tw = W - 2 * P, cw = o.cols.map(cl => cl.w * tw), pad = 5;
        const rowsL = [o.cols.map(cl => [cl.h]), ...o.rows.map(r => r.map((v, i) => (i === 0 ? wrap(v, o, cw[i] - 2 * pad) : [v])))];
        const hs = rowsL.map(r => Math.max(...r.map(ls => ls.length)) * lh + 8);
        plan.push({ o, y: H, lh, cw, rowsL, hs, pad }); H += hs.reduce((a, b) => a + b, 0) + 6;
      } else H += o.h;
    }
    c.width = W; c.height = H + P;
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, c.height); x.fillStyle = '#000'; x.strokeStyle = '#000'; x.textBaseline = 'top';
    for (const pl of plan) {
      const { o, y, lh } = pl;
      if (o.k === 'hr') { x.fillRect(P, y + 8, W - 2 * P, 2); continue; }
      if (o.k === 'img') { x.drawImage(o.img, (W - pl.w) / 2, y, pl.w, pl.h); continue; }
      x.font = font(o); x.direction = 'rtl';
      if (o.k === 't') pl.ls.forEach((s, i) => { x.textAlign = o.align === 'c' ? 'center' : 'right'; x.fillText(s, o.align === 'c' ? W / 2 : W - P, y + i * lh); });
      else if (o.k === 'p') { x.textAlign = 'right'; x.fillText(o.l, W - P, y); x.textAlign = 'left'; x.fillText(o.r, P, y); }
      else if (o.k === 'box') { x.lineWidth = 2; x.strokeRect(P, y, W - 2 * P, lh + 10); x.textAlign = 'center'; x.fillText(o.text, W / 2, y + 6); }
      else if (o.k === 'table') {
        x.lineWidth = 2; let yy = y;
        pl.rowsL.forEach((r, ri) => {
          const h = pl.hs[ri]; let xr = W - P;
          if (ri === 0) { x.fillStyle = '#e8e8e8'; x.fillRect(P, yy, W - 2 * P, h); x.fillStyle = '#000'; }
          r.forEach((ls, ci) => {
            const w = pl.cw[ci];
            x.strokeRect(xr - w, yy, w, h);
            x.font = font({ ...o, bold: ri === 0 || ci === 0 ? 0 : 0 });
            ls.forEach((s, li) => {
              if (ci === 0 && ri > 0) { x.textAlign = 'right'; x.fillText(s, xr - pl.pad, yy + 4 + li * lh); }
              else { x.textAlign = 'center'; x.fillText(s, xr - w / 2, yy + 4 + li * lh); }
            });
            xr -= w;
          });
          yy += h;
        });
      }
    }
    return c;
  }

  /* ---------- تحويل لأوامر ESC/POS ---------- */
  function escpos(c) {
    const W = c.width, H = c.height, bw = W / 8, px = c.getContext('2d').getImageData(0, 0, W, H).data;
    const parts = [new Uint8Array([0x1b, 0x40])];
    const BAND = 128;
    for (let y0 = 0; y0 < H; y0 += BAND) {
      const h = Math.min(BAND, H - y0), buf = new Uint8Array(8 + bw * h);
      buf.set([0x1d, 0x76, 0x30, 0x00, bw & 255, bw >> 8, h & 255, h >> 8]);
      for (let y = 0; y < h; y++) for (let xx = 0; xx < W; xx++) {
        const i = ((y0 + y) * W + xx) * 4, lum = px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11;
        if (lum < 150) buf[8 + y * bw + (xx >> 3)] |= 0x80 >> (xx & 7);
      }
      parts.push(buf);
    }
    parts.push(new Uint8Array([0x1b, 0x64, 0x03]));
    const n = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(n);
    let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; });
    return out;
  }

  /* ---------- البلوتوث ---------- */
  async function findChar(server) {
    const svcs = await server.getPrimaryServices();
    for (const sv of svcs) {
      for (const c of await sv.getCharacteristics()) if (c.properties.writeWithoutResponse || c.properties.write) return c;
    }
    throw new Error('ما لقيت قناة كتابة بالطابعة');
  }
  async function connect(pick) {
    if (ch && dev && dev.gatt.connected) return ch;
    if (!dev && !pick && navigator.bluetooth.getDevices) {
      const id = localStorage.getItem('daftar-printer');
      const list = await navigator.bluetooth.getDevices();
      dev = list.find(d => d.id === id) || null;
    }
    if (!dev || pick) {
      dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
      localStorage.setItem('daftar-printer', dev.id);
    }
    const server = await dev.gatt.connect();
    ch = await findChar(server);
    return ch;
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function send(data, onProg) {
    const c = ch, noResp = c.properties.writeWithoutResponse && c.writeValueWithoutResponse;
    for (let i = 0; i < data.length;) {
      const part = data.slice(i, i + chunk);
      try {
        if (noResp) await c.writeValueWithoutResponse(part); else await c.writeValue(part);
      } catch (e) {
        if (chunk > 20) { chunk = 20; continue; }
        throw e;
      }
      i += part.length;
      if (noResp) await sleep(12);
      onProg && onProg(i / data.length);
    }
  }

  /* ---------- RawBT (تطبيق أندرويد وسيط للطابعات الحرارية) ---------- */
  function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  function rawbt(canvas) {
    const data = b64(escpos(canvas));
    location.href = 'intent:base64,' + data + '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;';
  }
  /* ---------- طباعة النظام (خدمة طباعة أندرويد) بمقاس الإيصال ---------- */
  function sysPrint(canvas) {
    const mm = String(db.settings.paperWidth) === '58' ? 58 : 80;
    const st = document.createElement('style');
    st.textContent = `@media print{@page{size:${mm}mm auto;margin:0}.pdoc-rc{width:${mm}mm}.pdoc-rc img{width:100%;display:block}}`;
    document.head.appendChild(st);
    $('#print').innerHTML = `<div class="pdoc-rc"><img src="${canvas.toDataURL('image/png')}"></div>`;
    const done = () => { st.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 150);
  }

  /* ---------- الواجهة ---------- */
  async function open(inv) {
    await loadLogo();
    const canvas = build(inv);
    const hasBT = !!(navigator.bluetooth);
    modal('🧾 إيصال حراري', `
      <div class="rc-prev"></div>
      <div class="rc-ways">
        <button type="button" class="btn pri" id="rcRaw">📲 طباعة عبر تطبيق RawBT <small>(الأضمن)</small></button>
        ${hasBT ? '<button type="button" class="btn" id="rcBt">🔵 بلوتوث مباشر من المتصفح</button>' : ''}
        <button type="button" class="btn" id="rcSys">🖨 طباعة أندرويد</button>
        <button type="button" class="btn" id="rcShare">📤 مشاركة كصورة</button>
        ${hasBT ? '<button type="button" class="btn" id="rcPick" style="font-size:13px">🔄 اختيار طابعة بلوتوث تانية</button>' : ''}
      </div>
      <p class="muted" id="rcMsg" style="margin:8px 0 0">أول مرة: نزّل تطبيق <b>RawBT</b> من Play Store، افتحه واختار طابعتك من الإعدادات، بعدها ارجع واضغط «طباعة عبر RawBT».</p>`);
    const d = $('#dlg'), msg = $('#rcMsg', d);
    canvas.style.cssText = 'width:100%;max-width:320px;display:block;margin:auto;border:1px solid #ddd';
    $('.rc-prev', d).appendChild(canvas);
    const go = async pick => {
      const btns = $$('#rcBt,#rcPick', d); btns.forEach(b => (b.disabled = true));
      try {
        msg.textContent = 'عم يتصل بالطابعة…';
        await connect(pick);
        msg.textContent = 'عم يطبع… 0%';
        await send(escpos(canvas), p => (msg.textContent = `عم يطبع… ${Math.round(p * 100)}%`));
        msg.textContent = '✅ انطبع'; toast('تمت الطباعة');
      } catch (e) {
        if (e && e.name === 'NotFoundError') msg.textContent = 'ما اخترت طابعة.';
        else { msg.textContent = '❌ ما زبطت الطباعة: ' + (e && e.message || e); ch = null; }
      }
      btns.forEach(b => (b.disabled = false));
    };
    $('#rcRaw', d).onclick = () => { msg.textContent = 'عم يفتح RawBT… إذا ما انفتح، تأكد إنه منزّل.'; rawbt(canvas); };
    $('#rcSys', d).onclick = () => sysPrint(canvas);
    const bt = $('#rcBt', d); if (bt) bt.onclick = () => go(false);
    const pk = $('#rcPick', d); if (pk) pk.onclick = () => { dev = null; ch = null; go(true); };
    $('#rcShare', d).onclick = () => canvas.toBlob(async blob => {
      const f = new File([blob], `فاتورة-${inv.no}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f] }); } catch (e) {} }
      else { const u = URL.createObjectURL(blob), el = document.createElement('a'); el.href = u; el.download = f.name; el.click(); setTimeout(() => URL.revokeObjectURL(u), 3000); }
    }, 'image/png');
  }
  return { open, build: inv => build(inv), escpos, loadLogo };
})();
window.Receipt = Receipt;
