// Telegram bot.
// From the app (x-key):   GET -> status   POST {token} -> connect bot   POST {test} -> test message   POST {off} -> disconnect
// From Telegram (webhook, secret header): answers only the linked chat.
import { authorized, json, cors, store, loadData, embarqueDate, todayCaracas } from './lib.mjs';
import { tgCall, tgConf, tgSend, esc, MENU } from './tg.mjs';

const SITE = 'https://importaciones-fran.netlify.app';
const rnd = (k) => [...crypto.getRandomValues(new Uint8Array(k))].map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
const LABEL = { 'Por cobrar': 'Por cobrar', 'En espera': 'Rumbo al casillero', 'En Miami': 'En Miami', 'En tránsito': 'Rumbo a Caracas', 'Terminado': 'Retirados' };
const ICON = { 'Por cobrar': '🟠', 'En espera': '🚚', 'En Miami': '🔵', 'En tránsito': '✈️', 'Terminado': '✅' };
const ORDER = ['Por cobrar', 'En espera', 'En Miami', 'En tránsito'];
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const usd = (v) => '$' + Number(v).toFixed(2);
const addDays = (iso, k) => { const x = new Date(iso + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const fmtDay = (iso) => { const M = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']; const [, m, d] = iso.split('-'); return Number(d) + ' ' + M[Number(m) - 1]; };
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5);

const names = (e) => { const it = (e.items || []).map((x) => x && x.n).filter(Boolean); if (it.length) return it; return String(e.articulos || '').split(/\n+/).map((x) => x.trim()).filter(Boolean); };
const short = (s, k = 52) => (s.length > k ? s.slice(0, k - 1) + '…' : s);
const what = (e) => { const it = names(e); if (!it.length) return 'Sin artículos'; return short(it[0]) + (it.length > 1 ? ' y ' + (it.length - 1) + ' más' : ''); };
const diasRetiro = (data) => { const v = num(((data.config || {}).tarifas || {}).dias_retiro); return v == null ? 5 : v; };
const retiroEst = (data, e) => { if (e.f_retiro || e.estado === 'Terminado') return null; const d = embarqueDate(e.embarque); return d ? addDays(d, diasRetiro(data)) : null; };
const list = (data) => Object.entries(data.envios || {}).filter(([, e]) => e && typeof e === 'object').map(([id, e]) => ({ id, ...e }));

function line(data, e) {
  const bits = [];
  if (e.estado === 'En tránsito') { const r = retiroEst(data, e); if (r) bits.push(r <= todayCaracas() ? 'listo para retirar' : 'llega aprox. ' + fmtDay(r)); }
  if (e.tracking) bits.push('tracking …' + String(e.tracking).slice(-6));
  else if (e.estado === 'En espera') bits.push('sin tracking');
  if (e.recibo) bits.push('recibo ' + e.recibo);
  if (num(e.factura_gc) != null) bits.push('GC ' + usd(e.factura_gc));
  else if (num(e.total_compra) != null) bits.push(usd(e.total_compra));
  return '• ' + esc(what(e)) + (bits.length ? '\n   <i>' + esc(bits.join(' · ')) + '</i>' : '');
}

function porRetirar(data) {
  const t = todayCaracas();
  const R = list(data).filter((e) => e.estado === 'En tránsito' && retiroEst(data, e) && retiroEst(data, e) <= t);
  if (!R.length) {
    const next = list(data).filter((e) => e.estado === 'En tránsito' && retiroEst(data, e)).sort((a, b) => retiroEst(data, a) < retiroEst(data, b) ? -1 : 1)[0];
    return '🏁 <b>Nada listo para retirar todavía.</b>' + (next ? '\nEl próximo: ' + esc(what(next)) + ', aprox. el ' + fmtDay(retiroEst(data, next)) + '.' : '');
  }
  const cash = R.reduce((s, e) => s + (num(e.factura_gc) || 0), 0);
  return '🏁 <b>Por retirar: ' + R.length + '</b>' + (cash ? ' · lleva ' + usd(cash) : '') + '\n\n' + R.map((e) => line(data, e)).join('\n') + '\n\nLlama a Gold Coast antes de ir.';
}

function pendientes(data) {
  const L = list(data), t = todayCaracas(), out = [];
  const R = L.filter((e) => e.estado === 'En tránsito' && retiroEst(data, e) && retiroEst(data, e) <= t);
  if (R.length) { const cash = R.reduce((s, e) => s + (num(e.factura_gc) || 0), 0); out.push('🏁 <b>Por retirar:</b> ' + R.length + (cash ? ' · lleva ' + usd(cash) : '')); }
  const noTrack = L.filter((e) => e.estado === 'En espera' && !e.tracking && !e.recibo);
  if (noTrack.length) out.push('📦 <b>Falta tracking:</b>\n' + noTrack.map((e) => line(data, e)).join('\n'));
  const items = (e) => e.items || [];
  const comp = L.filter((e) => e.estado === 'Por cobrar' && (!items(e).some((x) => x.url) || items(e).some((x) => x.url && num(x.p) == null)));
  if (comp.length) out.push('✏️ <b>Completar (sin enlaces o precios):</b>\n' + comp.map((e) => line(data, e)).join('\n'));
  const rev = L.filter((e) => (e.estado === 'En espera' && e.f_aprox_miami && e.f_aprox_miami < t) || (e.estado === 'En Miami' && num(e.factura_gc) == null && e.f_miami && daysBetween(e.f_miami, t) >= 3));
  if (rev.length) out.push('⚠️ <b>Revisar (retrasado o sin factura):</b>\n' + rev.map((e) => line(data, e)).join('\n'));
  return out.length ? '📋 <b>Para hacer</b>\n\n' + out.join('\n\n') : '📋 Todo al día. No hay nada pendiente.';
}

function paquetes(data) {
  const L = list(data);
  const parts = ORDER.map((k) => { const g = L.filter((e) => e.estado === k); return g.length ? ICON[k] + ' <b>' + LABEL[k] + ' (' + g.length + ')</b>\n' + g.map((e) => line(data, e)).join('\n') : null; }).filter(Boolean);
  return parts.length ? parts.join('\n\n') : 'No tienes paquetes en curso.';
}

function buscar(data, q) {
  const k = q.toLowerCase().trim(); const kd = k.replace(/[^a-z0-9]/g, '');
  const hit = list(data).filter((e) => {
    if (names(e).some((x) => x.toLowerCase().includes(k))) return true;
    if (kd.length >= 5) return [e.tracking, e.pedido, e.recibo].some((v) => v && String(v).toLowerCase().replace(/[^a-z0-9]/g, '').includes(kd));
    return false;
  }).sort((a, b) => (a.estado === 'Terminado') - (b.estado === 'Terminado')).slice(0, 8);
  if (!hit.length) return 'No encontré nada con «' + esc(q) + '». Prueba con una palabra del artículo, el tracking o el número de pedido.';
  return hit.map((e) => ICON[e.estado] + ' <b>' + esc(LABEL[e.estado] || e.estado) + '</b>\n' + line(data, e)).join('\n\n');
}

const AYUDA = '🤖 <b>Esto es lo que sé hacer</b>\n\n📋 <b>Pendientes</b>: lo que tienes que hacer ahora\n🏁 <b>Por retirar</b>: qué buscar en Gold Coast y cuánto llevar\n📦 <b>Mis paquetes</b>: todo lo que está en camino, por estado\n🔎 Escríbeme una palabra (ej. <i>vans</i>), un tracking o un número de pedido y te digo dónde va.\n\nTambién te aviso aquí cuando cobren algo, llegue a Miami, salga hacia Caracas o esté listo para retirar.';

async function answer(data, text) {
  const t = String(text || '').trim(); const k = t.toLowerCase().replace(/^\//, '');
  if (/^(pendientes|para hacer|📋)/.test(k) || k.includes('pendiente')) return pendientes(data);
  if (/retirar|🏁/.test(k)) return porRetirar(data);
  if (/paquetes|📦|estado|en curso/.test(k)) return paquetes(data);
  if (/^(ayuda|help|❓|menu|menú|hola|buenas)/.test(k)) return AYUDA;
  return buscar(data, t.replace(/^\//, ''));
}

async function webhook(req, s) {
  const c = await tgConf(s);
  if (!c.token || !c.secret || req.headers.get('x-telegram-bot-api-secret-token') !== c.secret) return new Response('no', { status: 403 });
  let u; try { u = await req.json(); } catch { return new Response('ok'); }
  const m = u.message || u.edited_message; if (!m || !m.chat || typeof m.text !== 'string') return new Response('ok');
  const chat = m.chat.id, text = m.text.trim();
  const start = /^\/start(?:\s+(\S+))?/.exec(text);
  if (start && !c.chat) {
    if (start[1] && start[1] === c.code) {
      c.chat = chat; c.code = null; await s.setJSON('tg', c);
      await tgCall(c.token, 'sendMessage', { chat_id: chat, parse_mode: 'HTML', reply_markup: MENU, text: '✅ <b>Listo, ya estamos conectados.</b>\n\n' + AYUDA });
    } else await tgCall(c.token, 'sendMessage', { chat_id: chat, text: 'Para conectarme, toca el botón «Abrir en Telegram» desde la app de Importaciones.' });
    return new Response('ok');
  }
  if (chat !== c.chat) return new Response('ok'); // anyone else: ignore
  const data = await loadData(s);
  const reply = start ? AYUDA : await answer(data, text);
  await tgCall(c.token, 'sendMessage', { chat_id: chat, text: reply, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: MENU }).catch(() => {});
  return new Response('ok');
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const s = store();
  if (req.method === 'POST' && req.headers.get('x-telegram-bot-api-secret-token') !== null) return webhook(req, s);
  if (!(await authorized(req))) return json({ error: 'Clave incorrecta' }, 401);
  const c = await tgConf(s);
  const status = () => ({ bot: c.bot || null, linked: !!c.chat, link: c.bot && !c.chat && c.code ? 'https://t.me/' + c.bot + '?start=' + c.code : null });
  if (req.method === 'GET') return json(status());
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  let p; try { p = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  if (typeof p.token === 'string') {
    const token = p.token.trim();
    if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) return json({ error: 'Ese no parece un token de BotFather' }, 400);
    let me; try { me = await tgCall(token, 'getMe'); } catch (e) { return json({ error: 'Telegram no aceptó el token' }, 400); }
    const secret = rnd(32), code = rnd(12);
    try { await tgCall(token, 'setWebhook', { url: SITE + '/.netlify/functions/telegram', secret_token: secret, allowed_updates: ['message', 'edited_message'], drop_pending_updates: true }); }
    catch (e) { return json({ error: 'No se pudo conectar el bot: ' + e.message }, 502); }
    await tgCall(token, 'setMyCommands', { commands: [{ command: 'pendientes', description: 'Lo que tienes que hacer' }, { command: 'retirar', description: 'Qué retirar y cuánto llevar' }, { command: 'paquetes', description: 'Todo lo que está en camino' }, { command: 'ayuda', description: 'Qué sé hacer' }] }).catch(() => {});
    Object.assign(c, { token, secret, code, bot: me.username, chat: null }); await s.setJSON('tg', c);
    return json({ ok: true, ...status() });
  }
  if (p.test) return json({ ok: true, sent: await tgSend(s, '🔔 <b>Prueba</b>\nAsí te llegarán los avisos de tus pedidos.', { reply_markup: MENU }) });
  if (p.off) { if (c.token) await tgCall(c.token, 'deleteWebhook', {}).catch(() => {}); await s.setJSON('tg', {}); return json({ ok: true, bot: null, linked: false, link: null }); }
  return json({ error: 'Nada que hacer' }, 400);
};
