// Receives e-mails from the Gmail Apps Scripts (one per Gmail account).
// Gold Coast receipts and invoices are parsed and applied to the shipments; Amazon and
// Binance e-mails are kept as they are (newest 60) until their reader is built.
// POST { emails: [{ id, from, subject, date, html, body }] }
// GET -> { docs }            GET ?raw=1 -> { raw }   (both need the key)
import { authorized, json, cors, store, loadData, saveData, applyDocs, notify, docMessages } from './lib.mjs';
import { parseEmail } from './gc-parse.mjs';

const RAW_MAX = 60;
const kindOf = (em) => {
  const f = String(em.from || '').toLowerCase();
  if (/goldcoastus\.net/.test(f)) return 'goldcoast';
  if (/amazon\./.test(f)) return 'amazon';
  if (/binance/.test(f)) return 'binance';
  return em.from ? 'otro' : 'goldcoast';
};
const SECRET = /(c[oó]digo|code|verif|otp|contrase|password|inicio de sesi|login|sign[- ]?in|2fa|autenticaci|authenticat)/i;
const strip = (html) => String(html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ');

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!(await authorized(req))) return json({ error: 'Clave incorrecta' }, 401);
  const s = store();
  if (req.method === 'GET') {
    if (new URL(req.url).searchParams.get('raw')) return json({ raw: Object.values((await s.get('raw', { type: 'json' })) || {}) });
    const docs = (await s.get('docs', { type: 'json' })) || {};
    return json({ docs: Object.values(docs), at: new Date().toISOString() });
  }
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  let payload; try { payload = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const emails = Array.isArray(payload.emails) ? payload.emails.slice(0, 50) : [];
  const docs = (await s.get('docs', { type: 'json' })) || {};
  let raw = null, added = 0, kept = 0;
  for (const em of emails) {
    const kind = kindOf(em);
    if (kind === 'goldcoast') {
      for (const d of parseEmail(em)) {
        const prev = docs[d.id];
        if (prev && prev.email_date && d.email_date && prev.email_date > d.email_date) continue;
        docs[d.id] = { ...prev, ...d, updatedAt: new Date().toISOString(), email_id: em.id || null };
        added++;
      }
    } else if (kind === 'amazon' || kind === 'binance') {
      if (SECRET.test(em.subject || '')) continue; // never keep security codes
      raw = raw || (await s.get('raw', { type: 'json' })) || {};
      raw[kind + ':' + em.id] = { kind, id: em.id, from: em.from, to: em.to || null, subject: em.subject || '', date: em.date || null,
        body: String(em.body || '').slice(0, 30000), html: kind === 'amazon' ? strip(em.html).slice(0, 200000) : null };
      kept++;
    }
  }
  if (raw) {
    const keys = Object.keys(raw).sort((a, b) => String(raw[b].date).localeCompare(String(raw[a].date)));
    keys.slice(RAW_MAX).forEach((k) => delete raw[k]);
    await s.setJSON('raw', raw);
  }
  let res = { changed: 0, created: 0, events: [] }, pushed = 0;
  if (added) {
    await s.setJSON('docs', docs);
    const data = await loadData(s);
    if (Object.keys(data.envios).length) {
      res = applyDocs(data, Object.values(docs));
      const msgs = docMessages(data, res.events);
      if (res.changed || res.created || msgs.length) await saveData(s, data);
      pushed = await notify(s, msgs);
    }
  }
  return json({ ok: true, parsed: added, kept, total: Object.keys(docs).length, changed: res.changed, created: res.created, pushed });
};
