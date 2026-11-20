import { fetchWithTimeout } from "./fetch-helper.js";
import { PSI_TIMEOUT_MS } from "./constants.js";
import { UserError } from "./errors.js";

/**
 * Approximate DataForSEO prices in US dollars, shown before a paid lookup.
 * Check the `cost` field of a real response if prices change.
 */
export const DFS_COST = {
  rankedKeywords: 0.013, // ranked_keywords/live, 10 items
  domainOverview: 0.012, // domain_rank_overview/live
  serp: 0.004 // serp/google/organic/live/advanced, depth 20
};

/**
 * PageSpeed Insights for one strategy. Sends the page URL to Google.
 * @param {string} url
 * @param {string} [apiKey]
 * @param {"mobile"|"desktop"} [strategy]
 * @param {AbortSignal} [signal]
 */
export async function fetchPageSpeed(url, apiKey, strategy = "mobile", signal) {
  const params = new URLSearchParams({ url, strategy });
  // All four Lighthouse categories come from the same single call.
  ["performance", "accessibility", "best-practices", "seo"].forEach(c => params.append("category", c));
  if (apiKey) params.set("key", apiKey);

  const r = await fetchWithTimeout(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, { signal }, PSI_TIMEOUT_MS);
  if (!r.ok) {
    if (r.status === 429) {
      throw new UserError(apiKey
        ? "PageSpeed Insights quota reached for this API key. Try again later."
        : "PageSpeed Insights needs a free API key. Add one in Settings.");
    }
    if (r.status === 400) throw new UserError("PageSpeed Insights could not load this URL (it must be public).");
    throw new UserError(`PageSpeed Insights answered HTTP ${r.status}.`);
  }
  const json = await r.json();
  const lh = json.lighthouseResult;
  const cwv = json.loadingExperience?.metrics || {};

  // Every failing audit PSI shows under Insights and Diagnostics. Read by group, not by
  // audit ID: Lighthouse 12 and 13 renamed or removed most of the old IDs.
  const opportunities = (lh?.categories?.performance?.auditRefs || [])
    .filter(ref => ref.group !== "metrics" && ref.group !== "hidden")
    .map(({ id }) => {
      const audit = lh.audits?.[id];
      if (!audit || audit.score == null || audit.score >= 0.9) return null;
      return {
        id,
        title: audit.title,
        description: (audit.description || "").split("[Learn")[0].trim(),
        displayValue: audit.displayValue || "",
        score: audit.score,
        savingsMs: audit.details?.overallSavingsMs || audit.metricSavings?.LCP || 0
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.savingsMs || 0) - (a.savingsMs || 0));

  const catScore = (id) => {
    const s = lh?.categories?.[id]?.score;
    return s == null ? null : Math.round(s * 100);
  };

  return {
    strategy,
    performanceScore: catScore("performance"),
    accessibilityScore: catScore("accessibility"),
    bestPracticesScore: catScore("best-practices"),
    seoScore: catScore("seo"),
    lcp: cwv.LARGEST_CONTENTFUL_PAINT_MS?.percentile,
    lcpCategory: cwv.LARGEST_CONTENTFUL_PAINT_MS?.category,
    inp: cwv.INTERACTION_TO_NEXT_PAINT?.percentile,
    inpCategory: cwv.INTERACTION_TO_NEXT_PAINT?.category,
    // CrUX reports CLS ×100 as an integer percentile; convert to the real value.
    cls: cwv.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile != null ? cwv.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : undefined,
    clsCategory: cwv.CUMULATIVE_LAYOUT_SHIFT_SCORE?.category,
    fcp: lh?.audits?.["first-contentful-paint"]?.numericValue,
    ttfb: cwv.EXPERIMENTAL_TIME_TO_FIRST_BYTE?.percentile,
    hasFieldData: !!json.loadingExperience?.metrics,
    // PSI puts whole-site (origin) data here when the page itself lacks enough real-user data.
    originFallback: !!json.loadingExperience?.origin_fallback,
    opportunities
  };
}

/**
 * PageSpeed Insights for mobile and desktop. Each strategy fails on its own.
 * @param {string} url
 * @param {string} [apiKey]
 * @param {AbortSignal} [signal]
 */
export async function runPageSpeed(url, apiKey, signal) {
  const [mobile, desktop] = await Promise.all([
    fetchPageSpeed(url, apiKey, "mobile", signal).catch(e => ({ error: e.message })),
    fetchPageSpeed(url, apiKey, "desktop", signal).catch(e => ({ error: e.message }))
  ]);
  if (mobile.error && desktop.error) throw new UserError(mobile.error);
  return { mobile, desktop };
}

/** POST one task to DataForSEO and return it; every failure becomes a UserError. */
export async function dfsPost(endpoint, body, auth, signal) {
  const r = await fetchWithTimeout(`https://api.dataforseo.com/v3/${endpoint}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify([body]),
    signal
  });
  if (r.status === 401) throw new UserError("DataForSEO rejected the login or password. Check them in Settings.");
  if (r.status === 402) throw new UserError("Your DataForSEO balance is too low.");
  if (!r.ok) throw new UserError(`DataForSEO answered HTTP ${r.status}.`);
  const json = await r.json();
  // DataForSEO answers HTTP 200 for most failures (no funds, cost limit, bad field);
  // the real status is per task.
  const task = json.tasks?.[0];
  if (task?.status_code !== 20000) {
    throw new UserError(`DataForSEO: ${task?.status_message || json.status_message || "unknown error"}`);
  }
  return task;
}

/**
 * Keywords this page ranks for, plus the domain's overall organic numbers.
 * Paid: about DFS_COST.rankedKeywords + DFS_COST.domainOverview per call.
 * @param {string} url
 * @param {string} login
 * @param {string} password
 * @param {number} locationCode
 * @param {string} languageCode
 * @param {AbortSignal} [signal]
 */
export async function fetchDataForSeo(url, login, password, locationCode, languageCode, signal) {
  const auth = "Basic " + btoa(`${login}:${password}`);
  const u = new URL(url);
  u.hash = ""; // Google never sees fragments, so a #fragment target can only miss.
  // A full https:// URL scopes ranked_keywords to this page; the overview is domain-wide.
  const pageTarget = u.href;
  const domainTarget = u.hostname.replace(/^www\./, "");

  const [ranked, summary] = await Promise.all([
    dfsPost("dataforseo_labs/google/ranked_keywords/live", {
      target: pageTarget,
      location_code: locationCode,
      language_code: languageCode,
      item_types: ["organic", "featured_snippet"],
      limit: 10,
      order_by: ["keyword_data.keyword_info.search_volume,desc"]
    }, auth, signal),
    dfsPost("dataforseo_labs/google/domain_rank_overview/live", {
      target: domainTarget,
      location_code: locationCode,
      language_code: languageCode
    }, auth, signal)
  ]);

  const items = ranked.result?.[0]?.items || [];
  const organic = summary.result?.[0]?.items?.[0]?.metrics?.organic || null;
  const cost = (ranked.cost || 0) + (summary.cost || 0);

  return {
    organicKeywords: organic?.count ?? null,
    organicTraffic: organic?.etv ?? null,
    cost: cost || null,
    topKeywords: items.map(it => ({
      keyword: it.keyword_data?.keyword,
      pos: it.ranked_serp_element?.serp_item?.rank_group,
      isFeaturedSnippet: it.ranked_serp_element?.serp_item?.type === "featured_snippet",
      volume: it.keyword_data?.keyword_info?.search_volume,
      cpc: it.keyword_data?.keyword_info?.cpc
    })),
    locationCode,
    languageCode
  };
}
