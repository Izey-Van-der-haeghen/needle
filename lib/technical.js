import { isAllowedByRobots, robotsSitemaps, ROBOTS_MAX_BYTES } from "./robots.js";
import { HTML_SNIPPET_BYTES } from "./constants.js";
import { withoutTracking } from "./urls.js";
import { countWords } from "./words.js";


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
 *            truncated?: boolean, reason?: string}} sitemap
 * @property {{htmlLen: number, htmlSnippet: string, wordCount: number, headings: number,
 *            links: number, schema: number}|null} raw - the HTML as served, before JavaScript
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
  const sitemap = await fetchSitemap(candidates, fetcher, origin);

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
    raw: main?.status ? rawSnapshot(main.text || "") : null
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

async function fetchSitemap(candidates, fetcher, origin) {
  const sameOrigin = [];
  const other = [];
  for (const c of candidates) {
    try {
      const href = new URL(c).href;
      (new URL(href).origin === origin ? sameOrigin : other).push(href);
    } catch {}
  }
  const tryList = [...sameOrigin, ...other].slice(0, 3);
  let last = { ok: false, status: 404, reason: "not found" };
  for (const url of tryList) {
    const [r] = await fetcher([{ url, maxBytes: SITEMAP_MAX_BYTES }]);
    if (!r?.status) {
      const elsewhere = new URL(url).origin !== origin;
      last = { ok: false, status: 0, url, reason: elsewhere ? "on another site, not checked" : (r?.error || "network error") };
      continue;
    }
    if (!r.ok) { last = { ok: false, status: r.status, url, reason: `HTTP ${r.status}` }; continue; }
    const text = r.text || "";
    if (!/<(urlset|sitemapindex)[\s>]/i.test(text)) {
      last = { ok: false, status: r.status, url, reason: "not a sitemap (HTML or empty)" };
      continue;
    }
    return {
      ok: true,
      status: r.status,
      url,
      urlCount: (text.match(/<loc[\s>]/gi) || []).length,
      isIndex: /<sitemapindex[\s>]/i.test(text),
      truncated: !!r.truncated
    };
  }
  return last;
}

/**
 * Coarse counts of the HTML as served (before JavaScript runs).
 * @param {string} text
 */
export function rawSnapshot(text) {
  return {
    htmlLen: text.length,
    htmlSnippet: text.slice(0, HTML_SNIPPET_BYTES),
    wordCount: extractWordCount(text),
    headings: (text.match(/<h[1-6][\s>]/gi) || []).length,
    links: (text.match(/<a\s[^>]*href=/gi) || []).length,
    schema: (text.match(/application\/ld\+json/gi) || []).length
  };
}

/**
 * Visible-text word count of an HTML string (scripts, styles, templates,
 * noscript, inline SVG and comments removed).
 * @param {string} html
 */
export function extractWordCount(html) {
  const bodyMatch = html.match(/<body[\s\S]*$/i);
  const stripped = (bodyMatch ? bodyMatch[0] : html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|template|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return countWords(stripped);
}
