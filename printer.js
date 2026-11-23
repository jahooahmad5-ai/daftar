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
    // الترتيب حسب التاريخ ثم وقت الإنشاء (مو حسب ترتيب القيود)
    const cr = e => { const d = e.src === 'invoice' ? db.invoices.find(x => x.id === e.ref) : e.src === 'voucher' ? db.vouchers.find(x => x.id === e.ref) : null; return d ? num(d.created) : 0; };
    const me = [inv.date, num(inv.created)];
    let before = 0, eff = 0;
    for (const e of engine().entries) {
      const d = e.lines.filter(l => l.acc === a.id).reduce((s, l) => s + (l.dr - l.cr) * sign, 0);
      if (!d) continue;
      if (e.id === 'inv-' + inv.id || links.has(e.id)) { eff += d; continue; }
      if (e.date < me[0] || (e.date === me[0] && cr(e) < me[1])) before += d;
    }
    return { before: r2(before), after: r2(before + eff), now: r2(partyBal(a)) };
  }
  const paidFor = inv => db.vouchers.filter(v => v.inv === inv.id).reduce((s, v) => s + num(v.amount), 0);

  function build(inv) {
    const s = db.settings, t = invTotals(inv), sym = docSym(inv), a = acc(inv.party);
    // سعر المستهلك: من سطر الفاتورة، وإذا فاضي من بطاقة المادة
    const cpOf = l => num(l.cp) || num((db.items.find(x => x.id === l.item) || {}).consumerPrice);
    const hasCp = db.settings.receiptCp !== '0';
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
    if (inv.rep) txt(`المندوب: ${inv.rep}`, { size: 22, bold: 1, align: 'c' });
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
      if (hasCp) r.push(cpOf(l) ? fmt(cpOf(l)) : '');
      r.push(fmt(num(l.qty) * num(l.price)));
      return r;
    });
    ops.push({ k: 'table', cols, rows, size: hasCp ? 20 : 22 });
    txt(`مجموع الكميات ${fmt(inv.lines.reduce((x, l) => x + num(l.qty), 0))}`, { size: 22 });
    line();
    // الحسابات بالترتيب: مجموع الفاتورة ← الحساب القديم ← كامل الحساب ← الدفعة ← رصيد الحساب الحالي
    const k = docRate(inv), netB = r2(t.net * k), sgn = ['sale', 'purchase'].includes(inv.type) ? 1 : -1;
    const paidB = inv.pay === 'cash' ? netB : paidFor(inv);
    // بوضع البيّاع ما منطلّع حساب الزبون (القديم والرصيد) بالإيصال
    const B = typeof isSeller === 'function' && isSeller() ? null : balances(inv);
    // رمز العملة (ل.س) مع المبالغ: براس العمودين إذا في جديد وقديم، وإلا جنب كل مبلغ
    const cs = db.settings.currency || 'ل.س';
    const row = (label, v, o = {}) => ops.push({ k: 'tri', l: label, m: oldOn() ? fmt(v) : `${fmt(v)} ${cs}`, r: oldOn() ? oldAmt(v) : '', ...o });
    if (t.disc || t.add) {
      txt(`الإجمالي ${fmt(t.gross)}${t.disc ? ` — حسم ${fmt(t.disc)}` : ''}${t.add ? ` — إضافة ${fmt(t.add)}` : ''}${inv.addNote ? ` (${inv.addNote})` : ''}`, { size: 20 });
    }
    if (oldOn()) ops.push({ k: 'tri', l: '', m: `جديد ${cs}`, r: `قديم ${cs}`, size: 20, head: 1 });
    row('مجموع الفاتورة', netB, { size: 24, bold: 1 });
    if (inv.cur === 'fx') txt(`(${fmt(t.net)} ${FX().sym} × ${fmt(inv.rate)})`, { size: 20 });
    if (B) {
      const kamel = r2(B.after + paidB * sgn);
      row('الحساب القديم', B.before, { size: 23 });
      row('كامل الحساب', kamel, { size: 24, bold: 1 });
      row('الدفعة', paidB, { size: 23 });
      ops.push({ k: 'hr' });
      row('رصيد الحساب الحالي', B.after, { size: 26, bold: 1, box: 1 });
    } else {
      row('الدفعة', paidB, { size: 23 });
    }
    line();
    if (s.phone) txt(`عند وجود أي استفسار يرجى التواصل مع هذا الرقم: ${s.phone}`, { size: 20, align: 'c' });
    if (s.receiptFooter) { gap(8); txt(s.receiptFooter, { size: 22, bold: 1, align: 'c' }); }
    // ختم الشركة بآخر الفاتورة (كأنها مختومة)
    if (s.receiptStamp !== '0' && s.company && s.company !== 'اسم المنشأة') { gap(14); ops.push({ k: 'stamp', name: s.company, lines: String(s.receiptHeader || s.address || '').split(/\n/).map(t => t.trim()).filter(Boolean).slice(0, 4) }); }
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

  // ختم: إطار مزدوج بزوايا مدوّرة ومايل شوي، وجواته اسم الشركة وسطور الختم
  function drawStamp(x, o, W, y, h, k) {
    const nameF = `bold ${Math.round(27 * k)}px ${FONT}`, lineF = `bold ${Math.round(18 * k)}px ${FONT}`;
    x.save(); x.direction = 'rtl'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = nameF; let tw = x.measureText(o.name).width;
    x.font = lineF; o.lines.forEach(t => { tw = Math.max(tw, x.measureText(t).width); });
    const bw = Math.min(W * 0.72, tw + 56 * k), bh = h - 60, cx = W / 2, cy = y + h / 2;
    x.translate(cx, cy); x.rotate(-0.09); // مايل شوي متل الختم الحقيقي
    const rr = (w, hh, r) => { x.beginPath(); x.moveTo(-w / 2 + r, -hh / 2); x.arcTo(w / 2, -hh / 2, w / 2, hh / 2, r); x.arcTo(w / 2, hh / 2, -w / 2, hh / 2, r); x.arcTo(-w / 2, hh / 2, -w / 2, -hh / 2, r); x.arcTo(-w / 2, -hh / 2, w / 2, -hh / 2, r); x.closePath(); x.stroke(); };
    x.strokeStyle = '#000'; x.fillStyle = '#000';
    x.lineWidth = 3; rr(bw, bh, 18 * k);
    x.lineWidth = 2; rr(bw - 12 * k, bh - 12 * k, 13 * k);
    const lh = 26 * k; let ty = -bh / 2 + 12 * k + 20 * k;
    x.font = nameF; x.fillText(o.name, 0, ty); ty += 19 * k;
    x.fillRect(-bw / 2 + 30 * k, ty, bw - 60 * k, 2); ty += 4 * k + lh / 2;
    o.lines.forEach(t => {
      let fs = Math.round(18 * k); x.font = `bold ${fs}px ${FONT}`;
      while (fs > 12 && x.measureText(t).width > bw - 40 * k) { fs--; x.font = `bold ${fs}px ${FONT}`; }
      x.fillText(t, 0, ty); ty += lh;
    });
    x.restore();
  }

  function render(ops) {
    const W = paperW(), P = 8, c = document.createElement('canvas'), x = c.getContext('2d');
    const scale = W / 576;
    const font = o => `${o.bold ? 'bold ' : ''}${Math.round((o.size || 24) * (W < 576 ? 0.82 : 1))}px ${FONT}`;
    const wrap = (text, o, max) => {
      x.font = font(o); const out = []; let cur = '';
      // كل سطر مكتوب لحاله (Enter) بيطلع سطر لحاله بالإيصال
      String(text).split(/\n/).forEach((para, pi) => {
        if (pi) { out.push(cur); cur = ''; }
        for (const w of para.trim().split(/\s+/)) { if (!w) continue; const tr = cur ? cur + ' ' + w : w; if (x.measureText(tr).width > max && cur) { out.push(cur); cur = w; } else cur = tr; }
      });
      out.push(cur); return out;
    };
    let H = P; const plan = [];
    for (const o of ops) {
      const sz = (o.size || 24) * (W < 576 ? 0.82 : 1), lh = Math.round(sz * 1.45);
      if (o.k === 't') { const ls = wrap(o.text, o, W - 2 * P); plan.push({ o, ls, y: H, lh }); H += ls.length * lh; }
      else if (o.k === 'p') { plan.push({ o, y: H, lh }); H += lh; }
      else if (o.k === 'tri') { plan.push({ o, y: H, lh }); H += lh + (o.box ? 14 : 2); }
      else if (o.k === 'hr') { plan.push({ o, y: H }); H += 18; }
      else if (o.k === 'img') { const h = Math.round(o.h * scale), w = Math.round(o.img.width * h / o.img.height); plan.push({ o, y: H, h, w: Math.min(w, W - 2 * P) }); H += h + 8; }
      else if (o.k === 'tri') {
        const yy = y + (o.box ? 6 : 0);
        if (o.box) { x.lineWidth = 2; x.strokeRect(P, y, W - 2 * P, lh + 10); }
        x.textAlign = 'right'; x.fillText(o.l, W - P - (o.box ? 6 : 0), yy);
        if (o.r) { x.textAlign = 'center'; x.fillText(o.m, W * 0.36, yy); x.fillText(o.r, W * 0.13, yy); }
        else { x.textAlign = 'left'; x.fillText(o.m, P + (o.box ? 6 : 0), yy); }
        if (o.head) { x.fillRect(P, yy + lh - 4, W - 2 * P, 1); }
      }
      else if (o.k === 'box') { plan.push({ o, y: H, lh }); H += lh + 16; }
      else if (o.k === 'stamp') { const k = W < 576 ? 0.82 : 1, h = Math.round((70 + o.lines.length * 26) * k) + 80; plan.push({ o, y: H, h, k }); H += h + 10; }
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
      if (o.k === 'stamp') { drawStamp(x, o, W, y, pl.h, pl.k); continue; }
      x.font = font(o); x.direction = 'rtl';
      if (o.k === 't') pl.ls.forEach((s, i) => { x.textAlign = o.align === 'c' ? 'center' : 'right'; x.fillText(s, o.align === 'c' ? W / 2 : W - P, y + i * lh); });
      else if (o.k === 'p') { x.textAlign = 'right'; x.fillText(o.l, W - P, y); x.textAlign = 'left'; x.fillText(o.r, P, y); }
      else if (o.k === 'tri') {
        const yy = y + (o.box ? 6 : 0);
        if (o.box) { x.lineWidth = 2; x.strokeRect(P, y, W - 2 * P, lh + 10); }
        x.textAlign = 'right'; x.fillText(o.l, W - P - (o.box ? 6 : 0), yy);
        if (o.r) { x.textAlign = 'center'; x.fillText(o.m, W * 0.36, yy); x.fillText(o.r, W * 0.13, yy); }
        else { x.textAlign = 'left'; x.fillText(o.m, P + (o.box ? 6 : 0), yy); }
        if (o.head) { x.fillRect(P, yy + lh - 4, W - 2 * P, 1); }
      }
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
  const wait = (p, ms) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error('timeout')), ms))]);
  let lastInfo = '';
  // الطابعة اللي سبق وأعطاها Chrome الإذن (بيحتاج إعداد web-bluetooth-new-permissions-backend)
  async function remembered() {
    if (!navigator.bluetooth || !navigator.bluetooth.getDevices) { lastInfo = 'nogd'; return null; }
    const id = localStorage.getItem('daftar-printer'), nm = localStorage.getItem('daftar-printer-name');
    try {
      const list = await navigator.bluetooth.getDevices();
      lastInfo = 'gd' + list.length;
      return list.find(d => d.id === id) || (nm && list.find(d => d.name === nm)) || list.find(d => /^XP/i.test(d.name || '')) || null;
    } catch (e) { lastInfo = 'gderr'; return null; }
  }
  // اتصال بالطابعة المعروفة بدون نافذة: محاولة مباشرة، وإذا ما زبط منستنى إشارتها (watchAdvertisements)
  async function quiet(d, ms, watch = true) {
    try { ch = await findChar(await wait(d.gatt.connect(), ms)); dev = d; return true; } catch (e) { /* */ }
    if (watch && d.watchAdvertisements) {
      try {
        const seen = new Promise(r => d.addEventListener('advertisementreceived', r, { once: true }));
        await d.watchAdvertisements();
        await wait(seen, ms);
        ch = await findChar(await wait(d.gatt.connect(), ms)); dev = d; return true;
      } catch (e) { /* */ }
    }
    ch = null; return false;
  }
  let warming = null;
  // بنتصل بالطابعة من قبل ما تكبس طباعة، حتى الكبسة تطبع دغري
  function warm() {
    if (ready() || warming || !localStorage.getItem('daftar-printer')) return warming;
    warming = (async () => { const d = dev || await remembered(); if (d) await quiet(d, 6000); warming = null; pill(); })();
    return warming;
  }
  const ready = () => !!(ch && dev && dev.gatt.connected);
  function pill() {
    const el = document.getElementById('prnPill'); if (!el) return;
    const known = !!localStorage.getItem('daftar-printer');
    el.textContent = ready() ? '🟢 الطابعة متصلة' : !navigator.bluetooth ? '' : !known ? '⚪ ما في طابعة محفوظة' : lastInfo === 'nogd' ? '🟡 بدها اختيار كل مرة (الإعداد ما اشتغل)' : lastInfo === 'gd0' ? '🟡 Chrome ما حفظ الإذن' : '⚪ الطابعة مو متصلة';
  }
  async function connect(pick) {
    if (!pick && ready()) return ch;
    if (!pick && warming) { await warming; if (ready()) return ch; }
    // ضمن نفس الجلسة: الطابعة معروفة، منرجع نتصل فيها بسرعة
    if (!pick && dev && await quiet(dev, 2500, false)) return ch;
    const nm = localStorage.getItem('daftar-printer-name');
    const opts = !pick && nm ? { filters: [{ name: nm }], optionalServices: SERVICES } : { acceptAllDevices: true, optionalServices: SERVICES };
    dev = await navigator.bluetooth.requestDevice(opts);
    localStorage.setItem('daftar-printer', dev.id);
    if (dev.name) localStorage.setItem('daftar-printer-name', dev.name);
    const server = await dev.gatt.connect();
    ch = await findChar(server);
    dev.addEventListener('gattserverdisconnected', () => { ch = null; pill(); });
    pill();
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

  /* ---------- PDF: صفحة وحدة بعرض ورق الإيصال، فيها صورة الإيصال (بلا مكتبات وبيشتغل بلا نت) ---------- */
  function pdfBlob(canvas) {
    const mm = String(db.settings.paperWidth) === '58' ? 58 : 80;
    const W = mm * 72 / 25.4, H = W * canvas.height / canvas.width; // بالنقاط
    // خلفية بيضا (الـ JPEG ما بيدعم الشفافية)
    const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(canvas, 0, 0);
    const b64 = c.toDataURL('image/jpeg', 0.92).split(',')[1], bin = atob(b64);
    const img = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) img[i] = bin.charCodeAt(i);
    const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
    const add = d => { const u = typeof d === 'string' ? enc.encode(d) : d; parts.push(u); len += u.length; };
    const obj = (n, body, stream) => {
      offs[n] = len; add(`${n} 0 obj\n${body}\n`);
      if (stream) { add('stream\n'); add(stream); add('\nendstream\n'); }
      add('endobj\n');
    };
    const f = v => v.toFixed(2);
    const content = `q ${f(W)} 0 0 ${f(H)} 0 0 cm /Im0 Do Q`;
    add('%PDF-1.4\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(W)} ${f(H)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
    obj(4, `<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>`, img);
    obj(5, `<< /Length ${content.length} >>`, content);
    const xref = len;
    add(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map(n => String(offs[n]).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(parts, { type: 'application/pdf' });
  }
  async function shareFile(blob, name) {
    const f = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f] }); } catch (e) { /* انلغت */ } return; }
    const u = URL.createObjectURL(blob), el = document.createElement('a'); el.href = u; el.download = name; el.click(); setTimeout(() => URL.revokeObjectURL(u), 3000);
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
        <button type="button" class="btn" id="rcPdf">📄 مشاركة PDF</button>
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
        msg.textContent = '✅ انطبع'; toast('✅ انطبعت الفاتورة رقم ' + inv.no);
        // بعد الطباعة منرجع لقائمة الفواتير
        setTimeout(() => { try { d.close(); } catch (e2) { /* */ } location.hash = '#/invoices'; }, 600);
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
    $('#rcPdf', d).onclick = () => { try { shareFile(pdfBlob(canvas), `فاتورة-${inv.no}.pdf`); } catch (e) { toast('ما زبط الـ PDF: ' + (e && e.message || e), 1); } };
    $('#rcShare', d).onclick = () => canvas.toBlob(async blob => {
      const f = new File([blob], `فاتورة-${inv.no}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f] }); } catch (e) {} }
      else { const u = URL.createObjectURL(blob), el = document.createElement('a'); el.href = u; el.download = f.name; el.click(); setTimeout(() => URL.revokeObjectURL(u), 3000); }
    }, 'image/png');
  }
  /* ---------- طباعة مباشرة مع الحفظ (بلوتوث من المتصفح) ---------- */
  async function printDirect(inv) {
    if (!navigator.bluetooth) { toast('المتصفح ما بيدعم البلوتوث — اختار طريقة طباعة', 1); return open(inv); }
    try {
      toast('🔵 عم يتصل بالطابعة…');
      const conn = connect(false); // لازم يبلّش فوراً مع الكبسة حتى يقبل المتصفح يفتح قائمة الطابعات
      conn.catch(() => {});
      await loadLogo();
      const canvas = build(inv);
      await conn;
      await send(escpos(canvas), p => toast(`🖨 عم يطبع… ${Math.round(p * 100)}%`));
      toast('✅ انحفظت وانطبعت الفاتورة رقم ' + inv.no);
      location.hash = '#/'; // بعد الطباعة منرجع عالرئيسية
    } catch (e) {
      ch = null;
      if (e && e.name === 'NotFoundError') toast('ما اخترت طابعة — الفاتورة محفوظة', 1);
      else { toast('❌ ما زبطت الطباعة بالبلوتوث — الفاتورة محفوظة، جرّب طريقة تانية', 1); open(inv); }
    }
  }
  return { open, pdfBlob, printDirect, warm, pill, build: inv => build(inv), escpos, loadLogo, balances };
})();
window.Receipt = Receipt;
