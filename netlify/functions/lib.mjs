// Shared helpers: auth, central data store and applying Gold Coast documents.
import { getStore } from '@netlify/blobs';

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
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
function findEnv(d, envios) {
  const list = Object.entries(envios);
  let e = list.find(([, x]) => x.recibo && String(x.recibo).replace(/-\d+$/, '') === d.recibo);
  if (!e && d.trackings && d.trackings.length) e = list.find(([, x]) => x.tracking && d.trackings.some((t) => trackMatch(t, x.tracking)));
  return e || null;
}
export function applyDocs(data, docs) {
  const applied = data.meta.applied;
  const fresh = docs.filter((d) => applied[d.id] !== d.updatedAt)
    .sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === 'recibo' ? -1 : 1) || String(a.fecha).localeCompare(String(b.fecha)));
  let changed = 0, created = 0;
  for (const d of fresh) {
    const hit = findEnv(d, data.envios); const isNew = !hit;
    const id = hit ? hit[0] : 'gc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const b = hit ? { ...hit[1] } : { estado: 'En Miami', metodo: d.metodo || 'aereo', tienda: d.tienda ? titleCase(d.tienda) : null, items: [], articulos: null, creado: new Date().toISOString() };
    b.recibo = b.recibo || d.recibo;
    if (!b.f_miami && d.fecha) b.f_miami = d.fecha;
    if (!b.estado || b.estado === 'En espera') b.estado = 'En Miami';
    if (d.volumen != null) b.volumen_cuft = d.volumen;
    if (d.tipo === 'recibo') {
      if (!b.tracking && d.trackings && d.trackings[0]) b.tracking = cleanTrack(d.trackings[0]);
      if (b.peso_lb == null && d.peso_real != null) b.peso_lb = Math.max(d.peso_real, d.peso_vol || 0);
      if (!b.tienda && d.tienda) b.tienda = titleCase(d.tienda);
      if (isNew) { const nm = niceName(d.contenido) || 'Paquete recibido en Miami'; b.items = [{ n: nm, img: null, url: null }]; b.articulos = nm; b.notas = 'Creado automáticamente con el recibo ' + d.recibo + ' de Gold Coast' + (d.valor_declarado != null ? '. Valor declarado: $' + Number(d.valor_declarado).toFixed(2) : '') + '. Completa la fecha de compra, el monto y los enlaces.'; }
    } else {
      if (d.total != null) { b.factura_gc = d.total; b.estado_flete = 'Confirmado'; }
      if (d.embarque) b.embarque = d.embarque;
      if (d.cobrado != null && d.cobrado_unidad === 'LB') b.peso_lb = d.cobrado;
      if (!b.tracking && d.trackings && d.trackings[0]) b.tracking = cleanTrack(d.trackings[0]);
      if (isNew) { const nm = niceName(d.notas) || 'Paquete facturado por Gold Coast'; b.items = [{ n: nm, img: null, url: null }]; b.articulos = nm; b.notas = 'Creado automáticamente con la factura ' + d.factura + ' de Gold Coast. Completa la fecha de compra, el monto y los enlaces.'; }
    }
    b.actualizado = new Date().toISOString();
    data.envios[id] = b; applied[d.id] = d.updatedAt;
    if (isNew) created++; else changed++;
  }
  return { changed, created };
}
