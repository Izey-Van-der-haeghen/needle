/**
 * Is a URL listed in the site's sitemaps? Follows sitemap indexes, reading
 * at most `maxFiles` files, and compares URLs without #fragment, trailing slash
 * or host case. Reads every format Google accepts: XML sitemaps and indexes,
 * RSS 2.0 (and mRSS), Atom 1.0 and text files with one URL per line.
 */

import { urlKey } from "./urls.js";

// The shared URL key (no #fragment, no trailing slash on the path, host in lower case).
const norm = (u) => urlKey(String(u || "").trim()) || String(u || "").trim();

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/**
 * Decode the five XML entities and numeric character references (&#39; &#x27;), in one pass,
 * so "&amp;lt;" stays "&lt;". Also enough for URLs in HTML attributes.
 * @param {string} s
 * @returns {string}
 */
export function decodeEntities(s) {
  return String(s || "").replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e[0] !== "#") return XML_ENTITIES[e];
    const cp = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try { return String.fromCodePoint(cp); } catch { return m; }
  });
}

/**
 * The elements with this name and their text, from a CDATA section or plain text. "[" and "]"
 * are ordinary characters in both, as in "?filter[color]=red". A URL has no "<", so each try
 * reads no further than the next "<", and the text is taken whole and trimmed afterwards. The work
 * grows with the file and no faster: unclosed tags, CDATA sections or long runs of spaces can't
 * make this slow.
 * @param {string} xml
 * @param {string} name - "loc" or "link"
 * @returns {string[]} trimmed, entities decoded, empty ones left out
 */
function elementTexts(xml, name) {
  const re = new RegExp(`<${name}[^<>]*>(?:\\s*<!\\[CDATA\\[([^<]*?)\\]\\]>\\s*|([^<]*))</${name}>`, "gi");
  return [...String(xml || "").matchAll(re)].map((m) => decodeEntities((m[1] ?? m[2]).trim())).filter(Boolean);
}

/** Pull <loc> values out of a sitemap or sitemap index. */
export function readLocs(xml) {
  return elementTexts(xml, "loc");
}

/**
 * What kind of sitemap a fetched file is:
 *   "index" (sitemap index), "urlset" (XML sitemap), "rss" (RSS 2.0 or mRSS), "atom" (Atom 1.0),
 *   "text" (a .txt or text/plain file of URLs, one per line),
 *   "gzip" (a compressed file that arrived undecoded; it can't be read here),
 *   null for anything else, such as an HTML page or an empty answer.
 * @param {string} text
 * @param {string} [url]
 * @param {string} [contentType]
 * @returns {"index"|"urlset"|"rss"|"atom"|"text"|"gzip"|null}
 */
export function sitemapKind(text, url = "", contentType = "") {
  const t = String(text || "").replace(/^\uFEFF/, "");
  const path = (() => { try { return new URL(url).pathname; } catch { return ""; } })();
  if (/<sitemapindex[\s>]/i.test(t)) return "index";
  if (/<urlset[\s>]/i.test(t)) return "urlset";
  const head = t.slice(0, 2048);
  const html = /<html[\s>]/i.test(head);
  if (!html && /<rss[\s>]/i.test(head) && /<channel[\s>]/i.test(t)) return "rss";
  if (!html && /<feed[\s>][^>]*http:\/\/www\.w3\.org\/2005\/Atom/i.test(head)) return "atom";
  // Gzip starts with the bytes 1F 8B; decoded as text, 8B comes out as U+FFFD (or "‹" in windows-1252).
  // eslint-disable-next-line no-control-regex -- 0x1F 0x8B: the gzip magic bytes, as text decoding leaves them
  if (/^\x1f[\uFFFD\x8B\u2039]/.test(t) || /gzip/i.test(contentType) || (/\.gz$/i.test(path) && !/^\s*</.test(t))) return "gzip";
  if (/\.txt$/i.test(path) || /text\/plain/i.test(contentType)) {
    const lines = t.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length && lines.every((l) => /^https?:\/\/\S+$/i.test(l))) return "text";
  }
  return null;
}

/**
 * The URLs a sitemap file lists (for an index: the sitemaps it lists).
 * @param {string} text
 * @param {ReturnType<typeof sitemapKind>} kind
 * @returns {string[]}
 */
export function sitemapEntries(text, kind) {
  const t = String(text || "");
  if (kind === "index" || kind === "urlset") return readLocs(t);
  if (kind === "rss") {
    // Each <item>'s <link>; the channel's own <link> is the site, not a listed page.
    return [...t.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)]
      .map((m) => elementTexts(m[0], "link")[0])
      .filter(Boolean);
  }
  if (kind === "atom") {
    // Each <entry>'s page link: the <link> without rel, or with rel="alternate".
    return [...t.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)].map((m) => {
      const links = [...m[0].matchAll(/<link\b[^>]*>/gi)].map((l) => l[0]);
      const page = links.find((l) => !/\brel\s*=/i.test(l) || /\brel\s*=\s*["']?alternate["'\s/>]/i.test(l));
      return page?.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i)?.slice(1).find((v) => v != null);
    }).filter(Boolean).map(decodeEntities);
  }
  if (kind === "text") return t.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
  return [];
}

/**
 * @param {string} pageUrl
 * @param {string[]} startUrls - sitemaps from robots.txt, or /sitemap.xml
 * @param {(reqs: Array<{url: string, maxBytes?: number}>) => Promise<Array<{ok: boolean, status: number, text?: string, headers?: Record<string, string>}>>} fetcher
 * @param {{maxFiles?: number}} [opts]
 * @returns {Promise<{found: boolean, sitemap: string|null, filesRead: number, unread: number, complete: boolean, unreadable: boolean}>}
 *   unread: files that answered with an error or could not be fetched; unreadable: none could be read at all.
 */
export async function findInSitemaps(pageUrl, startUrls, fetcher, { maxFiles = 15 } = {}) {
  const target = norm(pageUrl);
  const queue = [...new Set(startUrls)];
  const seen = new Set();
  let filesRead = 0;
  let unread = 0;
  while (queue.length && filesRead < maxFiles) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const [r] = await fetcher([{ url, maxBytes: 10 * 1024 * 1024 }]);
    filesRead++;
    if (!r?.ok || !r.text) { unread++; continue; }
    const kind = sitemapKind(r.text, url, r.headers?.["content-type"]);
    // A .xml.gz file that arrives as binary can't be read, and some servers answer 200 with an HTML page.
    if (!kind || kind === "gzip") { unread++; continue; }
    const locs = sitemapEntries(r.text, kind);
    if (kind === "index") queue.push(...locs.filter((l) => !seen.has(l)));
    else if (locs.some((l) => norm(l) === target)) return { found: true, sitemap: url, filesRead, unread, complete: true, unreadable: false };
    // Cut off at 10 MB: the page may be in the part that wasn't read.
    if (r.truncated) unread++;
  }
  return { found: false, sitemap: null, filesRead, unread, complete: queue.length === 0 && unread === 0, unreadable: filesRead > 0 && unread === filesRead };
}
