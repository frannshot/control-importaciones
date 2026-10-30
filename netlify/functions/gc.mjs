// Stores parsed Gold Coast documents (receipts and invoices) and serves them to the app.
// POST { emails: [{ id, subject, date, html, body }] }  -> parse and save
// GET                                                 -> { docs: [...] }
// Both require the x-key header (or ?key=) whose SHA-256 matches KEY_HASH.
import { getStore } from '@netlify/blobs';
import { parseEmail } from './gc-parse.mjs';

const KEY_HASH = '48e899b704fe73ef1962ca6a9e9e12b5e69fd774fe7ca0d831ebe9b4068276f5';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'x-key, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
async function sha256(s) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''); }

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const url = new URL(req.url);
  const key = req.headers.get('x-key') || url.searchParams.get('key') || '';
  if (!key || (await sha256(key)) !== KEY_HASH) return json({ error: 'Clave incorrecta' }, 401);
  const store = getStore({ name: 'gold-coast', consistency: 'strong' });
  const docs = (await store.get('docs', { type: 'json' })) || {};
  if (req.method === 'GET') return json({ docs: Object.values(docs), at: new Date().toISOString() });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  let payload; try { payload = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const emails = Array.isArray(payload.emails) ? payload.emails.slice(0, 50) : [];
  let added = 0;
  for (const em of emails) {
    for (const d of parseEmail(em)) {
      const prev = docs[d.id];
      if (prev && prev.email_date && d.email_date && prev.email_date > d.email_date) continue;
      docs[d.id] = { ...prev, ...d, updatedAt: new Date().toISOString(), email_id: em.id || null };
      added++;
    }
  }
  await store.setJSON('docs', docs);
  return json({ ok: true, parsed: added, total: Object.keys(docs).length });
};
