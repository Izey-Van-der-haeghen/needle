import { fetchWithTimeout } from "./fetch-helper.js";
import { UserError } from "./errors.js";

/**
 * Bing Webmaster Tools data for the audited page, with the user's own API key
 * (Bing Webmaster Tools → Settings → API Access). Uses Bing's JSON API; the
 * older SOAP and POX endpoints were retired on 31 August 2026.
 */

const BASE = "https://ssl.bing.com/webmaster/api.svc/json/";
export const BING_ORIGINS = ["https://ssl.bing.com/*"];

/** Microsoft JSON dates look like "/Date(1694995200000-0700)/". */
export function parseMsDate(v) {
  const m = String(v || "").match(/\/Date\((-?\d+)/);
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : null;
}

async function call(method, params, apiKey, doFetch) {
  const q = new URLSearchParams({ ...params, apikey: apiKey });
  const r = await doFetch(`${BASE}${method}?${q}`, { method: "GET", credentials: "omit" });
  if (r.status === 401 || r.status === 403) throw new UserError("Bing rejected the API key. Check it in Settings.");
  if (r.status === 400) {
    const text = await r.text().catch(() => "");
    if (/NotAuthorized|not verified|InvalidSite/i.test(text)) throw new UserError("This site isn't verified in your Bing Webmaster Tools account.");
    throw new UserError("Bing didn't accept the request.");
  }
  if (!r.ok) throw new UserError(`Bing Webmaster Tools answered HTTP ${r.status}.`);
  return (await r.json())?.d;
}

/** The verified site in the account that contains this page (longest match). */
export function pickSite(sites, pageUrl) {
  const page = pageUrl.toLowerCase().replace(/^https?:\/\/(www\.)?/, "");
  return (sites || [])
    .filter((s) => s.IsVerified !== false)
    .map((s) => ({ s, key: String(s.Url || "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") }))
    .filter(({ key }) => key && (page === key || page.startsWith(key + "/") || page.startsWith(key + "?")))
    .sort((a, b) => b.key.length - a.key.length)[0]?.s.Url || null;
}

/** Sum the daily rows per query, with an impression-weighted average position. */
export function summariseQueries(rows) {
  const by = new Map();
  for (const r of rows || []) {
    const q = r.Query || "";
    const e = by.get(q) || { query: q, clicks: 0, impressions: 0, posSum: 0, posN: 0 };
    e.clicks += r.Clicks || 0;
    e.impressions += r.Impressions || 0;
    const pos = r.AvgImpressionPosition ?? r.AvgClickPosition;
    if (pos > 0) { e.posSum += pos * (r.Impressions || 1); e.posN += r.Impressions || 1; }
    by.set(q, e);
  }
  return [...by.values()]
    .map((e) => ({ query: e.query, clicks: e.clicks, impressions: e.impressions, position: e.posN ? Math.round((e.posSum / e.posN) * 10) / 10 : null }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
}

/**
 * @param {string} pageUrl
 * @param {string} apiKey
 * @param {{fetchImpl?: Function}} [opts]
 * @returns {Promise<{site: string, crawl: {status: number|null, lastCrawled: string|null, discovered: string|null}|null,
 *            queries: Array<{query, clicks, impressions, position}>, clicks: number, impressions: number}>}
 */
export async function fetchBingPage(pageUrl, apiKey, { fetchImpl } = {}) {
  if (!apiKey) throw new UserError("Add your Bing Webmaster Tools API key in Settings first.");
  const doFetch = fetchImpl || ((url, opts) => fetchWithTimeout(url, opts, 20000));
  const u = new URL(pageUrl);
  u.hash = "";
  const site = pickSite(await call("GetUserSites", {}, apiKey, doFetch), u.href);
  if (!site) throw new UserError("This site isn't in your Bing Webmaster Tools account, or isn't verified yet.");
  const [info, rows] = await Promise.all([
    call("GetUrlInfo", { siteUrl: site, url: u.href }, apiKey, doFetch).catch(() => null),
    // A failed query call throws: "no data" would be cached for hours and look like a real answer.
    call("GetPageQueryStats", { siteUrl: site, page: u.href }, apiKey, doFetch)
  ]);
  const queries = summariseQueries(rows);
  return {
    site,
    crawl: info ? { status: info.HttpStatus ?? null, lastCrawled: parseMsDate(info.LastCrawledDate), discovered: parseMsDate(info.DiscoveryDate) } : null,
    queries: queries.slice(0, 20),
    clicks: queries.reduce((n, q) => n + q.clicks, 0),
    impressions: queries.reduce((n, q) => n + q.impressions, 0)
  };
}
