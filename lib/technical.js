import { isAllowedByRobots, robotsSitemaps, ROBOTS_MAX_BYTES } from "./robots.js";
import { HTML_SNIPPET_BYTES } from "./constants.js";
import { withoutTracking } from "./urls.js";
import { countWords } from "./words.js";
import { sitemapKind, sitemapEntries, decodeEntities } from "./sitemap-check.js";


const INTERESTING_HEADERS = [
  "content-type",
  "content-encoding",
  "server",
  "x-robots-tag",
  "cache-control",
  "strict-transport-security",
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "link"
];

const PAGE_MAX_BYTES = 3 * 1024 * 1024;
const SITEMAP_MAX_BYTES = 5 * 1024 * 1024;

/**
 * @typedef {import("./page-fetch.js").FetchRequest} FetchRequest
 * @typedef {import("./page-fetch.js").FetchResult} FetchResult
 * @typedef {(requests: FetchRequest[]) => Promise<FetchResult[]>} Fetcher
 */

/**
 * @typedef {Object} TechnicalReport
 * @property {number} status - HTTP status of the page (0 = could not fetch)
 * @property {string} finalUrl - URL after following redirects
 * @property {boolean} redirected - the audited URL itself redirects
 * @property {string|null} fetchError
 * @property {Record<string, string>} headers - subset of interesting headers
 * @property {{ok: boolean, status?: number, error?: string, text?: string, sitemaps: string[],
 *            pathAllowed: {allowed: boolean, rule: string|null}|null}} robotsTxt
 *   pathAllowed is null when robots.txt answered 5xx/429 or could not be fetched:
 *   Google then pauses crawling instead of treating the site as allowed.
 * @property {{ok: boolean, status?: number, urlCount?: number, isIndex?: boolean, url?: string,
 *            format?: "xml"|"rss"|"atom"|"text", truncated?: boolean, reason?: string, unchecked?: boolean}} sitemap
 *   unchecked: the sitemap exists but can't be read from here (on another site, or compressed);
 *   that is no sign of a problem.
 * @property {{htmlLen: number, htmlSnippet: string, wordCount: number, headings: number,
 *            links: number, schema: number, robots: string, canonical: string}|null} raw - the HTML as served, before JavaScript
 */

/**
 * Technical audit of one URL: status, headers, robots.txt, sitemap and the raw
 * (server-sent) HTML. All requests go through `fetcher`, which in the extension
 * runs them inside the audited tab (see lib/page-fetch.js).
 * @param {string} url
 * @param {Fetcher} fetcher
 * @returns {Promise<TechnicalReport>}
 */
export async function analyzeTechnical(url, fetcher) {
  const u = new URL(url);
  u.hash = "";
  const pageUrl = u.href;
  const origin = u.origin;

  const [main, robotsRes] = await fetcher([
    { url: pageUrl, maxBytes: PAGE_MAX_BYTES },
    { url: `${origin}/robots.txt`, maxBytes: ROBOTS_MAX_BYTES }
  ]);

  const robotsTxt = readRobots(robotsRes);
  // A campaign link (?utm_…) is the same page: judge the page's own path, as Google crawls it.
  const clean = new URL(withoutTracking(pageUrl));
  robotsTxt.pathAllowed = robotsPathVerdict(robotsTxt, clean.pathname + clean.search);

  const candidates = robotsTxt.sitemaps.length ? orderSitemaps(robotsTxt.sitemaps, u) : [`${origin}/sitemap.xml`];
  const sitemap = await fetchSitemap(candidates, fetcher, origin, robotsTxt.sitemaps.length > 0);

  const headers = {};
  for (const name of INTERESTING_HEADERS) {
    const v = main?.headers?.[name];
    if (v) headers[name] = v;
  }

  return {
    status: main?.status || 0,
    finalUrl: main?.url || pageUrl,
    redirected: !!main?.redirected && (main?.url || pageUrl) !== pageUrl,
    fetchError: main?.status ? null : (main?.error || "Could not fetch the page"),
    headers,
    robotsTxt,
    sitemap,
    raw: main?.status ? rawSnapshot(main.text || "", main.url || pageUrl) : null
  };
}

/**
 * Interpret the robots.txt response.
 * @param {FetchResult} r
 */
export function readRobots(r) {
  if (!r || !r.status) {
    return { ok: false, status: 0, error: r?.error || "Could not fetch robots.txt", sitemaps: [] };
  }
  const looksLikeHtml = /text\/html/i.test(r.headers?.["content-type"] || "") && /^\s*</.test(r.text || "");
  if (r.ok && !looksLikeHtml) {
    return { ok: true, status: r.status, text: r.text || "", sitemaps: robotsSitemaps(r.text) };
  }
  // A 200 that serves an HTML page is a soft 404: Google treats it as a robots.txt
  // with no valid rules, which means "allow all".
  return { ok: false, status: r.ok ? 404 : r.status, softNotFound: r.ok && looksLikeHtml, sitemaps: [] };
}

/**
 * Googlebot's verdict for a path. Missing robots.txt (4xx) means "allow all";
 * a server error, 429 or network failure means Google pauses crawling, so
 * there is no verdict (null).
 * @returns {{allowed: boolean, rule: string|null}|null}
 */
export function robotsPathVerdict(robotsTxt, path) {
  if (robotsTxt.ok) return isAllowedByRobots(robotsTxt.text || "", path, "googlebot");
  const s = robotsTxt.status || 0;
  if (s >= 400 && s < 500 && s !== 429) return { allowed: true, rule: null };
  return null;
}

/** Put sitemaps that share the page's first path segment (e.g. /en-gb/) first. */
function orderSitemaps(list, u) {
  const seg = u.pathname.split("/").filter(Boolean)[0];
  if (!seg) return list;
  const mine = list.filter(s => { try { return new URL(s).pathname.startsWith(`/${seg}/`); } catch { return false; } });
  return [...mine, ...list.filter(s => !mine.includes(s))];
}

async function fetchSitemap(candidates, fetcher, origin, listed = true) {
  const sameOrigin = [];
  const other = [];
  for (const c of candidates) {
    try {
      const href = new URL(c).href;
      (new URL(href).origin === origin ? sameOrigin : other).push(href);
    } catch {}
  }
  const tryList = [...sameOrigin, ...other].slice(0, 3);
  // A sitemap that fails is reported before one that can't be read from here.
  let failed = null;
  let unchecked = null;
  for (const url of tryList) {
    const [r] = await fetcher([{ url, maxBytes: SITEMAP_MAX_BYTES }]);
    if (!r?.status) {
      // Google accepts a sitemap on another host; the browser only lets Needle read it when that site allows it.
      if (new URL(url).origin !== origin) unchecked ||= { ok: false, status: 0, url, unchecked: true, reason: "on another site, not checked" };
      else failed ||= { ok: false, status: 0, url, reason: r?.error || "network error" };
      continue;
    }
    if (listed && [401, 403, 429].includes(r.status)) { unchecked ||= { ok: false, status: r.status, url, unchecked: true, reason: `refused the check (HTTP ${r.status})` }; continue; }
    if (!r.ok) { failed ||= { ok: false, status: r.status, url, reason: `HTTP ${r.status}` }; continue; }
    const text = r.text || "";
    const kind = sitemapKind(text, url, r.headers?.["content-type"]);
    if (kind === "gzip") { unchecked ||= { ok: false, status: r.status, url, unchecked: true, reason: "compressed (.gz), not checked" }; continue; }
    if (!kind) { failed ||= { ok: false, status: r.status, url, reason: "not a sitemap (HTML or empty)" }; continue; }
    return {
      ok: true,
      status: r.status,
      url,
      format: { index: "xml", urlset: "xml" }[kind] || kind,
      urlCount: sitemapEntries(text, kind).length,
      isIndex: kind === "index",
      truncated: !!r.truncated
    };
  }
  return failed || unchecked || { ok: false, status: 404, reason: "not found" };
}

/**
 * Coarse counts of the HTML as served (before JavaScript runs), with its robots metas and
 * canonical, to compare with the page after JavaScript.
 * @param {string} text
 * @param {string} [pageUrl] - resolves a relative canonical
 */
export function rawSnapshot(text, pageUrl = "") {
  const { robots, canonical } = serverIndexingTags(text, pageUrl);
  return {
    htmlLen: text.length,
    htmlSnippet: text.slice(0, HTML_SNIPPET_BYTES),
    wordCount: extractWordCount(text),
    headings: (text.match(/<h[1-6][\s>]/gi) || []).length,
    // [^<>]: each try stops at the next tag, so thousands of "<a " without ">" can't freeze the popup.
    links: (text.match(/<a\s[^<>]*href=/gi) || []).length,
    schema: (text.match(/application\/ld\+json/gi) || []).length,
    robots,
    canonical,
    // A bot wall or captcha page sent instead of the page (Needle fetches without cookies). Its
    // noindex and canonical are the wall's, not the page's.
    challenge: BOT_WALL.test(text.slice(0, 20000))
  };
}

// Only what the wall pages themselves carry: Cloudflare, DataDome, PerimeterX and Incapsula also put
// scripts on ordinary pages, so their names alone don't mean a wall.
const BOT_WALL = /_cf_chl_opt|cf-chl-|<title>\s*(just a moment|attention required|access denied|checking your browser|request unsuccessful)|captcha-delivery\.com|id="px-captcha"|sucuri_cloudproxy_js/i;

/** The attributes of one start tag, names in lower case and values decoded. */
function tagAttributes(tag) {
  const attrs = {};
  const inner = tag.replace(/^<[a-z]+/i, "").replace(/\/?>$/, "");
  for (const m of inner.matchAll(/([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = m[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

const TAG_MAX = 4096;

/**
 * The attributes of every <name …> start tag in html. A ">" inside a quoted value doesn't end
 * the tag, as in the HTML tokenizer. Linear in the length of html: a tag that doesn't close
 * within 4 KB is skipped, so a hostile page can't freeze the popup.
 */
function startTags(html, name) {
  const out = [];
  const open = new RegExp(`<${name}(?=[\\s/>])`, "gi");
  let m;
  while ((m = open.exec(html))) {
    const stop = Math.min(html.length, m.index + TAG_MAX);
    let i = m.index + m[0].length;
    let quote = "";
    let afterEquals = false;
    for (; i < stop; i++) {
      const c = html[i];
      if (quote) { if (c === quote) quote = ""; continue; }
      if (c === ">") break;
      if (afterEquals && (c === '"' || c === "'")) { quote = c; afterEquals = false; }
      else if (c === "=") afterEquals = true;
      else if (!/\s/.test(c)) afterEquals = false;
    }
    if (i >= stop) { open.lastIndex = stop; continue; }
    out.push(tagAttributes(html.slice(m.index, i + 1)));
    open.lastIndex = i + 1;
  }
  return out;
}

/**
 * What the server HTML says about indexing, read as the page in the tab is read (content.js):
 * the robots and googlebot metas anywhere in the document, joined with ", ", and the first
 * rel=canonical in <head>, made absolute (against <base href> when there is one). Comments,
 * scripts, templates and noscript don't count: they are no elements in the rendered page. One
 * that isn't closed runs to the end of the HTML, as in the browser. Linear in the length of html.
 * @param {string} html
 * @param {string} pageUrl
 * @returns {{robots: string, canonical: string}}
 */
export function serverIndexingTags(html, pageUrl) {
  const doc = withoutHidden(String(html || ""), ["script", "style", "template", "noscript", "textarea", "title"], "\\s*");
  // As content.js reads them: robots first, then googlebot and Bing's tags under their own name.
  const metas = startTags(doc, "meta");
  const contentOf = (re, prefix = "") => metas.filter((a) => re.test(a.name || "")).map((a) => (a.content || "").trim()).filter(Boolean).map((c) => prefix + c);
  const robots = [...contentOf(/^robots$/i), ...contentOf(/^googlebot$/i, "googlebot: "), ...contentOf(/^(bingbot|msnbot)$/i, "bingbot: ")].join(", ");
  const end = doc.search(/<\/head\s*>|<body[\s>]/i);
  const head = end < 0 ? doc : doc.slice(0, end);
  const href = startTags(head, "link").find((a) => (a.rel || "").toLowerCase().split(/\s+/).includes("canonical"))?.href?.trim();
  let canonical = "";
  if (href) {
    const base = startTags(head, "base").find((a) => a.href)?.href;
    try { canonical = new URL(href, base ? new URL(base, pageUrl).href : pageUrl).href; } catch {}
  }
  return { robots, canonical };
}

/**
 * html with every comment and every element named in `names` replaced by a space, read left to
 * right as the HTML parser reads them: a "<!--" inside a script is script text, and a comment or
 * element that isn't closed runs to the end of the text. Each search starts where the last one
 * ended and an open end stops the scan, so the work grows with the length of html and no faster:
 * thousands of unclosed "<!--" or "<script" can't freeze the popup.
 * @param {string} html
 * @param {string[]} names - in lower case
 * @param {string} space - "\\s*" when "</script >" ends a script too, "" when only "</script>" does
 */
function withoutHidden(html, names, space) {
  const open = new RegExp(`<!--|<(${names.join("|")})(?=[\\s/>])`, "gi");
  const ends = new Map(names.map((n) => [n, new RegExp(`</${n}${space}>`, "gi")]));
  let out = "";
  let from = 0;
  for (let m; (m = open.exec(html));) {
    out += `${html.slice(from, m.index)} `;
    let end = html.length;
    if (m[1]) {
      const close = ends.get(m[1].toLowerCase());
      close.lastIndex = open.lastIndex;
      if (close.exec(html)) end = close.lastIndex;
    } else {
      const close = html.indexOf("-->", open.lastIndex);
      if (close >= 0) end = close + 3;
    }
    from = open.lastIndex = end;
    if (end === html.length) break;
  }
  return out + html.slice(from);
}

/**
 * s with each <name …>…</name> replaced by a space, as s.replace(/<name[\s>][\s\S]*?<\/name\s*>/gi, " ")
 * does (only the first with once), in linear time: when one has no end tag after it, no later one
 * has, so the search stops there.
 */
function withoutElements(s, name, once = false) {
  const open = new RegExp(`<${name}[\\s>]`, "gi");
  const close = new RegExp(`</${name}\\s*>`, "gi");
  let out = "";
  let from = 0;
  for (let m; (m = open.exec(s));) {
    close.lastIndex = open.lastIndex;
    if (!close.exec(s)) break;
    out += `${s.slice(from, m.index)} `;
    from = open.lastIndex = close.lastIndex;
    if (once) break;
  }
  return out + s.slice(from);
}

/**
 * Visible-text word count of an HTML string (scripts, styles, templates,
 * noscript, inline SVG and comments removed). Linear in the length of html.
 * content.js has a copy (htmlWordCount): change both together.
 * @param {string} html
 */
export function extractWordCount(html) {
  const body = html.search(/<body/i);
  // The <body> tag is optional: without it, leave out the <head> part (the title isn't page text).
  const text = withoutHidden(body >= 0 ? html.slice(body) : withoutElements(withoutElements(html, "head", true), "title"),
    ["script", "style", "template", "noscript", "svg"], "");
  // Tags go up to the next ">". After the last ">" none can end, so that part is left as it is
  // (the regex would try every "<" there to the end).
  const last = text.lastIndexOf(">");
  const stripped = (text.slice(0, last + 1).replace(/<[^>]+>/g, " ") + text.slice(last + 1))
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return countWords(stripped);
}
