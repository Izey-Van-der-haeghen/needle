import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchPageSpeed, runPageSpeed, fetchDataForSeo } from "../lib/offpage.js";

const psiResponse = (perfScore = 0.85) => ({
  lighthouseResult: {
    categories: {
      performance: {
        score: perfScore,
        auditRefs: [
          { id: "first-contentful-paint", group: "metrics" },
          { id: "render-blocking-insight", group: "insights" },
          { id: "unused-javascript", group: "diagnostics" },
          { id: "modern-image-formats", group: "diagnostics" },
          { id: "hidden-audit", group: "hidden" }
        ]
      }
    },
    audits: {
      "first-contentful-paint": { numericValue: 1234, score: 0.2 },
      "render-blocking-insight": { score: 0, title: "Render-blocking requests", description: "Fix it [Learn more](x)", details: { overallSavingsMs: 900 } },
      "unused-javascript": { score: 0.5, title: "Reduce unused JavaScript", description: "", displayValue: "50 KiB", details: { overallSavingsMs: 200 } },
      "modern-image-formats": { score: 1, title: "Modern formats" },
      "hidden-audit": { score: 0, title: "Hidden" }
    }
  },
  loadingExperience: {
    origin_fallback: true,
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2500, category: "AVERAGE" },
      INTERACTION_TO_NEXT_PAINT: { percentile: 150, category: "FAST" },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5, category: "FAST" }
    }
  }
});

const ok = (json) => ({ ok: true, status: 200, json: async () => json });

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.fetch;
});

describe("fetchPageSpeed", () => {
  it("reads scores and field data, with CLS as the real value and the origin fallback flagged", async () => {
    globalThis.fetch = vi.fn(async () => ok(psiResponse(0.9)));
    const r = await fetchPageSpeed("https://example.com", "key", "mobile");
    expect(r).toMatchObject({ performanceScore: 90, lcp: 2500, lcpCategory: "AVERAGE", cls: 0.05, originFallback: true, hasFieldData: true });
    expect(globalThis.fetch.mock.calls[0][0]).toContain("key=key");
  });

  it("lists failing audits from the performance category by group, not by a fixed list of IDs", async () => {
    globalThis.fetch = vi.fn(async () => ok(psiResponse(0.5)));
    const r = await fetchPageSpeed("https://example.com", "key");
    expect(r.opportunities.map((o) => o.id)).toEqual(["render-blocking-insight", "unused-javascript"]);
    expect(r.opportunities[0].description).toBe("Fix it");
  });

  it("explains a 429 without a key as a missing key", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }));
    await expect(fetchPageSpeed("https://example.com", "")).rejects.toThrow(/API key/);
  });
});

describe("runPageSpeed", () => {
  it("returns mobile and desktop, and throws only when both fail", async () => {
    globalThis.fetch = vi.fn(async (url) => (url.includes("strategy=desktop") ? { ok: false, status: 500 } : ok(psiResponse())));
    const r = await runPageSpeed("https://example.com", "key");
    expect(r.mobile.performanceScore).toBe(85);
    expect(r.desktop.error).toMatch(/500/);

    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500 }));
    await expect(runPageSpeed("https://example.com", "key")).rejects.toThrow(/500/);
  });
});

describe("fetchDataForSeo", () => {
  const ranked = { tasks: [{ status_code: 20000, cost: 0.0101, result: [{ items: [
    { keyword_data: { keyword: "kw1", keyword_info: { search_volume: 100, cpc: 0.5 } }, ranked_serp_element: { serp_item: { type: "organic", rank_group: 3, rank_absolute: 7 } } },
    { keyword_data: { keyword: "kw2", keyword_info: { search_volume: 50 } }, ranked_serp_element: { serp_item: { type: "featured_snippet", rank_group: 1, rank_absolute: 2 } } }
  ] }] }] };
  const summary = { tasks: [{ status_code: 20000, cost: 0.0101, result: [{ items: [{ metrics: { organic: { count: 500, etv: 1200 } } }] }] }] };

  it("reads organic positions (rank_group), flags featured snippets and asks only for organic results", async () => {
    globalThis.fetch = vi.fn(async (url) => ok(url.includes("ranked_keywords") ? ranked : summary));
    const r = await fetchDataForSeo("https://www.example.com/page#section", "u", "p", 2826, "en");
    expect(r).toMatchObject({ organicKeywords: 500, organicTraffic: 1200, locationCode: 2826, languageCode: "en" });
    expect(r.topKeywords.map((k) => [k.keyword, k.pos, k.isFeaturedSnippet])).toEqual([["kw1", 3, false], ["kw2", 1, true]]);
    expect(r.cost).toBeCloseTo(0.0202);

    const bodies = Object.fromEntries(globalThis.fetch.mock.calls.map(([url, opts]) => [url.split("/").slice(-2)[0], JSON.parse(opts.body)[0]]));
    expect(bodies.ranked_keywords).toMatchObject({ target: "https://www.example.com/page", item_types: ["organic", "featured_snippet"] });
    expect(bodies.ranked_keywords).not.toHaveProperty("target_type");
    expect(bodies.domain_rank_overview.target).toBe("example.com");
  });

  it("throws the task's own error when DataForSEO answers HTTP 200 with a failed task", async () => {
    globalThis.fetch = vi.fn(async () => ok({ tasks: [{ status_code: 40200, status_message: "Payment Required." }] }));
    await expect(fetchDataForSeo("https://example.com/", "u", "p", 2840, "en")).rejects.toThrow("Payment Required.");
  });

  it("explains a rejected login", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 401 }));
    await expect(fetchDataForSeo("https://example.com/", "u", "p", 2840, "en")).rejects.toThrow(/login or password/);
  });
});

describe("readAiOverview", () => {
  it("collects the AI Overview's cited pages from the item and its elements, once each", async () => {
    const { readAiOverview } = await import("../lib/serp.js");
    const r = readAiOverview([
      { type: "organic" },
      { type: "ai_overview", references: [{ url: "https://a.com/x", domain: "a.com", title: "A" }],
        items: [{ type: "ai_overview_element", references: [{ url: "https://b.com/y", title: "B" }, { url: "https://a.com/x" }] }] }
    ]);
    expect(r).toEqual({ present: true, references: [{ domain: "a.com", url: "https://a.com/x", title: "A" }, { domain: "b.com", url: "https://b.com/y", title: "B" }] });
    expect(readAiOverview([{ type: "organic" }])).toEqual({ present: false, references: [] });
  });
});
