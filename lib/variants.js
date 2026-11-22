import { fetchWithTimeout } from "./fetch-helper.js";

import { siteOf } from "./urls.js";

/** Is a host (without www.) a subdomain, like shop.example.com, rather than the bare domain? */
export function isSubdomain(host) {
  return String(host).toLowerCase() !== siteOf(host);
}

/**
 * Do http/https and www/non-www versions of a site all end on one URL?
 * Requests the four home-page variants and follows their redirects.
 * Needs the optional site access (http and https are different origins).
 * @param {string} pageUrl
 * @param {typeof fetch} [fetchImpl] - injectable for tests
 * @returns {Promise<{variants: Array<{url: string, status: number, finalUrl: string, error?: string}>, consistent: boolean, target: string|null}>}
 */
export async function checkHostVariants(pageUrl, fetchImpl) {
  const u = new URL(pageUrl);
  const bare = u.hostname.replace(/^www\./, "");
  const hosts = isSubdomain(bare) ? [u.hostname] : [bare, `www.${bare}`];
  const urls = [];
  for (const proto of ["http:", "https:"]) for (const h of hosts) urls.push(`${proto}//${h}/`);
  const doFetch = fetchImpl
    ? (url, opts) => fetchImpl(url, opts)
    : (url, opts) => fetchWithTimeout(url, opts, 15000);
  const variants = await Promise.all(urls.map(async (url) => {
    try {
      const r = await doFetch(url, { method: "GET", redirect: "follow", credentials: "omit" });
      try { await r.body?.cancel(); } catch {}
      return { url, status: r.status, finalUrl: r.url || url };
    } catch (e) {
      return { url, status: 0, finalUrl: "", error: e?.message || "no answer" };
    }
  }));
  const answered = variants.filter((v) => v.status >= 200 && v.status < 400);
  const finals = new Set(answered.map((v) => v.finalUrl.replace(/\/$/, "")));
  const consistent = answered.length === variants.length && finals.size === 1;
  return { variants, consistent, target: finals.size === 1 ? [...finals][0] + "/" : null };
}
