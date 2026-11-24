import { fetchWithTimeout, readTextCapped } from "./fetch-helper.js";
import { parseCompetitorHtml } from "./parse-competitor.js";
import { isLocalUrl } from "./url-safety.js";

const MAX_HTML_BYTES = 5 * 1024 * 1024;

/**
 * Fetch a competitor page and parse it. Runs in the popup, which has DOMParser.
 * Needs the optional "all sites" permission.
 * shortcut: a charset declared only in <meta charset> still decodes as UTF-8.
 * @param {string} url
 * @returns {Promise<Object>} parsed snapshot (see parseCompetitorHtml)
 */
export async function fetchCompetitor(url) {
  if (isLocalUrl(url)) throw new Error("Local and private-network addresses are not fetched.");
  const r = await fetchWithTimeout(url, { credentials: "omit", redirect: "follow" });
  if (r.url && isLocalUrl(r.url)) {
    try { await r.body?.cancel(); } catch {}
    throw new Error("The page redirects to a local or private-network address; Needle does not read it.");
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const type = r.headers.get("content-type") || "";
  if (type && !/html|xml/i.test(type)) throw new Error(`Not an HTML page (${type.split(";")[0]})`);
  const { text } = await readTextCapped(r, MAX_HTML_BYTES);
  const finalUrl = r.url || url;
  return parseCompetitorHtml(text, finalUrl);
}
