// Amazon order / shipment e-mails (Spanish templates) and Binance Card charges.
// They become shipments in the app: order -> "pendiente de cobro", shipment -> "cobrado",
// Binance charge -> confirms the exact amount taken from the card.
const MES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const DIA = { domingo: 0, lunes: 1, martes: 2, 'miércoles': 3, miercoles: 3, jueves: 4, viernes: 5, 'sábado': 6, sabado: 6 };
const iso = (d) => d.toISOString().slice(0, 10);
const caracasDay = (dateIso) => iso(new Date(new Date(dateIso).getTime() - 4 * 3600e3));
const addDays = (day, k) => { const x = new Date(day + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return iso(x); };
const money = (s) => { const v = parseFloat(String(s).replace(/,/g, '')); return Number.isFinite(v) ? Math.round(v * 100) / 100 : null; };

// "Llega el 28 de octubre", "Llega el miércoles", "Llega mañana", "Llegará entre el 27 de octubre y el 28 de octubre"
export function arrival(text, sentIso) {
  const base = caracasDay(sentIso); let best = null;
  for (const line of String(text).match(/Llega[^\n]*/gi) || []) {
    let d = null; const l = line.toLowerCase();
    const all = [...l.matchAll(/(\d{1,2}) de ([a-záéíóú]+)/g)].filter((m) => MES[m[2]]);
    if (all.length) { const m = all[all.length - 1]; const y = Number(base.slice(0, 4)); d = y + '-' + String(MES[m[2]]).padStart(2, '0') + '-' + m[1].padStart(2, '0'); if (d < addDays(base, -30)) d = (y + 1) + d.slice(4); }
    else if (/mañana/.test(l)) d = addDays(base, 1);
    else if (/\bhoy\b/.test(l)) d = base;
    else { const w = Object.keys(DIA).find((k) => l.includes(k)); if (w) { const cur = new Date(base + 'T12:00:00Z').getUTCDay(); let k = (DIA[w] - cur + 7) % 7; if (k === 0) k = 7; d = addDays(base, k); } }
    if (d && (!best || d > best)) best = d;
  }
  return best;
}
const countOf = (subject) => { const m = String(subject).match(/(\d+)/); return m ? Number(m[1]) : null; };
const kindLabel = (subject, n) => { const book = /libro/i.test(subject); if (!n) return book ? 'Libros' : 'Productos de Amazon'; return n + ' ' + (book ? (n === 1 ? 'libro' : 'libros') : (n === 1 ? 'producto' : 'productos')); };

export function parseAmazon(em) {
  const subject = String(em.subject || ''), body = String(em.body || '').replace(/\r/g, '');
  const sent = em.date || new Date().toISOString();
  if (/^\s*(pedido|ordered|your amazon\.com order)/i.test(subject)) {
    // One e-mail can hold several orders: each ends with its "Total (I.V.A. Incluido)".
    const parts = body.split(/Total \(I\.V\.A\. Incluido\):?\s*\n?\s*([\d.,]+)\s*USD/i);
    const orders = [];
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const seg = parts[i]; const ids = [...new Set(seg.match(/\d{3}-\d{7}-\d{7}/g) || [])];
      if (ids.length) orders.push({ pedido: ids[ids.length - 1], total: money(parts[i + 1]), llega: arrival(seg, sent) });
    }
    const n = countOf(subject);
    return { tipo: 'pedido', id: em.id, date: sent, orders, n: orders.length === 1 ? n : null, label: kindLabel(subject, orders.length === 1 ? n : null) };
  }
  if (/^\s*(enviad|shipped)/i.test(subject)) {
    const ids = [...new Set(body.match(/\d{3}-\d{7}-\d{7}/g) || [])];
    const t = body.match(/Total\s*\n\s*([\d.,]+)\s*USD/i);
    const n = countOf(subject);
    const tr = body.match(/(?:Rastrear paquete|Track package)\s*\n?\s*<?(https:\/\/www\.amazon\.com\/[^\s>]*progress-tracker[^\s>]*)/i);
    const trackUrl = tr ? tr[1].replace(/&ref_=[^&]*/g, '').replace(/&vt=[^&]*/g, '') : null;
    return { tipo: 'envio', id: em.id, date: sent, pedido: ids[0] || null, pedidos: ids, total: t ? money(t[1]) : null, llega: arrival(body, sent), n, label: kindLabel(subject, n), trackUrl };
  }
  return null;
}
export function parseBinance(em) {
  const m = String(em.body || '').match(/You[’']ve paid ([\d.,]+) ([A-Z]{3}) at ([^\n]+?)\.\s*If this/i);
  if (!m) return null;
  return { tipo: 'cargo', id: em.id, date: em.date, monto: money(m[1]), moneda: m[2], comercio: m[3].trim(), amazon: /amazon/i.test(m[3]) };
}

/* ---------- Apply to the shipments ---------- */
const AMZ_ID = /^\d{3}-\d{7}-\d{7}$/;
const near = (a, b, tol = 0.015) => a != null && b != null && Math.abs(Number(a) - Number(b)) < tol;
const newId = () => 'am' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const shortP = (p) => p ? '…' + p.slice(-7) : '';
const isAmz = (e) => /amazon/i.test(e.tienda || '');
const pending = (e) => e.estado === 'Por cobrar' || e.cobro === 'pendiente';
const what = (items, fallback) => { const L = (items || []).map((x) => x.n).filter(Boolean); if (!L.length) return fallback || 'Tu paquete'; const f = L[0].length > 44 ? L[0].slice(0, 42) + '…' : L[0]; return L.length > 1 ? f + ' y ' + (L.length - 1) + ' más' : f; };
const day = (iso) => iso ? iso.slice(8) + '/' + iso.slice(5, 7) : '';

// Which of the order's items add up to the amount charged (each price + sales tax, rounded per item like Amazon).
function pickItems(items, amount, rate) {
  const P = (items || []).map((it, i) => ({ i, v: it.p != null && Number.isFinite(Number(it.p)) ? Math.round(Number(it.p) * (1 + rate) * 100) / 100 : null })).filter((x) => x.v != null);
  if (!P.length || P.length > 20) return null;
  const tol = 0.02 + 0.005 * P.length; let best = null;
  const rec = (start, chosen, sum) => {
    if (best) return;
    if (near(sum, amount, tol) && chosen.length) { best = chosen.slice(); return; }
    if (sum > amount + tol) return;
    for (let k = start; k < P.length; k++) { chosen.push(P[k].i); rec(k + 1, chosen, sum + P[k].v); chosen.pop(); }
  };
  rec(0, [], 0);
  return best;
}
const taxedTotal = (items, rate) => { const ps = (items || []).filter((x) => x.p != null); return ps.length && ps.length === (items || []).length ? Math.round(ps.reduce((s, x) => s + Math.round(Number(x.p) * (1 + rate) * 100) / 100, 0) * 100) / 100 : null; };

// Amazon groups things three different ways, and the app keeps them apart:
//  - order  (number + total, from the "Pedido" e-mail)       -> which of your items belong together
//  - charge (Binance, one per order or per part of an order) -> those items become "cobrado" / Rumbo al casillero
//  - box    (tracking)                                       -> you build it in the app; Gold Coast matches it by tracking
// Shipment e-mails only confirm charges and keep the Amazon tracking link; they never create boxes.
const PENDING = (e) => isAmz(e) && e.estado === 'Por cobrar';
const priced = (it) => it && it.p != null && Number.isFinite(Number(it.p));
const r2 = (v) => Math.round(v * 100) / 100;
const daysApart = (a, b) => Math.abs(new Date(String(a).slice(0, 10) + 'T12:00:00Z') - new Date(String(b).slice(0, 10) + 'T12:00:00Z')) / 864e5;
const hasPedido = (e, ped) => String(e.pedido || '').includes(ped);
// Charges from before this model were sorted by hand on 8 Nov; only newer ones are matched automatically.
const CHARGES_FROM = '2026-11-08T23:00:00.000Z';

// Items of purchases still waiting, as a flat pool: [{env, idx, it, v (price + tax)}]
function pool(data, rate, dateIso, filter) {
  const out = [];
  for (const [id, e] of Object.entries(data.envios)) {
    if (!PENDING(e) || (filter && !filter(e))) continue;
    if (dateIso && e.f_compra && daysApart(e.f_compra, dateIso) > 4) continue;
    (e.items || []).forEach((it, idx) => { if (priced(it)) out.push({ env: id, idx, it, v: r2(Number(it.p) * (1 + rate)) }); });
  }
  return out;
}
// Smallest set of pooled items whose prices + tax add up to `amount`; prefers items from the same purchase.
function subsetPool(P, amount) {
  if (!P.length || P.length > 24) return null;
  const tol = 0.02 + 0.005 * P.length; let best = null;
  const order = P.slice().sort((a, b) => a.env.localeCompare(b.env) || a.idx - b.idx);
  for (let size = 1; size <= Math.min(order.length, 12) && !best; size++) {
    const rec = (start, chosen, sum) => {
      if (best) return;
      if (chosen.length === size) { if (near(sum, amount, tol)) best = chosen.slice(); return; }
      for (let k = start; k < order.length; k++) { if (sum + order[k].v > amount + tol) continue; chosen.push(order[k]); rec(k + 1, chosen, sum + order[k].v); chosen.pop(); }
    };
    rec(0, [], 0);
  }
  return best;
}
// Take the chosen items out of their purchases and put them in one purchase (reusing one when it already is exactly that).
function regroup(data, picked, rate, patch, now) {
  const env = data.envios; const bySrc = {};
  picked.forEach((x) => { (bySrc[x.env] = bySrc[x.env] || []).push(x.idx); });
  const whole = Object.keys(bySrc).find((id) => bySrc[id].length === (env[id].items || []).length);
  const items = picked.map((x) => x.it);
  const first = env[picked[0].env];
  const id = whole && Object.keys(bySrc).length === 1 ? whole : newId();
  for (const [src, idxs] of Object.entries(bySrc)) {
    if (src === id) continue;
    const rest = (env[src].items || []).filter((_, k) => !idxs.includes(k));
    if (!rest.length) delete env[src];
    else env[src] = { ...env[src], items: rest, articulos: rest.map((x) => x.n).filter(Boolean).join('\n') || null, total_compra: taxedTotal(rest, rate) ?? env[src].total_compra, actualizado: now };
  }
  const base = env[id] || { estado: 'Por cobrar', tienda: first.tienda || 'Amazon', f_compra: first.f_compra, metodo: first.metodo || 'aereo', creado: now };
  env[id] = { ...base, items, articulos: items.map((x) => x.n).filter(Boolean).join('\n') || null, total_compra: r2(picked.reduce((s, x) => s + x.v, 0)), ...patch, actualizado: now };
  return id;
}

// Returns notification messages. E-mails dated before `initIso` only fill in what is already in the app.
export function applyAmazon(data, raws, initIso) {
  const st = data.meta.amz = data.meta.amz || { applied: {} };
  st.orders = st.orders || {}; st.cargos = st.cargos || {};
  const tar = (data.config && data.config.tarifas) || {};
  const rate = (Number.isFinite(Number(tar.tax)) && tar.tax !== null && tar.tax !== '' ? Number(tar.tax) : 7) / 100;
  const msgs = []; const env = data.envios; const now = () => new Date().toISOString();
  const fresh = (d) => Date.now() - new Date(d).getTime() < 4 * 864e5;
  const items = (raws || []).filter((r) => !st.applied[r.id]).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const r of items) {
    st.applied[r.id] = 1;
    const backfill = String(r.date) < initIso;
    if (r.kind === 'amazon') {
      const p = parseAmazon(r); if (!p || backfill) continue;
      if (p.tipo === 'pedido') {
        for (const o of p.orders) if (o.pedido && o.total != null && !st.orders[o.pedido]) st.orders[o.pedido] = { total: o.total, date: p.date, llega: o.llega, n: p.orders.length === 1 ? p.n : null };
      } else if (p.tipo === 'envio' && p.total != null) {
        for (const ped of p.pedidos) { const o = st.orders[ped] = st.orders[ped] || { total: null, date: p.date }; o.envios = (o.envios || []).concat([{ total: p.total, date: p.date, llega: p.llega, url: p.trackUrl, n: p.n }]); }
        // keep the Amazon tracking link and date on what is already in the app for that order
        for (const [id, e] of Object.entries(env)) if (p.pedidos.some((x) => hasPedido(e, x))) env[id] = { ...e, amz_track_url: e.amz_track_url || p.trackUrl, f_envio_tienda: e.f_envio_tienda || caracasDay(p.date), f_aprox_miami: e.f_aprox_miami || p.llega, actualizado: now() };
        // a charge of this amount for this order (Amazon charges when it ships)
        st.cargos['envio:' + r.id] = { monto: p.total, date: p.date, pedido: p.pedido, fuente: 'amazon', n: p.n, label: p.label };
      }
    } else if (r.kind === 'binance') {
      const c = parseBinance(r);
      if (!c || !c.amazon || c.moneda !== 'USD' || /prime/i.test(c.comercio)) continue;
      st.cargos[r.id] = { monto: c.monto, date: c.date, fuente: 'binance' };
    }
  }
  msgs.push(...reconcile(data, initIso));
  return msgs;
}

// Runs after every change (new e-mail, or you saving a purchase): order numbers, then charges.
export function reconcile(data, initIso) {
  const st = data.meta.amz = data.meta.amz || { applied: {} };
  st.orders = st.orders || {}; st.cargos = st.cargos || {};
  const tar = (data.config && data.config.tarifas) || {};
  const rate = (Number.isFinite(Number(tar.tax)) && tar.tax !== null && tar.tax !== '' ? Number(tar.tax) : 7) / 100;
  const env = data.envios; const now = () => new Date().toISOString(); const msgs = [];
  const fresh = (d) => Date.now() - new Date(d).getTime() < 4 * 864e5;
  // 1) Orders: give your registered items their Amazon order number, grouping them by the order total
  for (const [ped, o] of Object.entries(st.orders).sort((a, b) => String(a[1].date).localeCompare(String(b[1].date)))) {
    if (o.matched || o.total == null) continue;
    if (Object.values(env).some((e) => hasPedido(e, ped))) { o.matched = true; continue; }
    const pick = subsetPool(pool(data, rate, o.date, (e) => !AMZ_ID.test(e.pedido || '')), o.total);
    if (!pick) continue;
    regroup(data, pick, rate, { pedido: ped, f_aprox_miami: o.llega || null }, now());
    o.matched = true;
  }
  // 2) Charges: Binance (exact money taken) or Amazon's "Enviado" (same moment). One charge confirms one set of items.
  const seen = new Set();
  for (const [k, c] of Object.entries(st.cargos).sort((a, b) => String(a[1].date).localeCompare(String(b[1].date)))) {
    if (c.env || c.dup || String(c.date) < CHARGES_FROM || (Date.now() - new Date(c.date).getTime()) > 30 * 864e5) continue;
    // the same charge reported by Amazon and by Binance is used once
    const twin = Object.entries(st.cargos).find(([k2, c2]) => k2 !== k && c2.env && c2.fuente !== c.fuente && near(c2.monto, c.monto) && daysApart(c2.date, c.date) <= 2);
    if (twin) { c.dup = true; const e = env[twin[1].env]; if (e && c.fuente === 'binance' && e.cobro_binance == null) env[twin[1].env] = { ...e, cobro_binance: c.monto, cobro_fecha: caracasDay(c.date), actualizado: now() }; continue; }
    // Binance does not say which order: use the order whose total is exactly this amount, when there is one
    const ped = c.pedido || (Object.entries(st.orders).find(([, o]) => near(o.total, c.monto) && daysApart(o.date, c.date) <= 30) || [])[0] || null;
    const byOrder = ped ? (e) => hasPedido(e, ped) || !AMZ_ID.test(e.pedido || '') : null;
    let id = null;
    // whole purchase with that amount (same order first)
    const cand = Object.entries(env).filter(([, e]) => PENDING(e) && near(e.total_compra, c.monto) && (!byOrder || byOrder(e))).sort((a, b) => String(a[1].f_compra || '').localeCompare(String(b[1].f_compra || '')));
    const patch = { estado: 'En espera', cobro: 'cobrado', cobro_fecha: caracasDay(c.date), ...(c.fuente === 'binance' ? { cobro_binance: c.monto } : {}) };
    if (cand.length) { id = cand[0][0]; env[id] = { ...env[id], ...patch, total_compra: c.monto, actualizado: now() }; }
    else {
      // part of a purchase, or items spread over several purchases
      const pick = subsetPool(pool(data, rate, null, (e) => (!byOrder || byOrder(e)) && (!e.f_compra || daysApart(e.f_compra, c.date) <= 12)), c.monto);
      if (pick) id = regroup(data, pick, rate, { ...patch, pedido: env[pick[0].env].pedido || ped || null }, now());
      else if (c.fuente === 'amazon' && c.pedido && !Object.values(env).some((e) => hasPedido(e, c.pedido))) {
        // a purchase you did not register: it appears so you can add its items
        id = newId();
        env[id] = { estado: 'En espera', tienda: 'Amazon', pedido: c.pedido, f_compra: (st.orders[c.pedido] && st.orders[c.pedido].date ? caracasDay(st.orders[c.pedido].date) : caracasDay(c.date)), total_compra: c.monto, metodo: 'aereo', cobro: 'cobrado', cobro_fecha: caracasDay(c.date),
          articulos: c.label || null, items: [], n_articulos: c.n || null, notas: 'Compra que no estaba registrada. Agrega sus artículos con "Editar pedido".', creado: now(), actualizado: now() };
      }
    }
    if (!id) continue;
    c.env = id;
    if (String(c.date) >= initIso && fresh(c.date)) {
      const e = env[id];
      msgs.push({ title: '💳 Cobrado $' + Number(c.monto).toFixed(2) + ' en Amazon', body: what(e.items, e.articulos) + ' · Ahora: Rumbo al casillero · Agrega el tracking cuando Amazon lo muestre', tag: 'pay-' + id });
    }
  }
  return msgs;
}

const n = (v) => (v === '' || v == null || !isFinite(Number(v)) ? null : Number(v));
