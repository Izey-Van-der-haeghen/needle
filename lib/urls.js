/**
 * A URL in one spelling: absolute, without its #fragment (Google ignores it), without a
 * trailing dot on the host or an empty "?", and with upper-case percent-escapes
 * (%c3%a9 and %C3%A9 are the same, RFC 3986 section 6.2.2.1). null when it can't be read.
 */
function canonicalForm(url, base) {
  const x = new URL(url, base);
  x.hash = "";
  if (x.hostname.endsWith(".")) x.hostname = x.hostname.replace(/\.+$/, "");
  const upper = (s) => s.replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase());
  x.pathname = upper(x.pathname);
  x.search = upper(x.search); // "" also drops a lone "?"
  return x;
}

/**
 * A URL as a key for comparing pages: absolute, without its #fragment (Google ignores it) and
 * without a trailing slash on the path, so /fr, /fr/ and /fr/?page=2 vs /fr?page=2 match.
 * Escape case, a trailing dot on the host and an empty "?" don't count either.
 * "" when it can't be read.
 * @param {string} url
 * @param {string} [base] - for relative URLs
 * @returns {string}
 */
export function urlKey(url, base) {
  try {
    const x = canonicalForm(url, base);
    if (x.pathname.length > 1) x.pathname = x.pathname.replace(/\/+$/, "");
    // The root keeps no slash either, but a slash inside the query (?next=/) is part of the URL.
    return x.pathname === "/" && !x.search ? x.href.slice(0, -1) : x.href;
  } catch {
    return "";
  }
}

/**
 * Like urlKey, but /fr and /fr/ stay different: Google treats them as two URLs. For telling
 * the user that two spellings differ only by the trailing slash. "" when it can't be read.
 * @param {string} url
 * @param {string} [base]
 * @returns {string}
 */
export function exactUrlKey(url, base) {
  try {
    return canonicalForm(url, base).href;
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
 * Empty parameters go too, so /p? and /p?& are /p, and /p?a=1& is /p?a=1: adding a
 * tracking parameter never changes the result.
 * @param {string} url
 * @returns {string}
 */
export function withoutTracking(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    // Filter the raw query: URLSearchParams would rewrite the rest (%20 → +, "," → %2C, ?amp → ?amp=),
    // and the page would no longer match its own canonical.
    const name = (kv) => { const k = kv.split("=")[0]; try { return decodeURIComponent(k.replace(/\+/g, " ")); } catch { return k; } };
    const kept = u.search.slice(1).split("&").filter((kv) => kv && !TRACKING_PARAM.test(name(kv))).join("&");
    // u.search is "" for a bare "?" too, so an empty result always clears it (a reset-filters link is href="?").
    if (kept !== u.search.slice(1) || !kept) u.search = kept ? `?${kept}` : "";
    return u.href;
  } catch {
    return url;
  }
}
