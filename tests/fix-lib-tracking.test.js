// Full check of 25 November 2026, P2-5: an empty "?" is not another URL.
import { describe, it, expect } from "vitest";
import { withoutTracking, urlKey, exactUrlKey } from "../lib/urls.js";
import { collectFindings } from "../lib/findings.js";
import { computeIndexability } from "../lib/popup-compute.js";
import { validateHreflang } from "../lib/hreflang.js";
import { alternatesOf } from "../lib/hreflang-cluster.js";
import { findInSitemaps } from "../lib/sitemap-check.js";

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

// Review of the P2-5 fix: withoutTracking drops empty parameters, so the keys that compare its
// result with hreflang and sitemap addresses must drop them too, or a page no longer finds itself.
describe("a page with empty parameters still finds its own address", () => {
  const pages = ["https://e.com/p?a=1&", "https://e.com/p?&", "https://e.com/p?a=1&&b=2", "https://e.com/p?", "https://e.com/p?a=1"];

  it("urlKey and exactUrlKey drop empty parameters as withoutTracking does", () => {
    for (const url of pages) {
      expect(urlKey(withoutTracking(url)), url).toBe(urlKey(url));
      expect(exactUrlKey(withoutTracking(url)), url).toBe(exactUrlKey(url));
    }
    expect(urlKey("https://e.com/p?a=1&")).toBe("https://e.com/p?a=1");
    expect(urlKey("https://e.com/p?&")).toBe("https://e.com/p");
    // A parameter without a value is not empty.
    expect(urlKey("https://e.com/p?a")).not.toBe(urlKey("https://e.com/p"));
    expect(urlKey("https://e.com/p?a=1&b=2")).not.toBe(urlKey("https://e.com/p?a=1"));
  });

  it("finds the self-referencing hreflang", () => {
    for (const url of pages) {
      const tags = [{ lang: "en", href: url }, { lang: "x-default", href: url }];
      const msgs = validateHreflang(tags, withoutTracking(url)).map((i) => i.msg);
      expect(msgs, url).not.toContain("Missing self-referencing hreflang");
    }
    // Control: a page that really lacks one.
    expect(validateHreflang([{ lang: "en", href: "https://e.com/other" }], withoutTracking("https://e.com/p?a=1&")).map((i) => i.msg)).toContain("Missing self-referencing hreflang");
  });

  it("doesn't list the page itself as an alternate", () => {
    for (const url of pages) {
      const tags = [{ lang: "en", href: url }, { lang: "fr", href: "https://e.com/fr/p?a=1&" }];
      expect(alternatesOf(withoutTracking(url), tags).map((a) => a.lang), url).toEqual(["fr"]);
    }
  });

  it("finds the page in a sitemap that lists it as written", async () => {
    for (const url of pages) {
      const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${url.replace(/&/g, "&amp;")}</loc></url></urlset>`;
      const fetcher = async (reqs) => reqs.map(() => ({ ok: true, status: 200, text: xml, headers: {} }));
      expect(await findInSitemaps(withoutTracking(url), ["https://e.com/sitemap.xml"], fetcher), url).toMatchObject({ found: true });
    }
  });
});
