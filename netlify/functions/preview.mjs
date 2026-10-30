// Product link preview: follows short links (a.co, amzn.to...), then extracts
// the product image and name. Amazon gets dedicated extraction; other stores
// use Open Graph / Twitter meta tags.

const UAS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
];

const json = (body, status = 200, cache = true) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': cache ? 'public, max-age=86400' : 'no-store',
  },
});

const decode = (s) => String(s || '')
  .replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

export const amazonAsin = (u) => {
  try {
    const url = new URL(u);
    if (!/(^|\.)amazon\./i.test(url.hostname)) return null;
    const m = url.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin|o\/ASIN)\/([A-Z0-9]{10})(?:[/?]|$)/i);
    return m ? m[1].toUpperCase() : null;
  } catch { return null; }
};

const meta = (html, names) => {
  for (const name of names) {
    const re1 = new RegExp('<meta[^>]+(?:property|name)=["\']' + name + '["\'][^>]*content=["\']([^"\']+)["\']', 'i');
    const re2 = new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name)=["\']' + name + '["\']', 'i');
    const m = html.match(re1) || html.match(re2);
    if (m) return decode(m[1]);
  }
  return null;
};

const firstMatch = (html, regexes) => {
  for (const re of regexes) { const m = html.match(re); if (m && m[1]) return m[1]; }
  return null;
};

export function extractAmazon(html) {
  let image = firstMatch(html, [
    /"hiRes":"(https:\/\/[^"]+?\.(?:jpg|jpeg|png|webp))"/i,
    /data-old-hires="(https:\/\/[^"]+)"/i,
    /"large":"(https:\/\/[^"]+?\.(?:jpg|jpeg|png|webp))"/i,
    /"mainUrl":"(https:\/\/[^"]+?\.(?:jpg|jpeg|png|webp))"/i,
    /data-a-hires="(https:\/\/[^"]+)"/i,
    /<img[^>]+id="(?:landingImage|imgBlkFront|ebooksImgBlkFront|main-image)"[^>]*src="(https:\/\/[^"]+)"/i,
    /<img[^>]+src="(https:\/\/[^"]+)"[^>]*id="(?:landingImage|imgBlkFront|ebooksImgBlkFront|main-image)"/i,
  ]);
  if (!image) {
    const dyn = html.match(/data-a-dynamic-image="([^"]+)"/i);
    if (dyn) { try { const obj = JSON.parse(decode(dyn[1])); const keys = Object.keys(obj); if (keys.length) image = keys.sort((a, b) => (obj[b][0] || 0) - (obj[a][0] || 0))[0]; } catch { /* ignore */ } }
  }
  if (!image) image = meta(html, ['og:image']);
  if (image && /^data:/i.test(image)) image = null;
  let title = firstMatch(html, [/<span[^>]+id="productTitle"[^>]*>([\s\S]*?)<\/span>/i, /<span[^>]+id="title"[^>]*>([\s\S]*?)<\/span>/i]);
  title = title ? decode(title.replace(/<[^>]+>/g, '')) : null;
  if (!title) {
    const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (t) title = decode(t[1]).replace(/^Amazon\.[a-z.]+\s*:\s*/i, '').replace(/\s*:\s*Amazon\.[a-z.]+.*$/i, '');
  }
  return { image: image ? decode(image) : null, title: title || null };
}

export function extractGeneric(html, base) {
  let image = meta(html, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']);
  if (!image) { const m = html.match(/<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i); if (m) image = decode(m[1]); }
  let title = meta(html, ['og:title', 'twitter:title']);
  if (!title) { const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i); if (t) title = decode(t[1]); }
  if (image) { try { image = new URL(image, base).href; } catch { image = null; } }
  return { image, title };
}

const looksBlocked = (html) => /captcha|validateCaptcha|Robot Check|automated access|To discuss automated access/i.test(html) && !/id="productTitle"/i.test(html);

async function grab(url, ua) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 9000);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ac.signal,
      headers: {
        'user-agent': ua,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9,es;q=0.8',
      },
    });
    const html = (await res.text()).slice(0, 3_000_000);
    return { finalUrl: res.url || url, status: res.status, html };
  } finally { clearTimeout(to); }
}

async function resolveShort(start) {
  let cur = start; const hops = [];
  for (let i = 0; i < 6; i++) {
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 7000);
    let res;
    try { res = await fetch(cur, { redirect: 'manual', signal: ac.signal, headers: { 'user-agent': UAS[0], accept: 'text/html,*/*' } }); }
    catch (e) { hops.push({ cur, err: String(e) }); break; } finally { clearTimeout(to); }
    const loc = res.headers.get('location');
    hops.push({ cur, status: res.status, loc });
    if (loc && res.status >= 300 && res.status < 400) { cur = new URL(loc, cur).href; if (amazonAsin(cur)) return { url: cur, hops }; continue; }
    const html = (await res.text()).slice(0, 400000);
    const m = html.match(/https?:\/\/(?:www\.)?amazon\.[a-z.]+\/[^"'\s<>]*?\/(?:dp|gp\/product|gp\/aw\/d)\/[A-Z0-9]{10}[^"'\s<>]*/i)
      || html.match(/(?:url=|href=")(https?:\/\/[^"'\s<>]+)/i);
    if (m) { const found = decode(m[1] || m[0]); return { url: found, hops, from: 'html' }; }
    hops.push({ snippet: html.slice(0, 300) });
    break;
  }
  return { url: amazonAsin(cur) ? cur : null, hops };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET', 'access-control-allow-headers': '*' } });
  const target = new URL(req.url).searchParams.get('url');
  let url;
  try { url = new URL(target); if (!/^https?:$/.test(url.protocol)) throw new Error(); } catch { return json({ error: 'Enlace no válido' }, 400, false); }

  const debug = new URL(req.url).searchParams.get('debug') === '1';
  // Short links (a.co, amzn.to, amzn.eu…): resolve them by hand first.
  if (/^(a\.co|amzn\.(to|eu|asia)|amzn\.com)$/i.test(url.hostname)) {
    const resolved = await resolveShort(url.href);
    if (debug) return json({ debug: resolved }, 200, false);
    if (resolved.url) url = new URL(resolved.url);
  }
  let last = null;
  for (const ua of UAS) {
    try {
      const r = await grab(url.href, ua);
      last = r;
      const asin = amazonAsin(r.finalUrl) || amazonAsin(url.href);
      if (asin || /(^|\.)amazon\./i.test(new URL(r.finalUrl).hostname)) {
        if (looksBlocked(r.html)) continue;
        const a = extractAmazon(r.html);
        if (a.image || a.title) return json({ url: r.finalUrl, asin, title: a.title, image: a.image });
        continue;
      }
      const g = extractGeneric(r.html, r.finalUrl);
      return json({ url: r.finalUrl, asin: null, title: g.title, image: g.image });
    } catch { /* try next UA */ }
  }
  const finalUrl = last ? last.finalUrl : url.href;
  return json({ url: finalUrl, asin: amazonAsin(finalUrl), title: null, image: null, blocked: true }, 200, false);
};
