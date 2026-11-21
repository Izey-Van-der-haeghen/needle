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
