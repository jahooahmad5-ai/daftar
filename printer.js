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
  function build(inv) {
    const s = db.settings, t = invTotals(inv), sym = docSym(inv), a = acc(inv.party);
    const ops = [];
    const txt = (text, o = {}) => ops.push({ k: 't', text: String(text ?? ''), ...o });
    const pair = (l, r, o = {}) => ops.push({ k: 'p', l: String(l), r: String(r), ...o });
    const line = () => ops.push({ k: 'hr' });
    const gap = h => ops.push({ k: 'gap', h });

    txt(s.company, { size: 34, bold: 1, align: 'c' });
    if (s.address) txt(s.address, { size: 22, align: 'c' });
    if (s.phone) txt('هاتف: ' + s.phone, { size: 22, align: 'c' });
    line();
    txt(`${INV_TYPES[inv.type]} رقم ${inv.no}`, { size: 28, bold: 1, align: 'c' });
    pair('التاريخ', inv.date);
    if (a) pair(['sale', 'saleReturn'].includes(inv.type) ? 'العميل' : 'المورد', a.name);
    pair('الدفع', inv.pay === 'cash' ? 'نقدي' : 'آجل');
    line();
    inv.lines.forEach(l => {
      const it = db.items.find(x => x.id === l.item) || {};
      txt(it.name || '', { size: 25, bold: 1 });
      pair(`${fmt(l.qty)} × ${fmt(l.price)}`, fmt(num(l.qty) * num(l.price)), { size: 24 });
      if (num(l.cp)) pair('سعر المستهلك', fmt(l.cp), { size: 20 });
      gap(4);
    });
    line();
    if (t.disc) { pair('الإجمالي', fmt(t.gross)); pair('الحسم', fmt(t.disc)); }
    pair('الصافي', `${fmt(t.net)} ${sym}`, { size: 32, bold: 1 });
    if (inv.cur === 'fx') pair('المعادل', `${fmt(t.net * num(inv.rate))} ${cur()}`);
    else if (oldOn()) pair('بالقديم', oldAmt(t.net), { size: 22 });
    if (FX().rate && inv.cur !== 'fx') pair('≈ بالدولار', `${fmt(t.net / FX().rate)} ${FX().sym}`, { size: 22 });
    if (a && inv.pay !== 'cash') {
      line();
      const b = partyBal(a), isCust = a.type === 'asset', owes = isCust ? b > 0 : b < 0;
      pair(r2(b) ? (owes ? 'الرصيد المستحق عليكم' : 'رصيدكم لدينا') : 'الرصيد', `${fmt(Math.abs(b))} ${cur()}`, { bold: 1 });
    }
    line();
    txt(s.receiptFooter || 'شكراً لتعاملكم معنا', { size: 24, align: 'c' });
    gap(30);
    return render(ops);
  }

  function render(ops) {
    const W = paperW(), P = 8, c = document.createElement('canvas'), x = c.getContext('2d');
    const font = o => `${o.bold ? 'bold ' : ''}${o.size || 24}px ${FONT}`;
    const wrap = (text, o, max) => {
      x.font = font(o); const out = []; let cur = '';
      for (const w of text.split(/\s+/)) { const tr = cur ? cur + ' ' + w : w; if (x.measureText(tr).width > max && cur) { out.push(cur); cur = w; } else cur = tr; }
      out.push(cur); return out;
    };
    // قياس
    let H = P; const plan = [];
    for (const o of ops) {
      const sz = o.size || 24, lh = Math.round(sz * 1.45);
      if (o.k === 't') { const ls = wrap(o.text, o, W - 2 * P); plan.push({ o, ls, y: H, lh }); H += ls.length * lh; }
      else if (o.k === 'p') { plan.push({ o, y: H, lh }); H += lh; }
      else if (o.k === 'hr') { plan.push({ o, y: H }); H += 18; }
      else { H += o.h; }
    }
    c.width = W; c.height = H + P;
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, c.height); x.fillStyle = '#000'; x.textBaseline = 'top';
    for (const { o, ls, y, lh } of plan) {
      if (o.k === 'hr') { x.fillRect(P, y + 8, W - 2 * P, 2); continue; }
      x.font = font(o); x.direction = 'rtl';
      if (o.k === 't') ls.forEach((s, i) => { x.textAlign = o.align === 'c' ? 'center' : 'right'; x.fillText(s, o.align === 'c' ? W / 2 : W - P, y + i * lh); });
      else { x.textAlign = 'right'; x.fillText(o.l, W - P, y); x.textAlign = 'left'; x.fillText(o.r, P, y); }
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

  /* ---------- الواجهة ---------- */
  function open(inv) {
    const canvas = build(inv);
    const hasBT = !!(navigator.bluetooth);
    modal('🧾 إيصال حراري', `
      <div class="rc-prev"></div>
      <p class="muted" id="rcMsg" style="margin:8px 0 0">${hasBT ? 'شغّل الطابعة والبلوتوث، واضغط «طباعة بلوتوث». أول مرة اختار الطابعة من القائمة.' : 'المتصفح ما بيدعم البلوتوث (استخدم Chrome على أندرويد). فيك تشارك الإيصال كصورة.'}</p>`,
      { extra: `${hasBT ? '<button type="button" class="btn pri" id="rcBt">🖨 طباعة بلوتوث</button><button type="button" class="btn" id="rcPick">🔄 طابعة تانية</button>' : ''}<button type="button" class="btn" id="rcShare">📤 مشاركة صورة</button>` });
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
    const bt = $('#rcBt', d); if (bt) bt.onclick = () => go(false);
    const pk = $('#rcPick', d); if (pk) pk.onclick = () => { dev = null; ch = null; go(true); };
    $('#rcShare', d).onclick = () => canvas.toBlob(async blob => {
      const f = new File([blob], `فاتورة-${inv.no}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f] }); } catch (e) {} }
      else { const u = URL.createObjectURL(blob), el = document.createElement('a'); el.href = u; el.download = f.name; el.click(); setTimeout(() => URL.revokeObjectURL(u), 3000); }
    }, 'image/png');
  }
  return { open, build, escpos };
})();
window.Receipt = Receipt;
