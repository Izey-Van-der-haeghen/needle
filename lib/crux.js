import { fetchWithTimeout } from "./fetch-helper.js";
import { UserError } from "./errors.js";

/**
 * Core Web Vitals over time from the Chrome UX Report History API: weekly
 * 75th-percentile values for the last 25 weeks, for the page or else its site.
 * Free with a Google API key that has the "Chrome UX Report API" enabled.
 */

const METRICS = {
  largest_contentful_paint: "lcp",
  interaction_to_next_paint: "inp",
  cumulative_layout_shift: "cls"
};
/** "Good" thresholds Google uses for each metric. */
export const CWV_GOOD = { lcp: 2500, inp: 200, cls: 0.1 };
export const CWV_POOR = { lcp: 4000, inp: 500, cls: 0.25 };

const ymd = (d) => (d ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : "");

/** Turn an API record into {scope, weeks, lcp, inp, cls}. Exported for tests. */
export function readHistoryRecord(json, scope) {
  const rec = json?.record || {};
  const out = { scope, weeks: (rec.collectionPeriods || []).map((p) => ymd(p.lastDate)), lcp: [], inp: [], cls: [] };
  for (const [api, key] of Object.entries(METRICS)) {
    const p75 = rec.metrics?.[api]?.percentilesTimeseries?.p75s || [];
    out[key] = p75.map((v) => (v == null || v === "NaN" ? null : Number(v)));
  }
  return out;
}

/**
 * @param {string} pageUrl
 * @param {string} apiKey
 * @param {{formFactor?: "PHONE"|"DESKTOP", fetchImpl?: Function}} [opts]
 */
export async function fetchCruxHistory(pageUrl, apiKey, { formFactor = "PHONE", fetchImpl } = {}) {
  if (!apiKey) throw new UserError("The trend needs a Google API key. Add one in Settings.");
  const u = new URL(pageUrl);
  u.hash = "";
  const doFetch = fetchImpl || ((url, opts) => fetchWithTimeout(url, opts, 20000));
  const ask = (target) => doFetch(`https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...target, formFactor, metrics: Object.keys(METRICS), collectionPeriodCount: 25 })
  });
  for (const [target, scope] of [[{ url: u.href }, "page"], [{ origin: u.origin }, "site"]]) {
    const r = await ask(target);
    if (r.status === 404) continue; // not enough real-user data at this level
    if (r.status === 400 || r.status === 403) {
      throw new UserError("Google refused the key for the Chrome UX Report API. Enable that API for your key (Settings shows how).");
    }
    if (r.status === 429) throw new UserError("The Chrome UX Report quota for this key is used up. Try again later.");
    if (!r.ok) throw new UserError(`The Chrome UX Report answered HTTP ${r.status}.`);
    return readHistoryRecord(await r.json(), scope);
  }
  throw new UserError("Not enough Chrome users visit this page or site for real-user data.");
}
