import { describe, it, expect, vi, afterEach } from "vitest";
import { computeHealthScore } from "../lib/popup-compute.js";
import { collectFindings } from "../lib/findings.js";
import { buildHtmlReport } from "../lib/export.js";
import { fetchBingPage } from "../lib/bing.js";
import { findInSitemaps } from "../lib/sitemap-check.js";
import { analyzeAIAccess } from "../lib/geo.js";
import { checkHostVariants, isSubdomain } from "../lib/variants.js";
import { pruneCache } from "../lib/cache.js";
import { SECRET_KEYS, CACHE_PREFIXES_BY_SECRET } from "../lib/settings.js";
import { hasUncleanFilename } from "../lib/popup-helpers.js";
import { fetchImageSizes } from "../lib/image-sizer.js";
import { sendWithRetry } from "../lib/popup-messaging.js";

const page = (over = {}) => ({
  url: "https://example.com/a", title: "A title that is long enough to pass", description: "x".repeat(100),
  canonical: "https://example.com/a", viewport: true, lang: "en", wordCount: 800, mainContentWordCount: 800,
  headings: [{ level: 1, text: "Main" }], images: [], schema: [], og: { title: "t", image: "i" }, links: { details: [] }, ...over
});
const tech = { status: 200, headers: {}, robotsTxt: { ok: true, pathAllowed: { allowed: true } }, finalUrl: "https://example.com/a" };
const check = (op, t, label) => computeHealthScore(op, t).checks.find((c) => c.label === label).score;

describe("the score, Fix this first and the report agree", () => {
  it("a hidden H1 counts for half in the score, and gets one finding that says it's hidden", () => {
    const op = page({ headings: [{ level: 1, text: "Hidden", hidden: true }, { level: 2, text: "Visible" }] });
    expect(check(op, tech, "H1 structure")).toBe(0.5);
    const ids = collectFindings({ onpage: op, tech }).map((f) => f.id);
    expect(ids).toContain("h1-hidden");
    expect(ids).not.toContain("h1-missing");
  });

  it("a canonical in the HTTP Link header counts in the score", () => {
    const op = page({ canonical: "" });
    const t = { ...tech, headers: { link: '<https://example.com/a>; rel="canonical"' } };
    expect(check(op, t, "Canonical")).toBe(1);
    expect(collectFindings({ onpage: op, tech: t }).map((f) => f.id)).not.toContain("canonical-missing");
  });

  it("a small sidebar icon without alt is not a content image anywhere", () => {
    const icon = { src: "https://example.com/i.png", context: "sidebar", displayedWidth: 48, displayedHeight: 48, altMissing: true };
    const op = page({ images: [icon] });
    expect(check(op, tech, "Images")).toBe(1);
    expect(collectFindings({ onpage: op, tech }).filter((f) => f.area === "Images")).toEqual([]);
    const html = buildHtmlReport({ url: op.url, onpage: op, technical: tech, offpage: null, geo: null, health: computeHealthScore(op, tech), verdict: null, theme: "light" });
    expect(html).not.toMatch(/1 without alt/);
  });
});

describe("checks that could not measure say so", () => {
  const json = (status, body) => ({ status, ok: status < 400, json: async () => body, text: async () => JSON.stringify(body) });

  it("a failed Bing query call is an error, not 'no data'", async () => {
    const f = vi.fn(async (url) => /GetUserSites/.test(url) ? json(200, { d: [{ Url: "https://example.com/", IsVerified: true }] }) : json(503, {}));
    await expect(fetchBingPage("https://example.com/a", "KEY", { fetchImpl: f })).rejects.toThrow();
  });

  it("a sitemap that answers 500 is 'could not be read', not 'not listed'", async () => {
    const r = await findInSitemaps("https://e.com/a", ["https://e.com/sitemap.xml"], async () => [{ ok: false, status: 500 }]);
    expect(r).toMatchObject({ found: false, unreadable: true, complete: false, unread: 1 });
  });

  it("AI crawler access is checked for the audited path", () => {
    const r = analyzeAIAccess({ text: "User-agent: OAI-SearchBot\nDisallow: /blog/\n" }, "/blog/post");
    expect(r.bots.find((b) => b.ua === "OAI-SearchBot").allowed).toBe(false);
    expect(analyzeAIAccess({ text: "User-agent: OAI-SearchBot\nDisallow: /blog/\n" }, "/shop").blockedSearchCount).toBe(0);
  });

  it("the http/https/www check requests all four versions on .co.uk", async () => {
    const urls = [];
    await checkHostVariants("https://example.co.uk/p", async (url) => { urls.push(url); return { status: 200, url, body: null }; });
    expect(urls.sort()).toEqual(["http://example.co.uk/", "http://www.example.co.uk/", "https://example.co.uk/", "https://www.example.co.uk/"]);
    expect(isSubdomain("shop.example.co.uk")).toBe(true);
    expect(isSubdomain("shop.example.com")).toBe(true);
    expect(isSubdomain("example.com")).toBe(false);
  });
});

describe("paid results stay cached", () => {
  it("free entries don't push a fresh paid result out", () => {
    const now = Date.now();
    const cache = { "dfs::https://e.com/|2840|en": { data: 1, ts: now - 10 * 60 * 1000 } };
    for (let i = 0; i < 100; i++) cache[`onpage::https://e.com/${i}`] = { data: i, ts: now - i };
    expect(Object.keys(pruneCache(cache))).toContain("dfs::https://e.com/|2840|en");
  });

  it("every secret clears only its own service's results", () => {
    expect(Object.keys(CACHE_PREFIXES_BY_SECRET).sort()).toEqual([...SECRET_KEYS].sort());
    expect(CACHE_PREFIXES_BY_SECRET.bingKey).toEqual(["bing::"]);
  });
});

describe("image file names", () => {
  it.each([
    ["https://e.com/iphone-15.jpg", false], ["https://e.com/trail-running-guide-2026.webp", false], ["https://e.com/iso-27001.png", false],
    ["https://e.com/red-shoes.jpg", false], ["https://e.com/IMG_4512.jpg", true], ["https://e.com/hero-1200x630.jpg", true],
    ["https://e.com/photo-scaled.jpg", true], ["https://e.com/3f9a2b7c1d.png", true], ["https://e.com/wp-image-123.png", true]
  ])("%s unclear: %s", (src, unclear) => {
    expect(hasUncleanFilename(src)).toBe(unclear);
  });
});

describe("image sizes", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("reads Content-Length, and falls back to a one-byte range request when HEAD is refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
      if (url.endsWith("a.jpg")) return { ok: true, status: 200, headers: new Headers({ "content-length": "999" }) };
      if (opts.method === "HEAD") return { ok: false, status: 405, headers: new Headers() };
      return { ok: true, status: 206, headers: new Headers({ "content-range": "bytes 0-0/12345" }), body: { cancel: async () => {} } };
    }));
    expect(await fetchImageSizes(["https://img.example/a.jpg", "https://img.example/b.jpg"])).toEqual({ "https://img.example/a.jpg": 999, "https://img.example/b.jpg": 12345 });
  });
});

describe("messages to the background worker", () => {
  afterEach(() => { delete globalThis.chrome; });
  it("retries once while the worker starts, and turns an {error} reply into an exception", async () => {
    const sendMessage = vi.fn()
      .mockRejectedValueOnce(new Error("Could not establish connection. Receiving end does not exist."))
      .mockResolvedValueOnce({ data: 1, age: 0 })
      .mockResolvedValueOnce({ error: "needs-permission", origins: ["https://*/*"] });
    globalThis.chrome = { runtime: { sendMessage } };
    expect(await sendWithRetry({ type: "X" })).toEqual({ data: 1, age: 0 });
    await expect(sendWithRetry({ type: "X" })).rejects.toThrow("needs-permission");
  });
});
