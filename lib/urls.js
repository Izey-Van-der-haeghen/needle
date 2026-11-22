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
