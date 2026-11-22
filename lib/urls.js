/**
 * A URL as a key for comparing pages: absolute, without its #fragment (Google ignores it) and
 * without a trailing slash on the path, so /fr, /fr/ and /fr/?page=2 vs /fr?page=2 match.
 * "" when it can't be read.
 * @param {string} url
 * @param {string} [base] - for relative URLs
 * @returns {string}
 */
export function urlKey(url, base) {
  try {
    const x = new URL(url, base);
    x.hash = "";
    if (x.pathname.length > 1) x.pathname = x.pathname.replace(/\/+$/, "");
    return x.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}

// Two-part country suffixes (example.co.uk, example.ne.jp) and shared hosts where each user has
// their own site (user.github.io). shortcut: not the full public suffix list.
const SECOND_LEVEL = /^(co|com|org|net|ac|gov|edu|ltd|plc|or|ne|go|gv)$/;
const SHARED_HOST = /\.(github\.io|gitlab\.io|netlify\.app|vercel\.app|pages\.dev|web\.app|herokuapp\.com|blogspot\.com|wordpress\.com)$/i;

/**
 * The site a host belongs to: example.com for shop.example.com, example.co.uk for www.example.co.uk,
 * alice.github.io for alice.github.io.
 * @param {string} host
 * @returns {string}
 */
export function siteOf(host) {
  const labels = String(host).toLowerCase().replace(/\.$/, "").split(".");
  const twoPart = labels.length >= 3 && labels.at(-1).length === 2 && SECOND_LEVEL.test(labels.at(-2));
  const keep = twoPart || SHARED_HOST.test(labels.join(".")) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

// Parameters a campaign or ad click adds to a link; they don't make it another page.
const TRACKING_PARAM = /^(utm_[a-z_]+|gclid|gbraid|wbraid|dclid|fbclid|msclkid|yclid|twclid|ttclid|li_fat_id|igshid|mc_cid|mc_eid|_ga|_gl|_hsenc|_hsmi|mkt_tok)$/i;

/**
 * The URL without its #fragment and without campaign tracking parameters, for comparing a page
 * with its canonical or its hreflang links. Other parameters (?lang=fr, ?page=2) are kept.
 * @param {string} url
 * @returns {string}
 */
export function withoutTracking(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    // Filter the raw query: URLSearchParams would rewrite the rest (%20 → +, "," → %2C, ?amp → ?amp=),
    // and the page would no longer match its own canonical.
    const parts = u.search.slice(1).split("&").filter(Boolean);
    const name = (kv) => { const k = kv.split("=")[0]; try { return decodeURIComponent(k.replace(/\+/g, " ")); } catch { return k; } };
    const kept = parts.filter((kv) => !TRACKING_PARAM.test(name(kv)));
    if (kept.length !== parts.length) u.search = kept.length ? `?${kept.join("&")}` : "";
    return u.href;
  } catch {
    return url;
  }
}
