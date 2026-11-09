// Telegram helpers shared by notify() and the bot.
// Settings live in the 'tg' blob: { token, secret, code, bot, chat }.
const API = (t, m) => 'https://api.telegram.org/bot' + t + '/' + m;
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function tgCall(token, method, body) {
  const r = await fetch(API(token, method), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  if (!j || !j.ok) throw new Error((j && j.description) || 'HTTP ' + r.status);
  return j.result;
}
export const tgConf = async (s) => (await s.get('tg', { type: 'json' })) || {};

export const MENU = { keyboard: [[{ text: '📋 Pendientes' }, { text: '🏁 Por retirar' }], [{ text: '📦 Mis paquetes' }, { text: '❓ Ayuda' }]], resize_keyboard: true, is_persistent: true };

export async function tgSend(s, html, extra) {
  const c = await tgConf(s); if (!c.token || !c.chat) return 0;
  try { await tgCall(c.token, 'sendMessage', { chat_id: c.chat, text: html, parse_mode: 'HTML', disable_web_page_preview: true, ...(extra || {}) }); return 1; }
  catch (e) { return 0; }
}
// Push-style messages {title, body} -> one Telegram message each.
export async function tgNotify(s, msgs) {
  let n = 0; for (const m of msgs) n += await tgSend(s, '<b>' + esc(m.title) + '</b>\n' + esc(m.body || ''));
  return n;
}
