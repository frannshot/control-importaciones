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
    return { tipo: 'envio', id: em.id, date: sent, pedido: ids[0] || null, pedidos: ids, total: t ? money(t[1]) : null, llega: arrival(body, sent), n, label: kindLabel(subject, n) };
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
const near = (a, b) => a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.015;
const newId = () => 'am' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const shortP = (p) => p ? '…' + p.slice(-7) : '';

// Returns notification messages. `backfill` = e-mails from before this feature existed: only enrich.
export function applyAmazon(data, raws, initIso) {
  const st = data.meta.amz = data.meta.amz || { applied: {} };
  const msgs = []; const env = data.envios;
  const list = () => Object.entries(env);
  const items = raws.filter((r) => !st.applied[r.id]).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const fresh = (d) => Date.now() - new Date(d).getTime() < 4 * 864e5;
  for (const r of items) {
    const backfill = String(r.date) < initIso;
    if (r.kind === 'amazon') {
      const p = parseAmazon(r); if (!p) { st.applied[r.id] = 1; continue; }
      if (p.tipo === 'pedido') {
        for (const o of p.orders) {
          if (list().some(([, e]) => e.pedido === o.pedido)) continue;
          if (backfill) continue; // older orders are already in the app
          const id = newId();
          env[id] = { estado: 'En espera', tienda: 'Amazon', pedido: o.pedido, f_compra: p.date ? caracasDay(p.date) : null, total_compra: o.total, metodo: 'aereo',
            f_aprox_miami: o.llega, cobro: 'pendiente', articulos: p.label, items: [], n_articulos: p.n, notas: null, creado: new Date().toISOString(), actualizado: new Date().toISOString() };
          if (fresh(p.date)) msgs.push({ title: '🛒 Pedido confirmado: $' + (o.total ?? 0).toFixed(2), body: p.label + ' · Pedido ' + shortP(o.pedido) + (o.llega ? ' · Llega a Miami aprox. el ' + o.llega.slice(8) + '/' + o.llega.slice(5, 7) : '') + ' · Amazon cobra al enviarlo', tag: 'am-' + id });
        }
      } else if (p.tipo === 'envio' && p.total != null) {
        // 1) Already in the app with the same amount (shipments typed by hand, or a repeat e-mail)
        let hit = list().find(([, e]) => (e.tienda || '').toLowerCase().includes('amazon') && near(e.total_compra, p.total) && (!e.pedido || !AMZ_ID.test(e.pedido) || p.pedidos.includes(e.pedido)) && e.cobro !== 'pendiente');
        let id;
        if (hit) { id = hit[0]; const e = env[id]; env[id] = { ...e, pedido: AMZ_ID.test(e.pedido || '') ? e.pedido : p.pedido, cobro: e.cobro_binance ? 'cobrado' : 'cobrado', f_envio_tienda: e.f_envio_tienda || caracasDay(p.date), f_aprox_miami: e.f_aprox_miami || p.llega, actualizado: new Date().toISOString() }; }
        else if (!backfill) {
          // 2) The order is waiting for this shipment
          const pend = list().find(([, e]) => e.cobro === 'pendiente' && p.pedidos.includes(e.pedido));
          if (pend && (near(pend[1].total_compra, p.total) || Number(pend[1].total_compra) < p.total)) {
            id = pend[0]; env[id] = { ...pend[1], cobro: 'cobrado', total_compra: p.total, f_envio_tienda: caracasDay(p.date), f_aprox_miami: p.llega || pend[1].f_aprox_miami, actualizado: new Date().toISOString() };
          } else {
            id = newId();
            env[id] = { estado: 'En espera', tienda: 'Amazon', pedido: p.pedido, f_compra: pend ? pend[1].f_compra : caracasDay(p.date), total_compra: p.total, metodo: 'aereo', cobro: 'cobrado', f_envio_tienda: caracasDay(p.date),
              f_aprox_miami: p.llega, articulos: p.label, items: [], n_articulos: p.n, notas: pend ? 'Parte del pedido ' + p.pedido + ' (envío separado). ' + (p.n === 1 ? 'Mueve aquí el enlace de este artículo.' : 'Mueve aquí los enlaces de estos ' + (p.n || '') + ' artículos.') : null, creado: new Date().toISOString(), actualizado: new Date().toISOString() };
            if (pend) { // what is left of the order keeps waiting
              const rest = Math.round((Number(pend[1].total_compra) - p.total) * 100) / 100;
              const left = pend[1].n_articulos && p.n ? pend[1].n_articulos - p.n : null;
              env[pend[0]] = { ...pend[1], total_compra: rest > 0 ? rest : pend[1].total_compra, n_articulos: left, articulos: left ? kindLabel(pend[1].articulos || '', left) : pend[1].articulos, actualizado: new Date().toISOString() };
            }
          }
        }
        if (id && !backfill && fresh(p.date)) msgs.push({ title: '🚚 Amazon envió tu paquete', body: (env[id].items && env[id].items.length ? env[id].items.length + ' artículos' : p.label) + ' · $' + p.total.toFixed(2) + ' cobrado a tu tarjeta' + (p.llega ? ' · Llega a Miami aprox. el ' + p.llega.slice(8) + '/' + p.llega.slice(5, 7) : ''), tag: 'am-' + id });
      }
      st.applied[r.id] = 1;
    } else if (r.kind === 'binance') {
      const c = parseBinance(r);
      if (!c || !c.amazon || c.moneda !== 'USD') { st.applied[r.id] = 1; continue; }
      st.cargos = st.cargos || {}; st.cargos[r.id] = { monto: c.monto, date: c.date };
      st.applied[r.id] = 1;
    }
  }
  msgs.push(...matchCharges(data, initIso));
  return msgs;
}

// Binance charges -> shipments. Amazon may charge one shipment in several pieces (one per order).
function matchCharges(data, initIso) {
  const st = data.meta.amz; const cargos = st.cargos || {}; const out = [];
  const free = Object.entries(cargos).filter(([, c]) => !c.env);
  if (!free.length) return out;
  const cand = Object.entries(data.envios).filter(([, e]) => (e.tienda || '').toLowerCase().includes('amazon') && !e.cobro_binance && n(e.total_compra) != null);
  for (const [id, e] of cand) {
    const ref = e.f_envio_tienda || e.f_compra; if (!ref) continue;
    const pool = free.filter(([, c]) => !c.env && Math.abs(new Date(caracasDay(c.date)) - new Date(ref)) <= 6 * 864e5);
    const pick = subset(pool, Number(e.total_compra)); if (!pick) continue;
    pick.forEach(([k]) => { cargos[k].env = id; });
    data.envios[id] = { ...e, cobro: 'cobrado', cobro_binance: Math.round(pick.reduce((s, [, c]) => s + c.monto, 0) * 100) / 100, cobro_fecha: caracasDay(pick[pick.length - 1][1].date), actualizado: new Date().toISOString() };
    const last = pick[pick.length - 1][1];
    if (String(last.date) >= initIso && Date.now() - new Date(last.date).getTime() < 4 * 864e5) {
      const label = (e.items && e.items.length ? (e.items[0].n || '').slice(0, 40) + (e.items.length > 1 ? ' y ' + (e.items.length - 1) + ' más' : '') : e.articulos || 'Pedido de Amazon');
      out.push({ title: '💳 Binance: pagaste $' + Number(e.total_compra).toFixed(2) + ' en Amazon', body: label + (e.pedido ? ' · Pedido ' + shortP(e.pedido) : ''), tag: 'pay-' + id });
    }
  }
  return out;
}
const n = (v) => (v === '' || v == null || !isFinite(Number(v)) ? null : Number(v));
function subset(pool, target) {
  const P = pool.slice(0, 12);
  for (let size = 1; size <= Math.min(4, P.length); size++) {
    const rec = (start, chosen, sum) => {
      if (chosen.length === size) return near(sum, target) ? chosen : null;
      for (let i = start; i < P.length; i++) { const r = rec(i + 1, [...chosen, P[i]], sum + P[i][1].monto); if (r) return r; }
      return null;
    };
    const r = rec(0, [], 0); if (r) return r;
  }
  return null;
}
