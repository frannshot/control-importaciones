// Shared helpers: auth, central data store and applying Gold Coast documents.
import { getStore } from '@netlify/blobs';
import webpush from 'web-push';

const KEY_HASH = '48e899b704fe73ef1962ca6a9e9e12b5e69fd774fe7ca0d831ebe9b4068276f5';
export const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'x-key, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
export const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
async function sha256(s) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
export async function authorized(req) {
  const key = req.headers.get('x-key') || new URL(req.url).searchParams.get('key') || '';
  return !!key && (await sha256(key)) === KEY_HASH;
}
export const store = () => getStore({ name: 'gold-coast', consistency: 'strong' });
export const COLS = ['envios', 'pendientes', 'cotizaciones', 'config'];
export const emptyData = () => ({ envios: {}, pendientes: {}, cotizaciones: {}, config: {}, meta: { rev: 0, applied: {} } });
export async function loadData(s) {
  const d = (await s.get('data', { type: 'json' })) || emptyData();
  COLS.forEach((c) => { d[c] = d[c] || {}; });
  d.meta = d.meta || { rev: 0, applied: {} }; d.meta.applied = d.meta.applied || {};
  return d;
}
export async function saveData(s, d) { d.meta.rev = (d.meta.rev || 0) + 1; d.meta.at = new Date().toISOString(); await s.setJSON('data', d); return d.meta.rev; }

/* ---- Apply parsed Gold Coast documents to the shipments ---- */
const normT = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const trackMatch = (a, b) => { a = normT(a); b = normT(b); if (a.length < 10 || b.length < 10) return false; return a === b || a.endsWith(b) || b.endsWith(a); };
const cleanTrack = (s) => { s = normT(s); const m = s.match(/^420\d{5}(9[2-5]\d{18,24})$/); return m ? m[1] : s; };
const niceName = (s) => { s = String(s || '').replace(/ITEM FROM:\s*[A-Z0-9 .&'-]+?(?=\s+\d|\s*$)/i, '').replace(/\b[A-Z0-9]{12,}\b/g, '').replace(/[-\s]+$/, '').trim(); if (!s) return null; s = s.toLowerCase().replace(/\bbooks\b/g, 'libros').replace(/\bbook\b/g, 'libro'); return s.charAt(0).toUpperCase() + s.slice(1); };
const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const embarqueDate = (s) => { const m = /^([A-Z]{3})_(\d{1,2})_(\d{4})/.exec(String(s || '').toUpperCase()); return m && MON[m[1]] ? m[3] + '-' + String(MON[m[1]]).padStart(2, '0') + '-' + m[2].padStart(2, '0') : null; };
const todayCaracas = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
function findEnv(d, envios) {
  const list = Object.entries(envios);
  let e = list.find(([, x]) => x.recibo && String(x.recibo).replace(/-\d+$/, '') === d.recibo);
  if (!e && d.trackings && d.trackings.length) e = list.find(([, x]) => x.tracking && d.trackings.some((t) => trackMatch(t, x.tracking)));
  // Gold Coast's "declared value" is what the store charged: it finds the package when the tracking is not known yet.
  if (!e && d.tipo === 'recibo' && d.valor_declarado != null) {
    const c = list.filter(([, x]) => !x.recibo && !x.tracking && (x.estado === 'En espera' || x.estado === 'Por cobrar') && x.total_compra != null && Math.abs(Number(x.total_compra) - Number(d.valor_declarado)) < 0.015 && (!d.tienda || !x.tienda || x.tienda.toLowerCase().includes(String(d.tienda).toLowerCase().split(' ')[0])));
    if (c.length === 1) e = c[0];
  }
  return e || null;
}
export function applyDocs(data, docs) {
  const applied = data.meta.applied;
  const fresh = docs.filter((d) => applied[d.id] !== d.updatedAt)
    .sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === 'recibo' ? -1 : 1) || String(a.fecha).localeCompare(String(b.fecha)));
  let changed = 0, created = 0; const events = [];
  for (const d of fresh) {
    const hit = findEnv(d, data.envios); const isNew = !hit;
    const id = hit ? hit[0] : 'gc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const b = hit ? { ...hit[1] } : { estado: 'En Miami', metodo: d.metodo || 'aereo', tienda: d.tienda ? titleCase(d.tienda) : null, items: [], articulos: null, creado: new Date().toISOString() };
    b.recibo = b.recibo || d.recibo;
    if (!b.f_miami && d.fecha) b.f_miami = d.fecha;
    if (!b.estado || b.estado === 'En espera' || b.estado === 'Por cobrar') b.estado = 'En Miami';
    if (d.volumen != null) b.volumen_cuft = d.volumen;
    if (d.tipo === 'recibo') {
      if (!b.tracking && d.trackings && d.trackings[0]) b.tracking = cleanTrack(d.trackings[0]);
      if (b.peso_lb == null && d.peso_real != null) b.peso_lb = Math.max(d.peso_real, d.peso_vol || 0);
      if (!b.tienda && d.tienda) b.tienda = titleCase(d.tienda);
      if (isNew) { const nm = niceName(d.contenido) || 'Paquete recibido en Miami'; b.items = [{ n: nm, img: null, url: null }]; b.articulos = nm; b.notas = 'Creado automáticamente con el recibo ' + d.recibo + ' de Gold Coast' + (d.valor_declarado != null ? '. Valor declarado: $' + Number(d.valor_declarado).toFixed(2) : '') + '. Completa la fecha de compra, el monto y los enlaces.'; }
    } else {
      if (d.total != null) { b.factura_gc = d.total; b.estado_flete = 'Confirmado'; }
      if (d.embarque) b.embarque = d.embarque;
      if ((b.estado === 'En Miami' || b.estado === 'En espera' || b.estado === 'Por cobrar') && embarqueDate(b.embarque)) b.estado = 'En tránsito'; // invoiced with a shipment number
      if (d.cobrado != null && d.cobrado_unidad === 'LB') b.peso_lb = d.cobrado;
      if (!b.tracking && d.trackings && d.trackings[0]) b.tracking = cleanTrack(d.trackings[0]);
      if (isNew) { const nm = niceName(d.notas) || 'Paquete facturado por Gold Coast'; b.items = [{ n: nm, img: null, url: null }]; b.articulos = nm; b.notas = 'Creado automáticamente con la factura ' + d.factura + ' de Gold Coast. Completa la fecha de compra, el monto y los enlaces.'; }
    }
    b.actualizado = new Date().toISOString();
    data.envios[id] = b; applied[d.id] = d.updatedAt;
    if (isNew) created++; else changed++;
    events.push({ id, b, d, isNew });
  }
  return { changed, created, events };
}

/* ---- Push notifications ---- */
// The signing keys are created once and kept in the private store, never in the code.
async function vapid(s) {
  let v = await s.get('vapid', { type: 'json' });
  if (!v) { v = webpush.generateVAPIDKeys(); await s.setJSON('vapid', v); }
  return v;
}
export async function publicKey(s) { return (await vapid(s)).publicKey; }
export async function notify(s, msgs) {
  msgs = (msgs || []).filter(Boolean); if (!msgs.length) return 0;
  const subs = (await s.get('subs', { type: 'json' })) || {};
  const list = Object.entries(subs); if (!list.length) return 0;
  const v = await vapid(s);
  webpush.setVapidDetails('https://importaciones-fran.netlify.app', v.publicKey, v.privateKey);
  let sent = 0, dirty = false;
  for (const m of msgs) {
    for (const [k, sub] of list) {
      if (!subs[k]) continue;
      try { await webpush.sendNotification(sub, JSON.stringify(m), { TTL: 86400 }); sent++; }
      catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) { delete subs[k]; dirty = true; } }
    }
  }
  if (dirty) await s.setJSON('subs', subs);
  return sent;
}

/* ---- Messages ---- */
const rates = (data) => { const c = (data.config && data.config.tarifas) || {}; return { rate: Number(c.air_rate) || 4.85, min: Number(c.air_min) || 10, dias: Number.isFinite(Number(c.dias_retiro)) && c.dias_retiro !== null && c.dias_retiro !== '' ? Number(c.dias_retiro) : 5 }; };
const money = (v) => '$' + Number(v).toFixed(2);
const what = (b) => { const it = (b.items || []).map((x) => x.n).filter(Boolean); if (!it.length) return 'Tu paquete'; const first = it[0].length > 48 ? it[0].slice(0, 46) + '…' : it[0]; return it.length > 1 ? first + ' y ' + (it.length - 1) + ' más' : first; };
const fmtDay = (iso) => { const M = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']; const [, m, d] = iso.split('-'); return Number(d) + ' ' + M[Number(m) - 1]; };
const addDays = (iso, k) => { const x = new Date(iso + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const fresh = (iso, days) => !iso || (Date.now() - new Date(iso).getTime()) < days * 864e5;
export { embarqueDate, todayCaracas };

export function docMessages(data, events) {
  const out = [];
  for (const { id, b, d } of events || []) {
    if (!fresh(d.email_date, 4)) continue; // do not announce old e-mails
    if (d.tipo === 'recibo') {
      const lb = b.peso_lb != null ? Number(b.peso_lb) : null; const r = rates(data);
      const tar = (data.config && data.config.tarifas) || {}; const sea = b.metodo === 'maritimo' && Number(tar.sea_rate) > 0;
      const ft = b.volumen_cuft != null ? Math.max(Number(tar.vol_min) || 1, Number(b.volumen_cuft)) : null;
      const est = sea ? (ft != null ? ' · ' + ft + ' ft³ · Gold Coast aprox. ' + money(Math.max(Number(tar.sea_min) || 0, ft * Number(tar.sea_rate))) : '') : (lb != null ? ' · ' + lb.toFixed(2) + ' lb · Gold Coast aprox. ' + money(Math.max(r.min, lb * r.rate)) : '');
      out.push({ title: '📦 Llegó a Miami', body: what(b) + ' · Recibo ' + d.recibo + est, tag: 'gc-' + id });
    } else if (d.tipo === 'factura' && d.total != null) {
      out.push({ title: '🧾 Factura de Gold Coast: ' + money(d.total), body: what(b) + (d.cobrado != null ? ' · ' + d.cobrado + ' ' + (d.cobrado_unidad || 'lb').toLowerCase() : '') + (d.embarque ? ' · Embarque ' + d.embarque : ''), tag: 'gc-' + id });
    }
    out.push(...stepMessages(data, id));
  }
  return out;
}
// "Salió hacia Caracas" and "Listo para retirar", each sent once per shipment.
export function stepMessages(data, id) {
  const b = data.envios[id]; if (!b || b.estado === 'Terminado') return [];
  const sent = data.meta.notified = data.meta.notified || {};
  const t = todayCaracas(), emb = embarqueDate(b.embarque), out = [];
  if (!emb || emb > t) return out;
  if (!sent[id + ':transito'] && addDays(emb, 3) >= t) {
    sent[id + ':transito'] = t;
    const est = addDays(emb, rates(data).dias);
    out.push({ title: '✈️ Salió hacia Caracas', body: what(b) + ' · Embarque ' + b.embarque + ' · Llega aprox. el ' + fmtDay(est), tag: 'tr-' + id });
  } else if (!sent[id + ':transito']) sent[id + ':transito'] = t; // too old: mark silently
  const ready = addDays(emb, rates(data).dias);
  if (!sent[id + ':listo'] && ready <= t) {
    sent[id + ':listo'] = t;
    if (addDays(ready, 3) >= t) out.push({ title: '✅ Listo para retirar', body: what(b) + ' debería estar en Las Mercedes. Llama a Gold Coast antes de ir.', tag: 'ok-' + id });
  }
  return out;
}
