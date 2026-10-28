// Fetches a web page and returns its exact text (no AI summarizing), plus citation metadata.
'use strict';

function decodeEntities(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&rsquo;|&lsquo;/g, '’').replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&hellip;/g, '…')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function htmlToText(html) {
  return decodeEntities(html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|section|article|tr|figcaption|header|footer)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t\f\v ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function metaFrom(html) {
  const get = (re) => { const m = html.match(re); return m ? decodeEntities(m[1]).trim() : ''; };
  const meta = (name) => get(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']+)`, 'i'))
    || get(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:name|property)=["']${name}["']`, 'i'));
  return {
    title: meta('og:title') || meta('citation_title') || get(/<title[^>]*>([^<]+)/i),
    author: meta('author') || meta('citation_author') || meta('article:author') || meta('parsely-author')
      || get(/"author"\s*:\s*\[?\s*\{[^}]*"name"\s*:\s*"([^"]+)"/),
    published: meta('article:published_time') || meta('citation_publication_date') || meta('date')
      || meta('parsely-pub-date') || get(/"datePublished"\s*:\s*"([^"]+)"/) || get(/<time[^>]+datetime=["']([^"']+)/i),
    modified: meta('article:modified_time') || get(/"dateModified"\s*:\s*"([^"]+)"/),
    siteName: meta('og:site_name'),
  };
}

async function fetchPage(url, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' } });
    const type = res.headers.get('content-type') || '';
    const out = { status: res.status, ok: res.ok, finalUrl: res.url, type, html: '', text: '', meta: {} };
    if (type.includes('pdf')) return out;
    out.html = await res.text();
    out.meta = metaFrom(out.html);
    out.text = htmlToText(mainContent(out.html));
    return out;
  } finally { clearTimeout(t); }
}

// The article body only (skips menus, footers and "related stories"), so Claude reads less.
function mainContent(html) {
  const pick = (tag) => {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    let best = '', m;
    while ((m = re.exec(html))) if (m[1].length > best.length) best = m[1];
    return best;
  };
  // keep the headline and byline/author boxes, which often sit outside <article>
  const head = (html.match(/<h1\b[\s\S]*?<\/h1>/i) || [''])[0]
    + (html.match(/<(div|p|span|section)\b[^>]*class=["'][^"']*(byline|author)[^"']*["'][^>]*>[\s\S]{0,800}?<\/\1>/gi) || []).slice(0, 3).join('\n');
  for (const tag of ['article', 'main']) {
    const body = pick(tag);
    if (htmlToText(body).length > 1500) return head + body;
  }
  return html;
}

module.exports = { fetchPage, htmlToText, metaFrom, decodeEntities };
