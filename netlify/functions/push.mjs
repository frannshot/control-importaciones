// Push subscriptions for the app (one per device).
// GET -> { publicKey }   POST { subscription } -> saved   POST { test: true } -> test notification
// POST { remove: endpoint } -> forget a device
import { authorized, json, cors, store, publicKey, notify } from './lib.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!(await authorized(req))) return json({ error: 'Clave incorrecta' }, 401);
  const s = store();
  if (req.method === 'GET') return json({ publicKey: await publicKey(s) });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  let p; try { p = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const subs = (await s.get('subs', { type: 'json' })) || {};
  if (p.subscription && typeof p.subscription.endpoint === 'string' && /^https:\/\//.test(p.subscription.endpoint) && p.subscription.keys) {
    subs[p.subscription.endpoint] = { endpoint: p.subscription.endpoint, keys: { p256dh: String(p.subscription.keys.p256dh || ''), auth: String(p.subscription.keys.auth || '') } };
    const keys = Object.keys(subs); if (keys.length > 10) keys.slice(0, keys.length - 10).forEach((k) => delete subs[k]);
    await s.setJSON('subs', subs);
    if (p.test !== false) await notify(s, [{ title: '🔔 Notificaciones activadas', body: 'Te avisaré cuando lleguen recibos y facturas de Gold Coast, cuando salga tu paquete y cuando esté listo para retirar.', tag: 'hola' }]);
    return json({ ok: true, devices: Object.keys(subs).length });
  }
  if (p.remove) { delete subs[p.remove]; await s.setJSON('subs', subs); return json({ ok: true }); }
  if (p.test) return json({ ok: true, sent: await notify(s, [{ title: '🔔 Prueba', body: 'Así te llegarán los avisos de tus pedidos.', tag: 'prueba' }]) });
  return json({ error: 'Nada que hacer' }, 400);
};
