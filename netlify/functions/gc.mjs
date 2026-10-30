// Receives Gold Coast e-mails (from the Gmail Apps Script), parses them, stores the
// documents and applies them to the central data so every device sees the update.
// POST { emails: [{ id, subject, date, html, body }] }   GET -> { docs }
import { authorized, json, cors, store, loadData, saveData, applyDocs } from './lib.mjs';
import { parseEmail } from './gc-parse.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!(await authorized(req))) return json({ error: 'Clave incorrecta' }, 401);
  const s = store();
  const docs = (await s.get('docs', { type: 'json' })) || {};
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
  await s.setJSON('docs', docs);
  let res = { changed: 0, created: 0 };
  const data = await loadData(s);
  if (Object.keys(data.envios).length) { res = applyDocs(data, Object.values(docs)); if (res.changed || res.created) await saveData(s, data); }
  return json({ ok: true, parsed: added, total: Object.keys(docs).length, ...res });
};
