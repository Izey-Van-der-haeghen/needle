import { describe, it, expect } from "vitest";
import { detectMarketFromUrl, computeHealthScore, computeIndexability } from "../lib/popup-compute.js";
import { isSafeHttpUrl } from "../lib/url-safety.js";

describe("detectMarketFromUrl", () => {
  it("detects .be → Belgium NL", () => {
    expect(detectMarketFromUrl("https://www.example.be/foo")).toEqual({ code: 2056, lang: "nl" });
  });
  it("detects .nl → Netherlands NL", () => {
    expect(detectMarketFromUrl("https://www.example.nl/")).toEqual({ code: 2528, lang: "nl" });
  });
  it("detects .co.uk → UK EN (multi-part)", () => {
    expect(detectMarketFromUrl("https://www.example.co.uk/page")).toEqual({ code: 2826, lang: "en" });
  });
  it("detects .com.au → Australia EN", () => {
    expect(detectMarketFromUrl("https://shop.example.com.au")).toEqual({ code: 2036, lang: "en" });
  });
  it("returns null for unknown TLD", () => {
    expect(detectMarketFromUrl("https://example.example")).toBe(null);
  });
  it("returns null for invalid URL", () => {
    expect(detectMarketFromUrl("not-a-url")).toBe(null);
  });
});

describe("isSafeHttpUrl", () => {
  it("accepts http", () => {
    expect(isSafeHttpUrl("http://example.com")).toBe(true);
  });
  it("accepts https", () => {
    expect(isSafeHttpUrl("https://example.com/foo")).toBe(true);
  });
  it("rejects javascript:", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
  });
  it("rejects data:", () => {
    expect(isSafeHttpUrl("data:text/html,<script>")).toBe(false);
  });
  it("rejects empty/null", () => {
    expect(isSafeHttpUrl("")).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
    expect(isSafeHttpUrl(undefined)).toBe(false);
  });
  it("rejects malformed URLs", () => {
    expect(isSafeHttpUrl("not a url")).toBe(false);
  });
});

const baseOnpage = {
  url: "https://example.com/",
  title: "A reasonable title length around fifty characters",
  description: "A reasonable description between seventy and one hundred and sixty characters long for SEO purposes that ranks well.",
  canonical: "https://example.com/",
  robots: "",
  headings: [{ level: 1, text: "Main" }, { level: 2, text: "Section" }],
  images: [],
  schema: [],
  hreflang: [],
  wordCount: 800,
  mainContentWordCount: 700,
  og: { title: "OG", image: "https://example.com/og.png" }
};

describe("computeIndexability", () => {
  it("returns 'good' for clean page", () => {
    const r = computeIndexability(baseOnpage, { status: 200, headers: {}, robotsTxt: { pathAllowed: { allowed: true } } });
    expect(r.level).toBe("good");
    expect(r.verdict).toBe("Indexable");
  });

  it("returns 'bad' for noindex meta", () => {
    const r = computeIndexability({ ...baseOnpage, robots: "noindex,nofollow" }, { status: 200, headers: {}, robotsTxt: {} });
    expect(r.level).toBe("bad");
  });

  it("returns 'bad' for 404 status", () => {
    const r = computeIndexability(baseOnpage, { status: 404, headers: {}, robotsTxt: {} });
    expect(r.level).toBe("bad");
  });

  it("returns 'bad' for blocked by robots.txt", () => {
    const r = computeIndexability(baseOnpage, { status: 200, headers: {}, robotsTxt: { pathAllowed: { allowed: false, rule: "Disallow: /" } } });
    expect(r.level).toBe("bad");
  });

  it("returns 'warn' for canonical pointing elsewhere", () => {
    const r = computeIndexability({ ...baseOnpage, canonical: "https://example.com/other" }, { status: 200, headers: {}, robotsTxt: {} });
    expect(r.level).toBe("warn");
    expect(r.verdict).toBe("Canonical points elsewhere");
  });
});

describe("computeHealthScore", () => {
  it("scores a clean page high", () => {
    const r = computeHealthScore(baseOnpage, { status: 200, headers: {}, robotsTxt: {} });
    expect(r.score).toBeGreaterThan(70);
    expect(["A", "B"]).toContain(r.grade);
  });

  it("returns null for missing op data", () => {
    expect(computeHealthScore(null, null)).toBe(null);
  });

  it("scores low for noindex page", () => {
    const r = computeHealthScore({ ...baseOnpage, robots: "noindex" }, { status: 200, headers: {}, robotsTxt: {} });
    expect(r.score).toBeLessThan(70);
  });

  it("returns score 0..100 grade A..F", () => {
    const r = computeHealthScore(baseOnpage, { status: 200, headers: {}, robotsTxt: {} });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(["A", "B", "C", "D", "F"]).toContain(r.grade);
  });
});

import { robotsBlocksIndexing, canonicalFromLinkHeader } from "../lib/popup-compute.js";

describe("robotsBlocksIndexing", () => {
  it.each([
    ["noindex", true], ["NOINDEX, nofollow", true], ["none", true], ["googlebot: noindex", true],
    ["bingbot: noindex", false], ["max-image-preview:none", false], ["max-snippet: 50, index", false],
    ["bingbot: noindex, googlebot: none", true], ["", false]
  ])("%s → %s", (value, expected) => expect(robotsBlocksIndexing(value)).toBe(expected));
});

describe("computeIndexability — more cases", () => {
  const op = (extra = {}) => ({ url: "https://e.com/page", canonical: "https://e.com/page", robots: "", headings: [], images: [], ...extra });
  const tech = (extra = {}) => ({ status: 200, headers: {}, robotsTxt: { ok: true, pathAllowed: { allowed: true, rule: null } }, ...extra });

  it("says 'Not verified' when the server check failed, instead of 'Indexable'", () => {
    const v = computeIndexability(op(), { status: 0, headers: {} });
    expect(v).toMatchObject({ level: "warn", verdict: "Not verified" });
  });

  it("ignores #fragments when comparing the canonical with the URL", () => {
    const v = computeIndexability(op({ url: "https://e.com/page#reviews" }), tech());
    expect(v.verdict).toBe("Indexable");
  });

  it("calls a robots.txt block 'Blocked from crawling', not 'Not indexable'", () => {
    const v = computeIndexability(op(), tech({ robotsTxt: { ok: true, pathAllowed: { allowed: false, rule: "Disallow: /" } } }));
    expect(v).toMatchObject({ level: "bad", verdict: "Blocked from crawling" });
  });

  it("flags a redirecting URL", () => {
    const v = computeIndexability(op(), tech({ redirected: true, finalUrl: "https://e.com/new" }));
    expect(v.verdict).toBe("Redirected");
  });

  it("reads noindex from a googlebot meta and from X-Robots-Tag 'none'", () => {
    expect(computeIndexability(op({ robots: "index, follow, noindex" }), tech()).verdict).toBe("Not indexable");
    expect(computeIndexability(op(), tech({ headers: { "x-robots-tag": "none" } })).verdict).toBe("Not indexable");
    expect(computeIndexability(op(), tech({ headers: { "x-robots-tag": "bingbot: noindex" } })).verdict).toBe("Indexable");
  });

  it("warns about several canonicals and a canonical in <body>", () => {
    const v = computeIndexability(op({ canonicalDistinct: 2, canonicalOutsideHead: true }), tech());
    expect(v.issues.map((i) => i.msg).join(" | ")).toMatch(/2 different canonical URLs.*outside <head>/);
  });

  it("uses a canonical from the HTTP Link header when the page has none", () => {
    expect(canonicalFromLinkHeader('<https://e.com/page>; rel="canonical"')).toBe("https://e.com/page");
    const v = computeIndexability(op({ canonical: "" }), tech({ headers: { link: '<https://e.com/other>; rel="canonical"' } }));
    expect(v.verdict).toBe("Canonical points elsewhere");
  });
});

describe("detectMarketFromUrl — page language", () => {
  it("gives a French Belgian page the French market", () => {
    expect(detectMarketFromUrl("https://www.example.be/fr/", "fr-BE")).toEqual({ code: 2056, lang: "fr" });
  });
  it("keeps the TLD default for a language the market doesn't have", () => {
    expect(detectMarketFromUrl("https://www.example.nl/", "en")).toEqual({ code: 2528, lang: "nl" });
  });
});
