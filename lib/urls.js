/**
 * A URL as a key for comparing pages: absolute, without its #fragment (Google ignores it) and
 * without a trailing slash, so /fr and /fr/ match. "" when it can't be read.
 * @param {string} url
 * @param {string} [base] - for relative URLs
 * @returns {string}
 */
export function urlKey(url, base) {
  try {
    const x = new URL(url, base);
    x.hash = "";
    return x.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}
