import { robotsBlocksIndexing } from "./popup-compute.js";
import { readableError } from "./errors.js";

/** How many alternates the check loads at most. */
export const CLUSTER_MAX = 20;

const norm = (u, base) => { try { const x = new URL(u, base); x.hash = ""; return x.href.replace(/\/$/, ""); } catch { return ""; } };

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
 * canonical to itself, is it indexable, and does it link back (return tag)?
 * Google ignores hreflang pairs without return links.
 * @param {string} pageUrl
 * @param {Array<{lang: string, href: string}>} hreflang
 * @param {(url: string) => Promise<{status: number, url: string, html: string}>} load - fetch an alternate
 * @param {(html: string) => Document} parse - DOMParser in the popup, jsdom in tests
 * @param {{max?: number}} [opts]
 * @returns {Promise<Array<{lang: string, href: string, status: number, finalUrl: string, selfCanonical: boolean|null,
 *            noindex: boolean, returnLink: boolean|null, problems: string[]}>>}
 */
export async function checkHreflangCluster(pageUrl, hreflang, load, parse, { max = CLUSTER_MAX } = {}) {
  const me = norm(pageUrl);
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
      if (r.status === 200 && r.html) {
        const doc = parse(r.html);
        const can = doc.querySelector('link[rel~="canonical"]')?.getAttribute("href");
        row.selfCanonical = can ? norm(can, row.finalUrl) === norm(row.finalUrl) : null;
        if (row.selfCanonical === false) row.problems.push("canonical points elsewhere");
        const robots = [...doc.querySelectorAll('meta[name="robots" i], meta[name="googlebot" i]')].map((m) => m.getAttribute("content") || "").join(", ");
        row.noindex = robotsBlocksIndexing(robots);
        if (row.noindex) row.problems.push("noindex");
        const back = [...doc.querySelectorAll('link[rel~="alternate"][hreflang]')].map((l) => norm(l.getAttribute("href"), row.finalUrl));
        row.returnLink = back.includes(me);
        if (!row.returnLink) row.problems.push("no hreflang link back to this page");
      }
    } catch (e) {
      row.problems.push(readableError(e, { network: "could not connect", timeout: "timed out" }));
    }
    out.push(row);
  }
  return out;
}
