import { fetchWithTimeout } from "./fetch-helper.js";
import { isLocalUrl } from "./url-safety.js";

const PROBE_TIMEOUT_MS = 6 * 1000;
const PARALLEL = 6;
/** How many image files one "Measure" asks about (the popup says when there are more). */
export const MAX_IMAGES = 300;

/**
 * File size in bytes of image URLs, asked from the server with HEAD (or a
 * one-byte Range GET when HEAD is refused). Used when the browser's Performance
 * API does not expose the size (cross-origin without Timing-Allow-Origin, lazy
 * images not loaded yet). Needs the optional "all sites" permission.
 * Unknown URLs are left out of the result.
 * @param {string[]} urls
 * @param {AbortSignal} [signal]
 * @param {string} [pageUrl] - the audited page; local image hosts are skipped unless it is local too
 * @returns {Promise<Record<string, number>>}
 */
export async function fetchImageSizes(urls, signal, pageUrl = "") {
  const out = {};
  const pageIsLocal = isLocalUrl(pageUrl);
  const list = [...new Set(urls)]
    .filter(u => /^https?:/.test(u) && (pageIsLocal || !isLocalUrl(u)))
    .slice(0, MAX_IMAGES);
  let cursor = 0;

  async function worker() {
    while (cursor < list.length && !signal?.aborted) {
      const url = list[cursor++];
      try {
        let r = await fetchWithTimeout(url, { method: "HEAD", credentials: "omit", redirect: "follow", signal }, PROBE_TIMEOUT_MS);
        if (r.status === 405 || r.status === 403 || !r.headers.get("content-length")) {
          r = await fetchWithTimeout(url, {
            method: "GET",
            credentials: "omit",
            redirect: "follow",
            headers: { Range: "bytes=0-0" },
            signal
          }, PROBE_TIMEOUT_MS);
          // Read nothing more than needed.
          try { await r.body?.cancel(); } catch {}
        }
        if (!r.ok) continue;
        let bytes = 0;
        if (r.status === 206) {
          // "bytes 0-0/123456": the total after the slash is the file size.
          const total = r.headers.get("content-range")?.match(/\/(\d+)\s*$/);
          bytes = total ? parseInt(total[1], 10) : 0;
        } else {
          bytes = parseInt(r.headers.get("content-length"), 10) || 0;
        }
        if (bytes > 0) out[url] = bytes;
      } catch {}
    }
  }

  await Promise.all(Array.from({ length: PARALLEL }, () => worker()));
  return out;
}
