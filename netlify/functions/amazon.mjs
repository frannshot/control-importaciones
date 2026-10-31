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

// Returns notification messages. E-mails dated before `initIso` only fill in shipments already in the app.
export function applyAmazon(data, raws, initIso) {
  const st = data.meta.amz = data.meta.amz || { applied: {} };
  const tar = (data.config && data.config.tarifas) || {};
  const rate = (Number.isFinite(Number(tar.tax)) && tar.tax !== null && tar.tax !== '' ? Number(tar.tax) : 7) / 100;
  const msgs = []; const env = data.envios;
  const list = () => Object.entries(env);
  const items = raws.filter((r) => !st.applied[r.id]).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const fresh = (d) => Date.now() - new Date(d).getTime() < 4 * 864e5;
  const now = () => new Date().toISOString();
  for (const r of items) {
    const backfill = String(r.date) < initIso;
    if (r.kind === 'amazon') {
      const p = parseAmazon(r); if (!p) { st.applied[r.id] = 1; continue; }
      if (p.tipo === 'pedido') {
        for (const o of p.orders) {
          if (list().some(([, e]) => e.pedido === o.pedido)) continue;
          if (backfill) continue;
          // An order you already typed in (same total, no order number yet) gets the number; otherwise it is created.
          const mine = list().filter(([, e]) => isAmz(e) && pending(e) && !AMZ_ID.test(e.pedido || '') && (near(e.total_compra, o.total, 0.06) || near(taxedTotal(e.items, rate), o.total, 0.06)))
            .sort((a, b) => String(b[1].creado || '').localeCompare(String(a[1].creado || '')))[0];
          if (mine) { env[mine[0]] = { ...mine[1], pedido: o.pedido, f_aprox_miami: mine[1].f_aprox_miami || o.llega, total_compra: o.total, actualizado: now() }; continue; }
          const id = newId();
          env[id] = { estado: 'Por cobrar', tienda: 'Amazon', pedido: o.pedido, f_compra: p.date ? caracasDay(p.date) : null, total_compra: o.total, metodo: 'aereo',
            f_aprox_miami: o.llega, cobro: 'pendiente', articulos: p.label, items: [], n_articulos: p.n, notas: null, creado: now(), actualizado: now() };
          if (fresh(p.date)) msgs.push({ title: '🛒 Pedido registrado: $' + (o.total ?? 0).toFixed(2), body: p.label + ' · Pedido ' + shortP(o.pedido) + ' · Agrega los enlaces y precios para que la app sepa qué va en cada caja', tag: 'am-' + id });
        }
      } else if (p.tipo === 'envio' && p.total != null) {
        let id = null, moved = null;
        // 1) Already in the app with this amount (typed by hand earlier, or a repeated e-mail)
        const hit = list().find(([, e]) => isAmz(e) && !pending(e) && near(e.total_compra, p.total) && (!AMZ_ID.test(e.pedido || '') || p.pedidos.includes(e.pedido)));
        if (hit) { id = hit[0]; const e = env[id]; env[id] = { ...e, pedido: AMZ_ID.test(e.pedido || '') ? e.pedido : p.pedido, cobro: 'cobrado', f_envio_tienda: e.f_envio_tienda || caracasDay(p.date), f_aprox_miami: e.f_aprox_miami || p.llega, amz_track_url: e.amz_track_url || p.trackUrl, actualizado: now() }; }
        else if (!backfill) {
          // 2) The order waiting to be charged: same order number first, then orders typed by hand without one
          const cands = list().filter(([, e]) => isAmz(e) && pending(e) && (p.pedidos.includes(e.pedido) || !AMZ_ID.test(e.pedido || '')))
            .sort((a, b) => (p.pedidos.includes(b[1].pedido) ? 1 : 0) - (p.pedidos.includes(a[1].pedido) ? 1 : 0));
          let done = false;
          for (const [pid, pe] of cands) {
            const its = pe.items || [];
            const sel = pickItems(its, p.total, rate);
            const whole = (sel && sel.length === its.length) || (!sel && near(pe.total_compra, p.total, 0.06));
            if (whole) {
              id = pid; moved = its;
              env[pid] = { ...pe, estado: 'En espera', cobro: 'cobrado', pedido: AMZ_ID.test(pe.pedido || '') ? pe.pedido : p.pedido, total_compra: p.total, f_envio_tienda: caracasDay(p.date), f_aprox_miami: p.llega || pe.f_aprox_miami, amz_track_url: p.trackUrl, actualizado: now() };
              done = true; break;
            }
            if (sel) { // part of the order: those items become their own package
              moved = sel.map((k) => its[k]); const rest = its.filter((_, k) => !sel.includes(k));
              id = newId();
              env[id] = { estado: 'En espera', tienda: pe.tienda || 'Amazon', pedido: AMZ_ID.test(pe.pedido || '') ? pe.pedido : p.pedido, parte_de: pid, f_compra: pe.f_compra, total_compra: p.total, metodo: pe.metodo || 'aereo', cobro: 'cobrado',
                f_envio_tienda: caracasDay(p.date), f_aprox_miami: p.llega || pe.f_aprox_miami, amz_track_url: p.trackUrl, items: moved, articulos: moved.map((x) => x.n).filter(Boolean).join('\n') || null, notas: null, creado: now(), actualizado: now() };
              const left = Math.round((Number(pe.total_compra) - p.total) * 100) / 100;
              env[pid] = { ...pe, pedido: AMZ_ID.test(pe.pedido || '') ? pe.pedido : p.pedido, items: rest, articulos: rest.map((x) => x.n).filter(Boolean).join('\n') || null, total_compra: taxedTotal(rest, rate) ?? (left > 0 ? left : pe.total_compra), actualizado: now() };
              done = true; break;
            }
          }
          if (!done) {
            // 3) No prices to compare: same order -> split by count; nothing known -> new package
            const pend = cands.find(([, e]) => p.pedidos.includes(e.pedido));
            id = newId();
            env[id] = { estado: 'En espera', tienda: 'Amazon', pedido: p.pedido, parte_de: pend ? pend[0] : null, f_compra: pend ? pend[1].f_compra : caracasDay(p.date), total_compra: p.total, metodo: 'aereo', cobro: 'cobrado', f_envio_tienda: caracasDay(p.date), amz_track_url: p.trackUrl,
              f_aprox_miami: p.llega, articulos: p.label, items: [], n_articulos: p.n, notas: null, creado: now(), actualizado: now() };
            if (pend) {
              const rest = Math.round((Number(pend[1].total_compra) - p.total) * 100) / 100;
              const left = pend[1].n_articulos && p.n ? pend[1].n_articulos - p.n : null;
              env[pend[0]] = { ...pend[1], total_compra: rest > 0 ? rest : pend[1].total_compra, n_articulos: left, articulos: left ? kindLabel(pend[1].articulos || '', left) : pend[1].articulos, actualizado: now() };
            }
          }
        }
        if (id && !backfill && fresh(p.date)) msgs.push({ title: '🚚 Cobrado y enviado: ' + what(moved || env[id].items, p.label), body: '$' + p.total.toFixed(2) + ' · Ahora: rumbo a Miami' + (p.llega ? ' · Llega a Miami aprox. el ' + day(p.llega) : '') + ' · Abre la app para ver el tracking y hacer la prealerta', tag: 'am-' + id });
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
  const cand = Object.entries(data.envios).filter(([, e]) => (e.tienda || '').toLowerCase().includes('amazon') && !e.cobro_binance && n(e.total_compra) != null && e.estado !== 'Por cobrar' && e.cobro !== 'pendiente');
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
