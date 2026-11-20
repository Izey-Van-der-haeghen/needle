import { FETCH_TIMEOUT_MS } from "./constants.js";

/**
 * fetch() with one deadline that covers the headers and the body read.
 * Also honours an external AbortSignal (options.signal), e.g. when the popup closes.
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [timeoutMs]
 * @returns {Promise<Response>}
 */
export function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException("Timed out", "TimeoutError")), timeoutMs);
  const external = options.signal;
  if (external) {
    if (external.aborted) ctrl.abort(external.reason);
    else external.addEventListener("abort", () => ctrl.abort(external.reason), { once: true });
  }
  // The timer is not cleared when the headers arrive, so a slow body is cut off too.
  // Aborting after a finished read does nothing.
  return fetch(url, { ...options, signal: ctrl.signal }).catch(e => {
    clearTimeout(timer);
    throw e;
  });
}

/**
 * Read a response body as text, stopping after maxBytes.
 * @param {Response} response
 * @param {number} maxBytes
 * @returns {Promise<{text: string, truncated: boolean}>}
 */
export async function readTextCapped(response, maxBytes) {
  if (!response.body?.getReader) {
    const t = await response.text();
    return { text: t.slice(0, maxBytes), truncated: t.length > maxBytes };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (bytes >= maxBytes) {
      try { await reader.cancel(); } catch {}
      return { text: text + decoder.decode(), truncated: true };
    }
  }
  return { text: text + decoder.decode(), truncated: false };
}
