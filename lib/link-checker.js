import { fetchWithTimeout } from "./fetch-helper.js";
import { isLocalUrl } from "./url-safety.js";
import { siteOf } from "./urls.js";

const PROBE_TIMEOUT_MS = 8 * 1000;
// Safety net for pathological pages (infinite comment threads).
const MAX_LINKS = 2000;
const PARALLEL = 8;
// Chrome's 6-connections-per-host limit applies to HTTP/1.1 only; over HTTP/2 every
// request to a host runs at once, so we cap per host ourselves.
const PER_HOST = 3;
// The server refused an automated check (login wall, bot wall, rate limit, LinkedIn's 999):
// the link may work fine in a browser, so it is not "broken". 503 is what bot walls such as
// Amazon's answer, and otherwise means "down for now", not gone.
const BLOCKED = [401, 403, 429, 503, 999];

/**
 * @typedef {Object} LinkCheckResult
 * @property {string} url
 * @property {number} status - HTTP status, or 0 on network error / unknown
 * @property {"ok"|"redirect"|"broken"|"blocked"|"timeout"|"skipped"} kind
 * @property {string} [finalUrl]
 * @property {number} ms
 * @property {boolean} [language] - "ok" after a redirect to a language version of the same page
 * @property {boolean} [hostTimedOut] - "timeout" without a request: the host already timed out on another link
 */

// A path segment that names a language or locale: en, fr-fr, pt_BR, zh-hant. Two-letter words that
// are paths, not languages (/my/account, /go/…, /to/…), don't count.
const LOCALE_SEGMENT = /^[a-z]{2}(?:[-_](?:[a-z]{2,4}|\d{3}))?$/i;
const NOT_A_LANGUAGE = new Set(["my", "me", "go", "to", "on", "at", "do", "up", "so", "an", "or", "if", "as", "by", "we", "us", "id", "ok", "tv", "pr", "hr", "ad", "ai", "ui", "ux", "qa"]);
const isLocale = (s) => LOCALE_SEGMENT.test(s) && !NOT_A_LANGUAGE.has(s.toLowerCase());
// "Same site" is the one rule in lib/urls.js, shared with the http/https/www check.

/**
 * Does a link redirect only to a language version of the same page? The final URL starts with a
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
    // http → https is a redirect to fix (link to https), even when a language is added.
    if (a.protocol !== b.protocol) return false;
    const segs = (u) => u.pathname.split("/").filter(Boolean);
    const sa = segs(a);
    const sb = segs(b);
    if (sa.some(isLocale)) return false;
    // Sites put the language first: /fr-fr/privacy/…, /en/.
    if (!sb.length || !isLocale(sb[0])) return false;
    // A link to the home page may only gain the language (/ → /en/), not a page (/ → /en/login).
    if (!sa.length) return sb.length === 1;
    // The page itself must stay: index.html or default.aspx says nothing about which page it was.
    const last = sa[sa.length - 1];
    if (/^(index|default)\.[a-z]+$/i.test(last)) return sb.length === sa.length + 1 && sb.slice(1).join("/") === sa.join("/");
    // The same page under the language, with at most one section added before it:
    // /privacystatement → /fr-fr/privacy/privacystatement, but not /blog/post → /de/archive/2019/post.
    const rest = sb.slice(1);
    return rest.length <= sa.length + 1 && rest.slice(-sa.length).join("/") === sa.join("/");
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
 * @param {(done: number, total: number) => void} [onProgress] - after each link, so a slow host doesn't look stuck
 * @returns {Promise<LinkCheckResult[]>}
 */
export async function checkLinks(urls, signal, pageUrl = "", onProgress = null) {
  const pageIsLocal = isLocalUrl(pageUrl);
  const targets = [...new Set(urls)].slice(0, MAX_LINKS);
  const results = [];
  // One link done: keep its result and report how far the check is.
  const record = (r) => {
    results.push(r);
    if (onProgress) { try { onProgress(results.length, targets.length); } catch {} }
  };
  const hosts = targets.map(u => { try { return new URL(u).host; } catch { return ""; } });
  const started = targets.map(() => false);
  const deadHosts = new Set();
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
        record({ url, status: 0, kind: "skipped", ms: 0 });
        continue;
      }
      // A host that already timed out twice won't answer the next link either: don't wait 16 s again.
      if (deadHosts.has(hosts[i])) {
        record({ url, status: 0, kind: "timeout", ms: 0, hostTimedOut: true });
        continue;
      }
      inFlight.set(hosts[i], (inFlight.get(hosts[i]) || 0) + 1);
      const t0 = Date.now();
      const { r, err, opaque, timeout, deadline } = await probeUrl(url);
      inFlight.set(hosts[i], inFlight.get(hosts[i]) - 1);
      if (deadline && !signal?.aborted) deadHosts.add(hosts[i]);
      if (err) {
        record({ url, status: 0, kind: timeout ? "timeout" : "broken", ms: Date.now() - t0 });
        continue;
      }
      // An opaque (no-cors) answer has no status, but the server did answer.
      if (opaque || (r.status === 0 && r.type === "opaque")) {
        record({ url, status: 0, kind: "ok", finalUrl: url, ms: Date.now() - t0 });
        continue;
      }
      const status = r.status;
      let kind;
      // A redirect to the reader's language version (/fr-fr/…) is how big sites work: the link is fine.
      const language = status >= 200 && status < 300 && r.redirected && isLanguageRedirect(url, r.url);
      if (status >= 200 && status < 300) kind = r.redirected && !language ? "redirect" : "ok";
      else if (status >= 300 && status < 400) kind = "redirect";
      else if (BLOCKED.includes(status)) kind = "blocked";
      else kind = "broken";
      record({ url, status, kind, finalUrl: r.url || url, ms: Date.now() - t0, ...(language ? { language: true } : {}) });
    }
  }

  // Workers exit when only busy hosts remain; restart until every URL has started.
  while (started.some(s => !s) && !signal?.aborted) {
    await Promise.all(Array.from({ length: PARALLEL }, () => worker()));
  }
  return results;
}

/**
 * Did the check fail because the connection is down? Every link that was requested failed without
 * an HTTP answer (a network error, not a status). One working link means the connection is fine.
 * @param {LinkCheckResult[]} results
 */
export function noConnection(results) {
  const asked = (results || []).filter((r) => r.kind !== "skipped" && !r.hostTimedOut);
  // Links to one host that hangs say nothing about the connection: that host is down or refuses checks.
  const hosts = new Set(asked.map((r) => { try { return new URL(r.url).host; } catch { return r.url; } }));
  return asked.length > 1 && hosts.size > 1 && asked.every((r) => (r.kind === "broken" || r.kind === "timeout") && !r.status);
}
