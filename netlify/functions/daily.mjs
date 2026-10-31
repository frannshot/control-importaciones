// Every morning (8:00 Caracas): packages whose shipment date has come move to "En tránsito",
// and you get "Salió hacia Caracas" / "Listo para retirar" once per package.
import { store, loadData, saveData, notify, stepMessages, embarqueDate, todayCaracas } from './lib.mjs';

export default async () => {
  const s = store();
  const data = await loadData(s);
  const t = todayCaracas(); const msgs = []; let moved = 0;
  if (!data.meta.notifyInit) { // first run: shipments already on their way were seen in the app, so no notice for them
    data.meta.notified = data.meta.notified || {};
    for (const [id, b] of Object.entries(data.envios)) { const emb = embarqueDate(b.embarque); if (emb && emb <= t) data.meta.notified[id + ':transito'] = t; }
    data.meta.notifyInit = t;
  }
  for (const [id, b] of Object.entries(data.envios)) {
    if (b.estado === 'Terminado') continue;
    const emb = embarqueDate(b.embarque);
    if (emb && emb <= t && (b.estado === 'En Miami' || b.estado === 'En espera')) { data.envios[id] = { ...b, estado: 'En tránsito', actualizado: new Date().toISOString() }; moved++; }
    msgs.push(...stepMessages(data, id));
  }
  await saveData(s, data);
  const sent = await notify(s, msgs);
  return new Response(JSON.stringify({ moved, messages: msgs.length, sent }), { headers: { 'content-type': 'application/json' } });
};
export const config = { schedule: '0 12 * * *' };
