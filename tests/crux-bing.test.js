import { describe, it, expect, vi } from "vitest";
import { fetchCruxHistory, readHistoryRecord } from "../lib/crux.js";
import { fetchBingPage, pickSite, summariseQueries, parseMsDate } from "../lib/bing.js";

const record = {
  record: {
    collectionPeriods: [{ lastDate: { year: 2026, month: 11, day: 1 } }, { lastDate: { year: 2026, month: 11, day: 8 } }],
    metrics: {
      largest_contentful_paint: { percentilesTimeseries: { p75s: [2600, 2400] } },
      interaction_to_next_paint: { percentilesTimeseries: { p75s: [180, null] } },
      cumulative_layout_shift: { percentilesTimeseries: { p75s: ["0.12", "0.08"] } }
    }
  }
};
const json = (status, body) => ({ status, ok: status < 400, json: async () => body, text: async () => JSON.stringify(body) });

describe("CrUX history", () => {
  it("reads weekly p75 values per metric", () => {
    expect(readHistoryRecord(record, "page")).toEqual({ scope: "page", weeks: ["2026-11-01", "2026-11-08"], lcp: [2600, 2400], inp: [180, null], cls: [0.12, 0.08] });
  });

  it("falls back from the page to the whole site when the page has too little data", async () => {
    const f = vi.fn(async (_u, opts) => (JSON.parse(opts.body).url ? json(404, {}) : json(200, record)));
    const r = await fetchCruxHistory("https://e.com/page#x", "KEY", { fetchImpl: f });
    expect(r.scope).toBe("site");
    expect(JSON.parse(f.mock.calls[1][1].body).origin).toBe("https://e.com");
  });

  it("explains a key without the Chrome UX Report API enabled", async () => {
    await expect(fetchCruxHistory("https://e.com/", "KEY", { fetchImpl: async () => json(403, {}) })).rejects.toThrow(/Enable that API/);
  });
});

describe("Bing Webmaster Tools", () => {
  it("picks the most specific verified site for a page", () => {
    const sites = [{ Url: "https://www.e.com/", IsVerified: true }, { Url: "https://www.e.com/blog/", IsVerified: true }, { Url: "https://other.com/", IsVerified: true }];
    expect(pickSite(sites, "https://www.e.com/blog/post")).toBe("https://www.e.com/blog/");
    expect(pickSite(sites, "https://e.com/shop")).toBe("https://www.e.com/");
    expect(pickSite(sites, "https://nope.com/")).toBeNull();
  });

  it("sums daily rows per query", () => {
    const rows = [
      { Query: "bike repair", Clicks: 3, Impressions: 40, AvgImpressionPosition: 4 },
      { Query: "bike repair", Clicks: 1, Impressions: 60, AvgImpressionPosition: 6 },
      { Query: "puncture", Clicks: 0, Impressions: 10, AvgImpressionPosition: 12 }
    ];
    expect(summariseQueries(rows)).toEqual([
      { query: "bike repair", clicks: 4, impressions: 100, position: 5.2 },
      { query: "puncture", clicks: 0, impressions: 10, position: 12 }
    ]);
  });

  it("reads Microsoft JSON dates", () => {
    expect(parseMsDate("/Date(1794787200000-0700)/")).toBe("2026-11-16");
  });

  it("returns crawl info and queries for the page", async () => {
    const f = vi.fn(async (url) => {
      if (url.includes("GetUserSites")) return json(200, { d: [{ Url: "https://e.com/", IsVerified: true }] });
      if (url.includes("GetUrlInfo")) return json(200, { d: { HttpStatus: 200, LastCrawledDate: "/Date(1794787200000)/" } });
      return json(200, { d: [{ Query: "q", Clicks: 2, Impressions: 20, AvgImpressionPosition: 3 }] });
    });
    const r = await fetchBingPage("https://e.com/page", "KEY", { fetchImpl: f });
    expect(r).toMatchObject({ site: "https://e.com/", crawl: { status: 200, lastCrawled: "2026-11-16" }, clicks: 2, impressions: 20 });
    expect(f.mock.calls.every(([u]) => u.startsWith("https://ssl.bing.com/webmaster/api.svc/json/") && u.includes("apikey=KEY"))).toBe(true);
  });

  it("says when the site isn't in the account", async () => {
    const f = async () => json(200, { d: [] });
    await expect(fetchBingPage("https://e.com/", "KEY", { fetchImpl: f })).rejects.toThrow(/isn't in your Bing/);
  });
});
