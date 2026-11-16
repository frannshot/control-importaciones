// Inbox for the app.  GET -> { items }   GET ?id=X -> one e-mail with its body
// POST { read: [ids] } or { readAll: true } -> mark as read (synced between devices)
import { authorized, json, cors, store } from './lib.mjs';
import { listMails, getMail, markRead } from './mailbox.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!(await authorized(req))) return json({ error: 'Clave incorrecta' }, 401);
  const s = store();
  if (req.method === 'GET') {
    const id = new URL(req.url).searchParams.get('id');
    if (id) { const m = await getMail(s, id); return m ? json(m) : json({ error: 'No encontrado' }, 404); }
    return json({ items: await listMails(s) });
  }
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  let p; try { p = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const ids = Array.isArray(p.read) ? p.read.map(String).slice(0, 500) : [];
  return json({ ok: true, marked: await markRead(s, ids, !!p.readAll) });
};
