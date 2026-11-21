import { fetchWithTimeout } from "./fetch-helper.js";
import { isLocalUrl } from "./url-safety.js";

const PROBE_TIMEOUT_MS = 8 * 1000;
// Safety net for pathological pages (infinite comment threads).
const MAX_LINKS = 2000;
const PARALLEL = 8;
// Chrome's 6-connections-per-host limit applies to HTTP/1.1 only; over HTTP/2 every
// request to a host runs at once, so we cap per host ourselves.
const PER_HOST = 3;
// The server refused an automated check (login wall, bot wall, rate limit, LinkedIn's 999):
// the link may work fine in a browser, so it is not "broken".
const BLOCKED = [401, 403, 429, 999];

/**
 * @typedef {Object} LinkCheckResult
 * @property {string} url
 * @property {number} status - HTTP status, or 0 on network error / unknown
 * @property {"ok"|"redirect"|"broken"|"blocked"|"timeout"|"skipped"} kind
 * @property {string} [finalUrl]
 * @property {number} ms
 * @property {boolean} [language] - "ok" after a redirect to a language version of the same page
 */

// A path segment that names a language or locale: en, fr-fr, pt_BR, zh-hant.
const LOCALE_SEGMENT = /^[a-z]{2}(?:[-_][a-z]{2,4})?$/i;
const siteOf = (host) => host.split(".").slice(-2).join(".");

/**
 * Does a link redirect only to a language version of the same page? The final URL adds a
 * language segment the link didn't have, stays on the same site (privacy.example.com →
 * www.example.com counts), and still ends on the link's last path segment.
 * @param {string} from - the link
 * @param {string} to - where it ended
 */
export function isLanguageRedirect(from, to) {
  try {
    const a = new URL(from);
    const b = new URL(to);
    if (siteOf(a.hostname) !== siteOf(b.hostname)) return false;
    const segs = (u) => u.pathname.split("/").filter(Boolean);
    const sa = segs(a);
    const sb = segs(b);
    if (sa.some((s) => LOCALE_SEGMENT.test(s))) return false;
    if (!sb.some((s) => LOCALE_SEGMENT.test(s))) return false;
    const last = sa[sa.length - 1];
    return !last || sb.includes(last);
  } catch {
    return false;
  }
}

/**
 * Check links with HEAD requests. A HEAD answered with 400+ is retried once
 * with GET (some servers refuse HEAD), except 429. At most PARALLEL requests at
 * once and PER_HOST per host. Needs the optional "all sites" permission.
 * Links to localhost or private networks are skipped unless the page itself is local.
 * @param {string[]} urls
 * @param {AbortSignal} [signal]
 * @param {string} [pageUrl] - the audited page
 * @returns {Promise<LinkCheckResult[]>}
 */
export async function checkLinks(urls, signal, pageUrl = "") {
  const pageIsLocal = isLocalUrl(pageUrl);
  const targets = [...new Set(urls)].slice(0, MAX_LINKS);
  const results = [];
  const hosts = targets.map(u => { try { return new URL(u).host; } catch { return ""; } });
  const started = targets.map(() => false);
  const inFlight = new Map();

  async function probeOnce(url) {
    const send = (method, mode) => fetchWithTimeout(url, { method, mode, redirect: "follow", credentials: "omit", signal }, PROBE_TIMEOUT_MS);
    try {
      const r = await send("HEAD");
      return { r: r.status >= 400 && r.status !== 429 ? await send("GET") : r };
    } catch (e1) {
      // Our own deadline or a closing popup: no verdict about the link itself.
      if (signal?.aborted || e1?.name === "AbortError" || e1?.name === "TimeoutError") return { err: e1, timeout: true, deadline: e1?.name === "TimeoutError" };
      try { return { r: await send("GET", "no-cors"), opaque: true }; } catch (e2) { return { err: e2 }; }
    }
  }

  // A server that is slow once is not a dead link: after our own deadline, try once more.
  async function probeUrl(url) {
    const first = await probeOnce(url);
    return first.deadline && !signal?.aborted ? probeOnce(url) : first;
  }

  async function worker() {
    for (;;) {
      if (signal?.aborted) return;
      const i = started.findIndex((s, j) => !s && (inFlight.get(hosts[j]) || 0) < PER_HOST);
      if (i < 0) return; // what is left belongs to busy hosts; their workers take it
      started[i] = true;
      const url = targets[i];
      if (!/^https?:/i.test(url) || (!pageIsLocal && isLocalUrl(url))) {
        results.push({ url, status: 0, kind: "skipped", ms: 0 });
        continue;
      }
      inFlight.set(hosts[i], (inFlight.get(hosts[i]) || 0) + 1);
      const t0 = Date.now();
      const { r, err, opaque, timeout } = await probeUrl(url);
      inFlight.set(hosts[i], inFlight.get(hosts[i]) - 1);
      if (err) {
        results.push({ url, status: 0, kind: timeout ? "timeout" : "broken", ms: Date.now() - t0 });
        continue;
      }
      // An opaque (no-cors) answer has no status, but the server did answer.
      if (opaque || (r.status === 0 && r.type === "opaque")) {
        results.push({ url, status: 0, kind: "ok", finalUrl: url, ms: Date.now() - t0 });
        continue;
      }
      const status = r.status;
      let kind;
      // A redirect to the reader's language version (/fr-fr/…) is how big sites work: the link is fine.
      const language = r.redirected && isLanguageRedirect(url, r.url);
      if (status >= 200 && status < 300) kind = r.redirected && !language ? "redirect" : "ok";
      else if (status >= 300 && status < 400) kind = "redirect";
      else if (BLOCKED.includes(status)) kind = "blocked";
      else kind = "broken";
      results.push({ url, status, kind, finalUrl: r.url || url, ms: Date.now() - t0, ...(language ? { language: true } : {}) });
    }
  }

  // Workers exit when only busy hosts remain; restart until every URL has started.
  while (started.some(s => !s) && !signal?.aborted) {
    await Promise.all(Array.from({ length: PARALLEL }, () => worker()));
  }
  return results;
}
