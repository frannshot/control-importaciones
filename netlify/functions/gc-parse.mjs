// Parses Gold Coast Customs Express e-mails (receipts and invoices) into plain data.
// Works on the HTML body, the plain-text body, or Gmail's table-like text.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function toText(src) {
  return String(src || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(td|th|tr|p|div|li|h\d)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENT[n.toLowerCase()] ?? m))
    .replace(/\[\]\([^)]*\)/g, ' ')
    .replace(/[|* ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const iso = (mm, dd, yyyy) => `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
const num = (s) => (s == null ? null : Number(String(s).replace(/,/g, '')));

function weights(t) {
  const m = t.match(/([\d.]+)\s*LB\s*\/\s*[\d.]+\s*KG\s+([\d.]+)\s*LB\s*\/\s*[\d.]+\s*KG\s+([\d.]+)\s*CUFT/i);
  return m ? { peso_real: num(m[1]), peso_vol: num(m[2]), volumen: num(m[3]) } : {};
}
const embarqueOf = (t) => { const m = t.match(/\b([A-Z]{3}_\d{1,2}_\d{4}_[A-Z0-9_]+)\b/); return m ? m[1] : null; };
const trackTokens = (s) => [...new Set((String(s || '').match(/\b[A-Z0-9]{10,34}\b/gi) || []).filter((x) => /\d{6,}/.test(x)).map((x) => x.toUpperCase()))];

export function parseEmail({ subject = '', html = '', body = '', date = null }) {
  const t = toText(html || body);
  const out = [];
  // Invoices (one e-mail can hold several)
  const fre = /Factura\s+(\d{5,})-(\d+)\s+(\d{2})\/(\d{2})\/(\d{4})/g;
  const heads = [...t.matchAll(fre)];
  heads.forEach((m, i) => {
    const part = t.slice(m.index, i + 1 < heads.length ? heads[i + 1].index : undefined);
    const cob = part.match(/(?:AEREO|MARITIMO|MAR[IÍ]TIMO)[A-Z ]*:\s*([\d.]+)\s*(LB|CUFT|FT3)/i);
    const tot = part.match(/Total:\s*\$\s*([\d,]+\.\d{2})/i);
    const notas = (part.match(/Notas:\s*(.+?)\s+Powered by/i) || [])[1] || null;
    out.push({
      tipo: 'factura', id: 'factura-' + m[1] + '-' + m[2], factura: m[1] + '-' + m[2], recibo: m[1],
      fecha: iso(m[3], m[4], m[5]), ...weights(part), embarque: embarqueOf(part),
      metodo: /\bVia\b[\s\S]{0,60}\bOcean\b|MARITIMO|MAR[IÍ]TIMO/i.test(part) ? 'maritimo' : 'aereo',
      cobrado: cob ? num(cob[1]) : null, cobrado_unidad: cob ? cob[2].toUpperCase() : null,
      minimo: /MINIMUM/i.test(part), total: tot ? num(tot[1]) : null,
      notas, trackings: trackTokens(notas), email_date: date,
    });
  });
  // Receipts
  const rre = /Recibo\s+(\d{5,})\s+(\d{2})\/(\d{2})\/(\d{4})/g;
  const rheads = [...t.matchAll(rre)];
  rheads.forEach((m, i) => {
    const part = t.slice(m.index, i + 1 < rheads.length ? rheads[i + 1].index : undefined);
    const trk = (part.match(/Trackings?:\s*(.+?)\s+(?:Item from|Powered by|TODO ENVIO)/i) || [])[1] || '';
    const dims = part.match(/([\d.]+)"\s+([\d.]+)"\s+([\d.]+)"/);
    const after = dims ? part.slice(dims.index + dims[0].length) : part;
    const cont = (after.match(/^\s*\d+\s+[A-Za-z]+\s+[\d.]+\s*LB\s+(.+?)\s+Trackings?:/i) || [])[1] || null;
    out.push({
      tipo: 'recibo', id: 'recibo-' + m[1], recibo: m[1], fecha: iso(m[2], m[3], m[4]), ...weights(part),
      transporte: (part.match(/Transporte:\s*([A-Z0-9]+)/i) || [])[1] || null,
      valor_declarado: num((part.match(/Valor Declarado:\s*\$\s*([\d,]+(?:\.\d+)?)/i) || [])[1]),
      tienda: ((part.match(/Item from:\s*([A-Z0-9 .&'-]+?)(?=\s+(?:Powered|TODO|$))/i) || [])[1] || '').trim() || null,
      contenido: cont && cont.trim() ? cont.trim() : null,
      dims: dims ? [num(dims[1]), num(dims[2]), num(dims[3])] : null,
      trackings: trackTokens(trk), actualizado: /actualizado/i.test(subject), email_date: date,
    });
  });
  return out;
}
