import { describe, it, expect } from "vitest";
import { analyzeTechnical, readRobots, robotsPathVerdict, extractWordCount } from "../lib/technical.js";

/** A fetcher that answers from a map of URL → partial FetchResult. */
const fakeFetcher = (pages) => async (reqs) => reqs.map((r) => {
  const p = pages[r.url];
  if (!p) return { ok: false, status: 404, url: r.url, headers: {}, text: "" };
  return { ok: (p.status || 200) < 400, status: p.status || 200, url: p.url || r.url, redirected: !!p.redirected, headers: p.headers || {}, text: p.text || "" };
});

const PAGE = "https://www.example.com/shop/item?id=1";

describe("analyzeTechnical", () => {
  it("reads the status, headers, robots.txt for Googlebot, the sitemap and the raw HTML", async () => {
    const r = await analyzeTechnical(PAGE + "#reviews", fakeFetcher({
      [PAGE]: { headers: { "x-robots-tag": "noarchive", "content-type": "text/html" }, text: "<html><body><h1>Item</h1><p>One two three</p><script>var x = 1;</script></body></html>" },
      "https://www.example.com/robots.txt": { headers: { "content-type": "text/plain" }, text: "User-agent: *\nDisallow: /*?\nSitemap: https://www.example.com/sitemap_index.xml\n" },
      "https://www.example.com/sitemap_index.xml": { text: "<?xml version=\"1.0\"?><sitemapindex><sitemap><loc>a</loc></sitemap><sitemap><loc>b</loc></sitemap></sitemapindex>" }
    }));
    expect(r.status).toBe(200);
    expect(r.headers["x-robots-tag"]).toBe("noarchive");
    expect(r.robotsTxt.pathAllowed).toEqual({ allowed: false, rule: "Disallow: /*?" });
    expect(r.sitemap).toMatchObject({ ok: true, isIndex: true, urlCount: 2 });
    expect(r.raw).toMatchObject({ headings: 1, wordCount: 4 });
    expect(r.redirected).toBe(false);
  });

  it("reports a redirecting URL", async () => {
    const r = await analyzeTechnical("http://example.com/old", fakeFetcher({
      "http://example.com/old": { url: "https://example.com/new", redirected: true, text: "<p>x</p>" }
    }));
    expect(r).toMatchObject({ redirected: true, finalUrl: "https://example.com/new" });
  });

  it("does not accept an HTML page as a sitemap (soft 404)", async () => {
    const r = await analyzeTechnical(PAGE, fakeFetcher({
      [PAGE]: { text: "<p>x</p>" },
      "https://www.example.com/sitemap.xml": { headers: { "content-type": "text/html" }, text: "<!doctype html><title>Page not found</title>" }
    }));
    expect(r.sitemap).toMatchObject({ ok: false, reason: "not a sitemap (HTML or empty)" });
  });

  it("gives no robots verdict when robots.txt answers 503 (Google pauses crawling)", async () => {
    const r = await analyzeTechnical(PAGE, fakeFetcher({ [PAGE]: { text: "x" }, "https://www.example.com/robots.txt": { status: 503 } }));
    expect(r.robotsTxt.pathAllowed).toBeNull();
  });

  it("reports a failed page fetch instead of guessing", async () => {
    const r = await analyzeTechnical(PAGE, async (reqs) => reqs.map((q) => ({ ok: false, status: 0, url: q.url, error: "Timed out" })));
    expect(r).toMatchObject({ status: 0, fetchError: "Timed out", raw: null });
  });
});

describe("readRobots and robotsPathVerdict", () => {
  it("treats a missing robots.txt (404) as allow-all", () => {
    const robots = readRobots({ ok: false, status: 404 });
    expect(robotsPathVerdict(robots, "/x")).toEqual({ allowed: true, rule: null });
  });

  it("treats an HTML page served as robots.txt as missing", () => {
    const robots = readRobots({ ok: true, status: 200, headers: { "content-type": "text/html" }, text: "<!doctype html>" });
    expect(robots.ok).toBe(false);
    expect(robotsPathVerdict(robots, "/x")).toEqual({ allowed: true, rule: null });
  });
});

describe("extractWordCount", () => {
  it("counts body text only, without scripts, styles, noscript, SVG and comments", () => {
    const html = "<html><head><title>T</title></head><body><!-- c --><p>één twee</p><noscript>no</noscript><svg><title>i</title></svg><style>p{}</style><p>drie&nbsp;vier</p></body></html>";
    expect(extractWordCount(html)).toBe(4);
  });
});
