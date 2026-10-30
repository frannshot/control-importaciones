// Central data for the app (all devices see the same data).
// GET ?since=REV          -> { same: true, rev } or { data, rev }
// POST { ops: [{ col, id, body|null }] }  -> apply writes (null deletes)
// POST { replace: data }  -> replace everything (first upload or restore), then re-apply Gold Coast docs
import { authorized, json, cors, store, loadData, saveData, emptyData, applyDocs, COLS } from './lib.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!(await authorized(req))) return json({ error: 'Clave incorrecta' }, 401);
  const s = store();
  let data = await loadData(s);
  if (req.method === 'GET') {
    const since = Number(new URL(req.url).searchParams.get('since') || -1);
    if (since === data.meta.rev) return json({ same: true, rev: data.meta.rev });
    const { meta, ...rest } = data;
    return json({ data: rest, rev: meta.rev, empty: !Object.keys(data.envios).length });
  }
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  let p; try { p = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  if (p.replace && typeof p.replace === 'object') {
    if (Object.keys(data.envios).length) await s.setJSON('data-anterior', data); // safety copy before a full replace
    const fresh = emptyData();
    COLS.forEach((c) => { fresh[c] = p.replace[c] && typeof p.replace[c] === 'object' ? p.replace[c] : {}; });
    delete fresh.config.sync;
    fresh.meta.applied = (p.applied && typeof p.applied === 'object') ? p.applied : data.meta.applied;
    fresh.meta.rev = data.meta.rev;
    data = fresh;
    const docs = (await s.get('docs', { type: 'json' })) || {};
    applyDocs(data, Object.values(docs));
  } else if (Array.isArray(p.ops)) {
    for (const op of p.ops.slice(0, 200)) {
      if (!COLS.includes(op.col) || typeof op.id !== 'string' || !op.id || op.id.length > 200) continue;
      if (op.col === 'config' && op.id === 'sync') continue;
      if (op.body === null) delete data[op.col][op.id];
      else if (op.body && typeof op.body === 'object') data[op.col][op.id] = op.body;
    }
  } else return json({ error: 'Nada que hacer' }, 400);
  const rev = await saveData(s, data);
  return json({ ok: true, rev });
};
