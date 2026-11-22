import { readablePageError } from "./errors.js";
/**
 * Fetch URLs from inside the audited tab.
 *
 * Needle has no standing access to websites. When the user opens the popup,
 * Chrome grants `activeTab` for that tab, which lets the extension run a
 * function in the page. Requests made there come from the page's own origin,
 * so same-site files (the page itself, /robots.txt, /sitemap.xml, /llms.txt)
 * can be read without any host permission. Cross-site URLs only work when the
 * other server allows it (CORS); everything else needs the optional
 * "all sites" permission and is fetched by the popup or the background worker.
 */

export const PAGE_FETCH_TIMEOUT_MS = 20 * 1000;

/**
 * @typedef {Object} FetchRequest
 * @property {string} url
 * @property {number} [maxBytes] - stop reading the body after this many bytes
 * @property {boolean} [body=true] - false: headers and status only
 */

/**
 * @typedef {Object} FetchResult
 * @property {boolean} ok
 * @property {number} status - 0 on network error or timeout
 * @property {string} url - final URL after redirects
 * @property {boolean} [redirected]
 * @property {Record<string,string>} [headers] - lower-case names
 * @property {string} [text]
 * @property {boolean} [truncated]
 * @property {number} [ms]
 * @property {string} [error]
 */

/**
 * Run fetches inside the tab. Requires activeTab (granted when the popup opens).
 * @param {number} tabId
 * @param {FetchRequest[]} requests
 * @param {number} [timeoutMs]
 * @returns {Promise<FetchResult[]>}
 */
export async function fetchInPage(tabId, requests, timeoutMs = PAGE_FETCH_TIMEOUT_MS) {
  let res;
  try {
    [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: pageFetchAll,
      args: [requests, timeoutMs]
    });
  } catch (e) {
    // Chrome's own text ("Frame with ID 0 is showing error page") means nothing to a reader.
    throw new Error(readablePageError(e?.message));
  }
  if (!res || !Array.isArray(res.result)) throw new Error("The page did not answer. Reload the tab and try again.");
  return res.result;
}

/**
 * Make a fetcher bound to one tab, for lib functions that take `fetcher(requests)`.
 * @param {number} tabId
 * @returns {(requests: FetchRequest[]) => Promise<FetchResult[]>}
 */
export function pageFetcher(tabId) {
  return (requests) => fetchInPage(tabId, requests);
}

/**
 * Executed in the page's isolated world by chrome.scripting. Must be
 * self-contained: no imports, no closures over module scope.
 * Exported only so tests can run it directly.
 * @param {FetchRequest[]} requests
 * @param {number} timeoutMs
 * @returns {Promise<FetchResult[]>}
 */
export async function pageFetchAll(requests, timeoutMs) {
  async function readCapped(response, maxBytes) {
    const type = response.headers.get("content-type") || "";
    const charset = (type.match(/charset=([^;\s]+)/i) || [])[1];
    let decoder;
    try { decoder = new TextDecoder(charset || "utf-8"); } catch { decoder = new TextDecoder("utf-8"); }
    if (!response.body || !response.body.getReader) {
      const t = await response.text();
      return { text: t.slice(0, maxBytes), truncated: t.length > maxBytes };
    }
    const reader = response.body.getReader();
    let text = "";
    let bytes = 0;
    let truncated = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (bytes >= maxBytes) {
        truncated = true;
        try { await reader.cancel(); } catch {}
        break;
      }
    }
    text += decoder.decode();
    return { text, truncated };
  }

  async function one(req) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const t0 = Date.now();
    try {
      const response = await fetch(req.url, {
        method: "GET",
        credentials: "omit",
        redirect: "follow",
        cache: "no-store",
        signal: ctrl.signal
      });
      const headers = {};
      response.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
      let text = "";
      let truncated = false;
      if (req.body !== false) {
        ({ text, truncated } = await readCapped(response, req.maxBytes || 3 * 1024 * 1024));
      } else {
        try { await response.body?.cancel(); } catch {}
      }
      return {
        ok: response.ok,
        status: response.status,
        url: response.url || req.url,
        redirected: response.redirected,
        headers,
        text,
        truncated,
        ms: Date.now() - t0
      };
    } catch (e) {
      return {
        ok: false,
        status: 0,
        url: req.url,
        // Plain words: the browser's own "Failed to fetch" means nothing to a reader.
        error: e && e.name === "AbortError" ? "Timed out" : /failed to fetch|networkerror|load failed/i.test(String(e && e.message)) ? "Could not connect" : String((e && e.message) || e)
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return Promise.all((requests || []).map(one));
}
