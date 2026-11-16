// Inbox: every e-mail the Gmail scripts send (Gold Coast, Amazon, Binance Card) is kept here
// so the app can show it. Index in 'mail-index'; each body in 'mail/<id>'.
import { toText } from './gc-parse.mjs';
import { parseBinance } from './amazon.mjs';

const MAX = 400;              // newest e-mails kept
const NOTIFY_WINDOW = 3 * 3600e3; // only e-mails younger than this ring the phone (no flood when old ones sync)
const SECRET = /(c[oó]digo|code|verif|otp|contrase|password|inicio de sesi|login|sign[- ]?in|2fa|autenticaci|authenticat)/i;

export const LABEL = { goldcoast: 'Gold Coast', amazon: 'Amazon', binance: 'Binance' };
const money = (v) => '$' + Number(v).toFixed(2);
const addr = (s) => { const m = String(s || '').match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/); return m ? m[0].toLowerCase() : null; };

const BOILER = [
  /CLICK AQU[ÍI]:?\s*SISTEMA DE RASTREO/gi,
  /GOLD COAST CUSTOMS EXPRESS, CORP\.?\s*1335 NW 98th CT,? Unit 2 Doral,? Florida 33172,? USA Phone:?\s*\+?1-786-452-9090\s*https?:\/\/goldcoastus\.com/gi,
  /Stephy Tracking®?[\s\S]*$/i, /UnSubscribe/gi, /You're receiving this email[\s\S]*$/i,
];
function cleanText(em) {
  let t = em.html ? toText(em.html) : String(em.body || '').replace(/\s+/g, ' ').trim();
  if (/[{}]/.test(t.slice(0, 400)) && /CLICK AQU/i.test(t)) t = t.slice(t.search(/CLICK AQU/i)); // CSS left in plain text
  for (const re of BOILER) t = t.replace(re, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

function refsOf(kind, subject, text) {
  const all = subject + ' ' + text;
  const pedidos = [...new Set(all.match(/\b\d{3}-\d{7}-\d{7}\b/g) || [])];
  const trackings = [...new Set((all.match(/\b[A-Z0-9]{10,34}\b/gi) || [])
    .map((x) => x.toUpperCase()).filter((x) => /\d{8,}/.test(x) && !/^\d{3}\d{7}\d{7}$/.test(x)))].slice(0, 12);
  const recibos = kind !== 'goldcoast' ? [] : [...new Set([
    ...[...all.matchAll(/(?:Recibos?\s*#?\s*:?\s*|Factura\s+)(\d{6})\b/gi)].map((m) => m[1]),
    ...[...all.matchAll(/\b(\d{6})-\d{1,2}\b/g)].map((m) => m[1]),
  ])];
  return { pedidos, trackings, recibos };
}

// Title and line used both in the inbox and in the notification.
function summary(kind, subject, text, em) {
  if (kind === 'goldcoast') {
    if (/recibo de pago/i.test(subject)) {
      const tot = text.match(/Total Pagado\s*\$\s*([\d,]+\.\d{2})/i); const n = (text.match(/\b\d{6}-\d{1,2}\s+\d{2}\/\d{2}\/\d{4}/g) || []).length;
      return { t: '💵 Pago registrado en Gold Coast', b: (tot ? 'Total pagado $' + tot[1] : 'Recibo de pago') + (n ? ' · ' + n + (n === 1 ? ' factura' : ' facturas') : '') };
    }
    if (/instrucciones|instructions/i.test(subject)) {
      const r = text.match(/Recibos?:\s*(\d{6})/i); const v = text.match(/Valor Declarado:\s*\$\s*([\d,]+(?:\.\d+)?)/i);
      return { t: '📋 Instrucciones de envío', b: [r && 'Recibo ' + r[1], v && 'Valor declarado $' + v[1]].filter(Boolean).join(' · ') || subject };
    }
    if (/^\s*tracking\b/i.test(subject)) {
      const tr = subject.replace(/^\s*tracking\s*/i, '').trim();
      return { t: '✅ Gold Coast registró tu tracking', b: tr + (/received/i.test(text) ? ' · recibido, en proceso' : '') };
    }
    const rec = subject.match(/Recibo\s*#\s*(\d+)/i);
    if (rec) { const c = text.match(/\d+(?:\.\d+)?\s*LB\s+([A-Z0-9ÁÉÍÓÚÑ ]{3,40}?)\s+Trackings?:/); return { t: '📦 Recibo de Gold Coast ' + rec[1], b: (c ? c[1].trim().toLowerCase() + ' · ' : '') + 'llegó a Miami' }; }
    if (/factura/i.test(subject)) { const f = text.match(/Factura\s+(\d{6}-\d+)/i); const tot = text.match(/Total:\s*\$\s*([\d,]+\.\d{2})/i); return { t: '🧾 Factura de Gold Coast' + (f ? ' ' + f[1] : ''), b: tot ? 'Total $' + tot[1] : subject }; }
    return { t: '✉️ Gold Coast', b: subject };
  }
  if (kind === 'binance') {
    const c = parseBinance(em);
    return { t: '💳 Binance Card', b: c ? 'Pagaste ' + (c.moneda === 'USD' ? money(c.monto) : c.monto + ' ' + c.moneda) + ' en ' + c.comercio : subject };
  }
  return { t: '🛒 Amazon', b: subject };
}

const index = async (s) => (await s.get('mail-index', { type: 'json' })) || {};

// Saves new e-mails; returns the entries that are new (with .notify set when recent).
export async function storeMails(s, emails, kindOf) {
  const idx = await index(s); const fresh = [];
  for (const em of emails) {
    const kind = kindOf(em); if (!LABEL[kind] || !em.id) continue;
    const subject = String(em.subject || '');
    if (SECRET.test(subject)) continue;
    const text = cleanText(em);
    const sum = summary(kind, subject, text, em);
    const known = idx[em.id];
    const entry = {
      id: em.id, kind, subject, date: em.date || new Date().toISOString(),
      from: String(em.from || '').replace(/<[^>]*>/g, '').replace(/"/g, '').trim() || LABEL[kind],
      acct: addr(em.to), title: sum.t, line: sum.b, snippet: text.slice(0, 220),
      refs: refsOf(kind, subject, text),
      monto: kind === 'binance' ? ((parseBinance(em) || {}).monto ?? null) : null,
      r: known ? known.r : 0,
    };
    idx[em.id] = entry;
    const html = String(em.html || '').replace(/<script[\s\S]*?<\/script>/gi, '').slice(0, 400000);
    await s.setJSON('mail/' + em.id, { html, text: html ? null : String(em.body || '').slice(0, 60000) });
    if (!known) fresh.push({ ...entry, notify: Date.now() - new Date(entry.date).getTime() < NOTIFY_WINDOW });
  }
  const keys = Object.keys(idx).sort((a, b) => String(idx[b].date).localeCompare(String(idx[a].date)));
  for (const k of keys.slice(MAX)) { delete idx[k]; await s.delete('mail/' + k).catch(() => {}); }
  if (emails.length) await s.setJSON('mail-index', idx);
  return fresh;
}

// One notification per new e-mail, unless that e-mail already produced a richer notice
// (Llegó a Miami, Factura, Cobrado), so you never get two for the same thing.
export function mailMessages(fresh, specific) {
  const hasDoc = specific.some((m) => /Llegó a Miami|Factura de Gold Coast/.test(m.title));
  const hasCharge = specific.some((m) => /^💳 Cobrado/.test(m.title));
  return fresh.filter((m) => m.notify).filter((m) => {
    if (m.kind === 'goldcoast' && /(Recibo\s*#|^\s*Factura)/i.test(m.subject) && hasDoc) return false;
    if (m.kind === 'amazon' && /^\s*(enviad|shipped)/i.test(m.subject) && hasCharge) return false;
    if (m.kind === 'binance' && /amazon/i.test(m.line) && hasCharge) return false;
    return true;
  }).map((m) => ({ title: m.title, body: m.line, tag: 'mail-' + m.id, url: './?correo=' + encodeURIComponent(m.id) }));
}

export const listMails = async (s) => Object.values(await index(s)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
export const getMail = async (s, id) => { const idx = await index(s); const m = idx[id]; if (!m) return null; return { ...m, ...((await s.get('mail/' + id, { type: 'json' })) || {}) }; };
export async function markRead(s, ids, all) {
  const idx = await index(s); let n = 0;
  for (const m of Object.values(idx)) if ((all || ids.includes(m.id)) && !m.r) { m.r = 1; n++; }
  if (n) await s.setJSON('mail-index', idx);
  return n;
}
