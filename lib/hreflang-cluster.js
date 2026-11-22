import { robotsBlocksIndexing } from "./popup-compute.js";
import { readableError } from "./errors.js";
import { urlKey as norm, exactUrlKey as exact } from "./urls.js";

/** How many alternates the check loads at most. */
export const CLUSTER_MAX = 20;

/**
 * The other pages a page names in its hreflang, each once.
 * @param {string} pageUrl
 * @param {Array<{lang: string, href: string}>} hreflang
 * @returns {Array<{lang: string, href: string, key: string}>} href as written (made absolute), key for comparing
 */
export function alternatesOf(pageUrl, hreflang) {
  const me = norm(pageUrl);
  const alternates = [];
  const seen = new Set();
  for (const h of hreflang || []) {
    const key = norm(h.href, pageUrl);
    if (!key || key === me || seen.has(key)) continue;
    seen.add(key);
    const href = (() => { const x = new URL(h.href, pageUrl); x.hash = ""; return x.href; })();
    alternates.push({ lang: h.lang, href, key });
  }
  return alternates;
}

/**
 * Check every hreflang alternate of a page: does it answer 200, is it
 * canonical to itself, is it indexable (meta robots and X-Robots-Tag), and does it link back
 * (return tag)? Google ignores hreflang pairs without return links.
 * URLs are matched without the trailing slash, but /fr and /fr/ are two URLs to Google:
 * a redirect, canonical or return link that differs only by the slash is a problem too.
 * @param {string} pageUrl
 * @param {Array<{lang: string, href: string}>} hreflang
 * @param {(url: string) => Promise<{status: number, url: string, html: string, headers?: Record<string, string>}>} load
 *   fetch an alternate; headers with lower-case names
 * @param {(html: string) => Document} parse - DOMParser in the popup, jsdom in tests
 * @param {{max?: number}} [opts]
 * @returns {Promise<Array<{lang: string, href: string, status: number, finalUrl: string, selfCanonical: boolean|null,
 *            noindex: boolean, returnLink: boolean|null, problems: string[]}>>}
 */
export async function checkHreflangCluster(pageUrl, hreflang, load, parse, { max = CLUSTER_MAX } = {}) {
  const me = norm(pageUrl);
  // The spelling the cluster should use for this page: its own hreflang entry, else its URL.
  const meExact = exact((hreflang || []).map((h) => h.href).find((h) => norm(h, pageUrl) === me) || pageUrl, pageUrl);
  const alternates = alternatesOf(pageUrl, hreflang);
  const out = [];
  for (const alt of alternates.slice(0, max)) {
    const row = { lang: alt.lang, href: alt.href, status: 0, finalUrl: "", selfCanonical: null, noindex: false, returnLink: null, problems: [] };
    try {
      const r = await load(alt.href);
      row.status = r.status;
      row.finalUrl = r.url || alt.href;
      if (r.status >= 300 || !r.status) row.problems.push(r.status ? `answers HTTP ${r.status}` : "no answer");
      if (norm(row.finalUrl) !== alt.key) row.problems.push(`redirects to ${row.finalUrl}`);
      else if (exact(row.finalUrl) !== exact(alt.href)) row.problems.push(`redirects to ${row.finalUrl} (the trailing slash differs)`);
      if (r.status === 200) {
        // X-Robots-Tag noindex keeps the alternate out of Google just like the meta tag.
        if (robotsBlocksIndexing(r.headers?.["x-robots-tag"] || "")) { row.noindex = true; row.problems.push("noindex (X-Robots-Tag header)"); }
      }
      if (r.status === 200 && r.html) {
        const doc = parse(r.html);
        const can = doc.querySelector('link[rel~="canonical"]')?.getAttribute("href");
        row.selfCanonical = can ? norm(can, row.finalUrl) === norm(row.finalUrl) : null;
        if (row.selfCanonical === false) row.problems.push("canonical points elsewhere");
        else if (row.selfCanonical && exact(can, row.finalUrl) !== exact(row.finalUrl)) {
          row.selfCanonical = false;
          row.problems.push(`canonical points to ${exact(can, row.finalUrl)} (the trailing slash differs)`);
        }
        const robots = [...doc.querySelectorAll('meta[name="robots" i], meta[name="googlebot" i]')].map((m) => m.getAttribute("content") || "").join(", ");
        if (robotsBlocksIndexing(robots)) { row.noindex = true; row.problems.push("noindex"); }
        const back = [...doc.querySelectorAll('link[rel~="alternate"][hreflang]')].map((l) => l.getAttribute("href"));
        const backHere = back.filter((h) => norm(h, row.finalUrl) === me);
        row.returnLink = backHere.length > 0;
        if (!row.returnLink) row.problems.push("no hreflang link back to this page");
        else if (!backHere.some((h) => exact(h, row.finalUrl) === meExact)) {
          row.problems.push(`links back to ${exact(backHere[0], row.finalUrl)} (the trailing slash differs)`);
        }
      }
    } catch (e) {
      row.problems.push(readableError(e, { network: "could not connect", timeout: "timed out" }));
    }
    out.push(row);
  }
  return out;
}
