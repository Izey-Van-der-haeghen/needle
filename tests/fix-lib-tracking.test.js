// Full check of 25 November 2026, P2-5: an empty "?" is not another URL.
import { describe, it, expect } from "vitest";
import { withoutTracking } from "../lib/urls.js";
import { collectFindings } from "../lib/findings.js";
import { computeIndexability } from "../lib/popup-compute.js";

describe("withoutTracking and an empty query", () => {
  it("drops a bare ? and ?&", () => {
    expect(withoutTracking("https://a.example/p?")).toBe("https://a.example/p");
    expect(withoutTracking("https://a.example/p?&")).toBe("https://a.example/p");
    expect(withoutTracking("https://a.example/repairs/?#top")).toBe("https://a.example/repairs/");
    expect(withoutTracking("https://a.example/p?a=1&&b=2&")).toBe("https://a.example/p?a=1&b=2");
  });

  it("keeps a query that has parameters", () => {
    expect(withoutTracking("https://a.example/p?page=2")).toBe("https://a.example/p?page=2");
    expect(withoutTracking("https://a.example/p?page=2&utm_source=x")).toBe("https://a.example/p?page=2");
  });

  it("changes nothing when a tracking parameter is added", () => {
    const urls = ["https://a.example/p", "https://a.example/p?", "https://a.example/p?&", "https://a.example/p?page=2", "https://a.example/p?a=1&", "https://a.example/"];
    for (const url of urls) {
      const tagged = `${url}${url.includes("?") ? "&" : "?"}utm_source=x`;
      expect(withoutTracking(tagged), tagged).toBe(withoutTracking(url));
    }
  });
});

describe("the canonical check on a tab URL that ends in ?", () => {
  const page = (url, canonical) => ({ url, canonical, title: "A good title for this page, about forty chars", description: "x".repeat(120), robots: "", lang: "en", headings: [{ level: 1, text: "A" }], images: [], schema: [], hreflang: [], links: { details: [] }, og: { image: "https://e.com/og.jpg" }, mainContentWordCount: 600 });
  const tech = { status: 200, headers: {}, robotsTxt: { ok: true, pathAllowed: { allowed: true } } };
  const elsewhere = (url, canonical) => collectFindings({ onpage: page(url, canonical) }).some((f) => f.id === "canonical-elsewhere");

  it("doesn't say the canonical points to another URL", () => {
    expect(elsewhere("https://e.com/repairs/?", "https://e.com/repairs/")).toBe(false);
    expect(elsewhere("https://e.com/repairs/?&", "https://e.com/repairs/")).toBe(false);
    expect(elsewhere("https://e.com/repairs/", "https://e.com/repairs/?")).toBe(false);
    expect(computeIndexability(page("https://e.com/repairs/?", "https://e.com/repairs/"), tech).verdict).not.toBe("Canonical points elsewhere");
  });

  it("still does when the query has a parameter", () => {
    expect(elsewhere("https://e.com/repairs/?page=2", "https://e.com/repairs/")).toBe(true);
    expect(computeIndexability(page("https://e.com/repairs/?page=2", "https://e.com/repairs/"), tech).verdict).toBe("Canonical points elsewhere");
  });
});
