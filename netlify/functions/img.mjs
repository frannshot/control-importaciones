// Same-site copy of a product photo so the app can draw it into the order-detail image.
// GET /.netlify/functions/img?u=<https image url>
const MAX = 4 * 1024 * 1024;
export default async (req) => {
  const u = new URL(req.url).searchParams.get('u') || '';
  let url; try { url = new URL(u); } catch { return new Response('bad url', { status: 400 }); }
  if (url.protocol !== 'https:' || /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(url.hostname)) return new Response('bad url', { status: 400 });
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', accept: 'image/*' } });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !type.startsWith('image/')) return new Response('not an image', { status: 415 });
    const buf = await r.arrayBuffer();
    if (buf.byteLength > MAX) return new Response('too big', { status: 413 });
    return new Response(buf, { headers: { 'content-type': type, 'cache-control': 'public, max-age=604800', 'access-control-allow-origin': '*' } });
  } catch { return new Response('fetch failed', { status: 502 }); }
};
