// Fixes from the review round of 1.0.2 (22 November 2026).
import { describe, it, expect, vi, afterEach } from "vitest";
import { safeSendTabMessage } from "../lib/popup-messaging.js";
import { readablePageError } from "../lib/errors.js";

afterEach(() => { delete globalThis.chrome; });

describe("why a tab can't be read, in plain words", () => {
  it("names an offline error page instead of Chrome's 'Frame with ID 0 is showing error page'", () => {
    expect(readablePageError("Frame with ID 0 is showing error page")).toMatch(/^The tab shows an error page instead of the website: no internet connection/);
    expect(readablePageError("The extensions gallery cannot be scripted.")).toBe("Chrome doesn't let extensions read the Chrome Web Store.");
    expect(readablePageError("Cannot access contents of url \"https://x.example/\".")).toMatch(/Click the Needle button/);
    expect(readablePageError("No tab with id: 12.")).toMatch(/tab was closed or changed/);
    expect(readablePageError("")).toBe("The page didn't answer. Reload it, then try again.");
  });

  it("says it once: no 'Needle can't read this page.' prefix, and the side panel still knows a missing permission", async () => {
    globalThis.chrome = {
      tabs: { sendMessage: vi.fn(async () => { throw new Error("Could not establish connection."); }) },
      scripting: { executeScript: vi.fn(async () => { throw new Error("Frame with ID 0 is showing error page"); }) }
    };
    await expect(safeSendTabMessage(1, { type: "ANALYZE_ONPAGE" })).rejects.toMatchObject({ message: expect.stringMatching(/^The tab shows an error page/), noAccess: false });
    globalThis.chrome.scripting.executeScript = vi.fn(async () => { throw new Error("Cannot access contents of url \"https://x.example/\"."); });
    await expect(safeSendTabMessage(1, { type: "ANALYZE_ONPAGE" })).rejects.toMatchObject({ noAccess: true });
  });
});

describe("code review of 1.0.2 (Ponytail)", () => {
  it("a language redirect that ends broken stays broken", async () => {
    const { checkLinks } = await import("../lib/link-checker.js");
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 404, url: "https://site.example/en-us/gone", redirected: true, type: "basic" })));
    const [r] = await checkLinks(["https://site.example/gone"]);
    vi.unstubAllGlobals();
    expect(r.kind).toBe("broken");
    expect(r.language).toBeUndefined();
  });

  it("'same site' knows two-part suffixes and shared hosts", async () => {
    const { isLanguageRedirect } = await import("../lib/link-checker.js");
    expect(isLanguageRedirect("https://shop.example.co.uk/x", "https://www.example.co.uk/en/x")).toBe(true);
    expect(isLanguageRedirect("https://one.co.uk/x", "https://two.co.uk/en/x")).toBe(false);
    expect(isLanguageRedirect("https://alice.github.io/x", "https://bob.github.io/en/x")).toBe(false);
  });

  it("a noindex page also drops the other search-only findings", async () => {
    const { collectFindings } = await import("../lib/findings.js");
    const page = { url: "https://site.example/a", title: "A title that is long enough", description: "d".repeat(100), canonical: "", robots: "noindex",
      headings: [{ level: 1, text: "Hi" }], images: [], links: { details: [] }, og: {}, canonicalDistinct: 2, canonicalOutsideHead: true, descriptionOutsideHead: true,
      schema: [{ type: "Invalid JSON", raw: null }], hreflangOutsideHead: 1 };
    const ids = collectFindings({ onpage: page, tech: { status: 200, headers: {}, robotsTxt: { ok: true, pathAllowed: { allowed: true } } } }).map((f) => f.id);
    for (const id of ["schema-invalid", "desc-body", "hreflang-body", "canonical-body", "canonical-multiple"]) expect(ids).not.toContain(id);
    expect(ids).toContain("noindex-meta");
  });

  it("compares URLs with and without a trailing slash before a ?query", async () => {
    const { urlKey } = await import("../lib/urls.js");
    expect(urlKey("https://site.example/fr/?page=2")).toBe(urlKey("https://site.example/fr?page=2"));
    expect(urlKey("https://site.example/")).toBe("https://site.example");
  });

  it("the server check also names an offline error page in plain words", async () => {
    const { fetchInPage } = await import("../lib/page-fetch.js");
    globalThis.chrome = { scripting: { executeScript: vi.fn(async () => { throw new Error("Frame with ID 0 is showing error page"); }) } };
    await expect(fetchInPage(1, [{ url: "https://site.example/" }])).rejects.toThrow(/^The tab shows an error page instead of the website/);
  });

  it("Settings makes no request without a deadline (the deadlines themselves: tests/options-page.test.js)", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(new URL("../options.js", import.meta.url), "utf8")).not.toMatch(/await fetch\(/);
  });

  it("srcset URLs with commas (w_800,c_fill) stay whole in lazy images", async () => {
    const { loadContentScript } = await import("./helpers/content-harness.js");
    const html = `<!doctype html><html lang="en"><head><title>T</title></head><body><main>
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="L" data-srcset="https://cdn.example/w_800,c_fill/a.jpg 800w, https://cdn.example/w_1600,c_fill/a.jpg 1600w">
    </main></body></html>`;
    const tab = await loadContentScript(html, { url: "https://site.example/" });
    const d = await tab.send({ type: "ANALYZE_ONPAGE" });
    tab.window.close();
    expect(d.images[0].src).toBe("https://cdn.example/w_800,c_fill/a.jpg");
  });
});

describe("design review of 1.0.2 (Impeccable)", () => {
  const page = { url: "https://site.example/a", title: "A title that is long enough", description: "", canonical: "", robots: "noindex",
    headings: [{ level: 1, text: "Hi" }], images: [], links: { details: [] }, og: {}, schema: [] };
  const tech = { status: 200, headers: {}, robotsTxt: { ok: true, pathAllowed: { allowed: true } } };

  it("a noindex page says how many findings it leaves out, and names all of them", async () => {
    const { collectFindings } = await import("../lib/findings.js");
    const f = collectFindings({ onpage: page, tech });
    expect(f.leftOut.map((x) => x.id)).toContain("desc-missing");
    expect(f.find((x) => x.id === "noindex-meta").why).toMatch(/title, description, thin content, canonical, structured data, hreflang, the main image, snippet limits and trust signals/);
    expect(collectFindings({ onpage: { ...page, robots: "" }, tech }).leftOut).toBeUndefined();
  });

  it("one verdict per field: with a known width, the count is information and the finding says 'cut off'", async () => {
    const { charTag, pixelTag } = await import("../lib/popup-helpers.js");
    const { collectFindings } = await import("../lib/findings.js");
    expect(charTag(83, 30, 60, 70, true)).toMatch(/class="tag info">83 characters</);
    expect(pixelTag(764, 580, 600)).toMatch(/class="tag warn".*764 px, cut off/);
    const t = collectFindings({ onpage: { ...page, robots: "", title: "t".repeat(83) }, tech, titlePx: 764 }).find((x) => x.id === "title-long");
    expect(t.title).toBe("Title may be cut off in Google results (764 px)");
  });

  it("only a leading language segment makes a language redirect; common words don't", async () => {
    const { isLanguageRedirect } = await import("../lib/link-checker.js");
    expect(isLanguageRedirect("https://site.example/account", "https://site.example/my/account")).toBe(false);
    expect(isLanguageRedirect("https://site.example/page", "https://site.example/shop/en/page")).toBe(false);
    expect(isLanguageRedirect("https://privacy.microsoft.com/privacystatement", "https://www.microsoft.com/fr-fr/privacy/privacystatement")).toBe(true);
    expect(isLanguageRedirect("https://site.example/", "https://site.example/nl/")).toBe(true);
  });

});

describe("polish review of 1.0.2 (Make interfaces feel better)", () => {
  const read = async (f) => (await import("node:fs")).readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

  // "Got it" focus: tests/popup-whats-new.test.js. Link hints with the URL on its own line: tests/popup-link-check.test.js.

  it("the popup has no static loading line for a note to push down, and Check again keeps its width", async () => {
    expect(await read("popup.html")).not.toMatch(/Reading the page…/);
    expect(await read("popup.css")).toMatch(/#check-broken \{ min-width: 11em; \}/);
  });
});

describe("stress test of 1.0.2 (Break UI)", () => {
  it("max-snippet:-1 (no limit) is not amber; a real limit is", async () => {
    const { limitsSnippets } = await import("../lib/popup-compute.js");
    expect([limitsSnippets("max-snippet:-1"), limitsSnippets("max-snippet:50"), limitsSnippets("nosnippet"), limitsSnippets("max-image-preview:large")]).toEqual([false, true, true, false]);
  });

  it("http → https with a language added is a redirect to fix; a home link may only gain the language", async () => {
    const { isLanguageRedirect } = await import("../lib/link-checker.js");
    expect(isLanguageRedirect("http://site.example/page", "https://site.example/nl-be/page")).toBe(false);
    expect(isLanguageRedirect("https://site.example/", "https://site.example/en/login?next=/")).toBe(false);
    expect(isLanguageRedirect("https://site.example/", "https://site.example/en/")).toBe(true);
  });

  it("noindex in both the meta tag and the header explains the shorter list once, and the copy and report count it", async () => {
    const { collectFindings } = await import("../lib/findings.js");
    const { buildIssuesMarkdown } = await import("../lib/handoff.js");
    const { buildHtmlReport } = await import("../lib/export.js");
    const page = { url: "https://site.example/a", title: "A title that is long enough", description: "", canonical: "", robots: "noindex",
      headings: [{ level: 1, text: "Hi" }], images: [], links: { details: [] }, og: {}, twitter: {}, schema: [], hreflang: [] };
    const tech = { status: 200, headers: { "x-robots-tag": "noindex" }, robotsTxt: { ok: true, pathAllowed: { allowed: true } } };
    const f = collectFindings({ onpage: page, tech });
    expect(f.filter((x) => /leaves out what only matters/.test(x.why)).length).toBe(1);
    expect(buildIssuesMarkdown(page, tech, { findings: f })).toMatch(/\d+ findings? that only matters? in search results (is|are) left out while the page is noindex/);
    expect(buildHtmlReport({ url: page.url, onpage: page, technical: tech, offpage: null, geo: null, health: null, verdict: null, theme: "light", findings: f }))
      .toMatch(/left out while the page is noindex/);
  });

  it("an offline server check names the connection first", async () => {
    const { computeIndexability } = await import("../lib/popup-compute.js");
    const v = computeIndexability({ url: "https://site.example/", robots: "", canonical: "https://site.example/" }, { status: 0 });
    expect(v.issues.find((i) => /not verified/.test(i.msg)).hint).toMatch(/^Check the internet connection and refresh/);
  });
});

describe("dates as the page wrote them (izey.dev, 22 November)", () => {
  it("keeps the day of a midnight timestamp with an offset, instead of shifting it to UTC", async () => {
    const { dateAsWritten, analyzeEEAT } = await import("../lib/geo.js");
    expect(dateAsWritten("2026-11-21T00:00:00+01:00")).toBe("2026-11-21");
    expect(dateAsWritten("2026-11-22T23:30:00-05:00")).toBe("2026-11-22");
    expect(dateAsWritten("2026-11-21")).toBe("2026-11-21");
    expect(dateAsWritten("someday")).toBe("someday");
    const signals = analyzeEEAT({ schema: [{ raw: { "@type": "WebPage", datePublished: "2026-11-21T00:00:00+01:00", dateModified: "2026-11-22T00:00:00+01:00" } }] });
    expect(signals.find((s) => s.label === "Published date").value).toBe("2026-11-21");
    expect(signals.find((s) => s.label === "Modified date").value).toBe("2026-11-22");
  });
});

describe("images on a 2x screen (izey.dev, 22 November)", () => {
  // A portrait shown about 300 px wide on a 2x screen; srcset 320w and 640w, the browser loaded 640w.
  const html = `<!doctype html><html lang="en"><head><title>T</title></head><body><main>
    <img src="p-640.webp" alt="Portrait" width="640" height="852" srcset="p-320.webp 320w, p-640.webp 640w" sizes="320px">
  </main></body></html>`;
  const screen = (shown, loadedFile, dpr = 2) => (window) => {
    window.devicePixelRatio = dpr;
    const P = window.HTMLImageElement.prototype;
    Object.defineProperty(P, "naturalWidth", { get() { return Math.round(loadedFile / dpr); } });
    Object.defineProperty(P, "naturalHeight", { get() { return Math.round(loadedFile * 852 / 640 / dpr); } });
    Object.defineProperty(P, "width", { get() { return shown; } });
    Object.defineProperty(P, "complete", { get() { return true; } });
    Object.defineProperty(P, "currentSrc", { get() { return `https://site.example/p-${loadedFile}.webp`; } });
  };
  const analyze = async (setup) => {
    const { loadContentScript } = await import("./helpers/content-harness.js");
    const tab = await loadContentScript(html, { url: "https://site.example/", setup });
    const d = await tab.send({ type: "ANALYZE_ONPAGE" });
    tab.window.close();
    return d.images[0];
  };

  it("doesn't call the browser's own srcset choice 'much larger than shown'", async () => {
    expect((await analyze(screen(280, 640))).downscaled).toBe(false);
  });

  it("still flags a file far larger than any screen needs", async () => {
    const big = `<!doctype html><html lang="en"><head><title>T</title></head><body><main>
      <img src="h.jpg" alt="Hero" width="2400" height="1600"></main></body></html>`;
    const { loadContentScript } = await import("./helpers/content-harness.js");
    const tab = await loadContentScript(big, { url: "https://site.example/", setup: (w) => {
      const P = w.HTMLImageElement.prototype;
      Object.defineProperty(P, "naturalWidth", { get() { return 2400; } });
      Object.defineProperty(P, "naturalHeight", { get() { return 1600; } });
      Object.defineProperty(P, "width", { get() { return 300; } });
      Object.defineProperty(P, "complete", { get() { return true; } });
    } });
    const d = await tab.send({ type: "ANALYZE_ONPAGE" });
    tab.window.close();
    expect(d.images[0].downscaled).toBe(true);
  });

  it("says when lazy images haven't loaded yet, but not for ones that failed", async () => {
    const { lazyNote } = await import("../lib/image-rules.js");
    expect(lazyNote([{ lazy: true, loaded: false }])).toMatch(/^1 image hasn't loaded yet \(lazy loading\)/);
    expect(lazyNote([{ lazy: true, loaded: false }, { lazy: true, loaded: false }, { lazy: true, loaded: false, brokenLoad: true }])).toMatch(/^2 images haven't loaded yet/);
    expect(lazyNote([{ lazy: true, loaded: true }, { lazy: false, loaded: false }])).toBe("");
  });

  it("a lazy-load placeholder (1×1 GIF in src, real file in data-src) is not judged blurry", async () => {
    const { loadContentScript } = await import("./helpers/content-harness.js");
    const gif = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
    const html = `<!doctype html><html lang="en"><head><title>T</title></head><body><main>
      <img class="lazyload" src="${gif}" data-src="https://site.example/photo.jpg" alt="Photo" width="600" height="400">
    </main></body></html>`;
    const tab = await loadContentScript(html, { url: "https://site.example/", setup: (w) => {
      const P = w.HTMLImageElement.prototype;
      Object.defineProperty(P, "naturalWidth", { get() { return 1; } });
      Object.defineProperty(P, "naturalHeight", { get() { return 1; } });
      Object.defineProperty(P, "width", { get() { return 600; } });
      Object.defineProperty(P, "complete", { get() { return true; } });
      Object.defineProperty(P, "currentSrc", { get() { return gif; } });
    } });
    const d = await tab.send({ type: "ANALYZE_ONPAGE" });
    tab.window.close();
    expect(d.images[0]).toMatchObject({ src: "https://site.example/photo.jpg", loaded: false, upscaled: false, naturalWidth: 600 });
  });
});

describe("full check of 1.0.2: link check progress", () => {
  it("reports each link done, so a slow host doesn't look stuck", async () => {
    const { checkLinks } = await import("../lib/link-checker.js");
    vi.stubGlobal("fetch", vi.fn(async (url) => ({ status: 200, url, redirected: false, type: "basic" })));
    const seen = [];
    await checkLinks(["https://a.example/1", "https://b.example/2", "https://c.example/3"], undefined, "", (done, total) => seen.push(`${done}/${total}`));
    vi.unstubAllGlobals();
    expect(seen).toEqual(["1/3", "2/3", "3/3"]);
  });
});

describe("full check of 1.0.2: public texts and privacy", () => {
  const read = async (f) => (await import("node:fs")).readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

  it("Clear history also forgets the country and language picked per website", async () => {
    const { withoutSiteChoices } = await import("../lib/settings.js");
    const kept = withoutSiteChoices({ activeTab: "ai", marketByHost: { "site.example": {} }, serpMarketByHost: { "site.example": {} } });
    expect(kept).toEqual({ activeTab: "ai" });
    // The buttons themselves: tests/popup-history-clear.test.js and tests/options-page.test.js.
  });

  it("the store's What's new lines are the extension's, for the manifest version", async () => {
    const { WHATS_NEW } = await import("../lib/whats-new.js");
    const version = JSON.parse(await read("manifest.json")).version;
    const listing = await read("store/LISTING.md");
    const block = listing.slice(listing.indexOf(`WHAT'S NEW IN ${version}`)).split("\n").slice(1);
    const bullets = block.slice(0, block.findIndex((l) => !l.startsWith("• "))).map((l) => l.slice(2));
    expect(bullets).toEqual(WHATS_NEW[version].map((l) => l.replace(/\.$/, "")));
  });

  it("the privacy policy covers the side panel, transfers to the chosen service, and links to other tools", async () => {
    const p = await read("privacy.html");
    expect(p).toMatch(/or, if you keep Needle open in the side panel and allow access to websites, each tab you switch to and each page you open in it/);
    expect(p).toMatch(/It passes data on only to the service you start a check with/);
    expect(p).not.toMatch(/does not sell or transfer data/);
    expect(p).toMatch(/with the page address in the link, only when you click them/);
  });

  it("public files say 'built to' WCAG 2.2 AA, never a bare claim", async () => {
    for (const f of ["README.md", "CONTRIBUTING.md", "PRODUCT.md", "store/LISTING.md", "privacy.html"]) {
      const text = await read(f);
      for (const m of text.matchAll(/WCAG 2\.2 AA/g)) {
        const before = text.slice(Math.max(0, m.index - 12), m.index).toLowerCase();
        expect(before, `${f}: "…${text.slice(Math.max(0, m.index - 30), m.index + 12)}"`).toMatch(/built to $/);
      }
    }
  });
});

describe("full check of 1.0.2 (Ponytail): a host that doesn't answer", () => {
  it("is asked once, not again for each of its links", async () => {
    const { checkLinks } = await import("../lib/link-checker.js");
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      calls.push(url);
      if (url.startsWith("https://dead.example/")) throw new DOMException("Timed out", "TimeoutError");
      return { status: 200, url, redirected: false, type: "basic" };
    }));
    const urls = [1, 2, 3, 4, 5, 6].map((n) => `https://dead.example/${n}`).concat("https://ok.example/");
    const res = await checkLinks(urls);
    vi.unstubAllGlobals();
    const dead = res.filter((r) => r.url.startsWith("https://dead.example/"));
    expect(dead.every((r) => r.kind === "timeout")).toBe(true);
    expect(dead.filter((r) => r.hostTimedOut).length).toBeGreaterThan(0);
    // 3 links run at once on a host (PER_HOST), each tried twice; the rest are not requested.
    expect(calls.filter((u) => u.startsWith("https://dead.example/")).length).toBeLessThanOrEqual(6);
    expect(res.find((r) => r.url === "https://ok.example/").kind).toBe("ok");
  });
});

describe("full check of 1.0.2 (Ponytail): one rule for short and long", () => {
  const page = { url: "https://site.example/", title: "", description: "d".repeat(100), canonical: "https://site.example/", headings: [{ level: 1, text: "Hi" }], images: [], links: { details: [] }, og: {}, schema: [] };
  const tech = { status: 200, headers: {}, robotsTxt: { ok: true, pathAllowed: { allowed: true } } };

  it("the card, Fix this first and the score agree once the width is measured", async () => {
    const { collectFindings } = await import("../lib/findings.js");
    const { computeHealthScore } = await import("../lib/popup-compute.js");
    const { snippetWidthVerdict, SNIPPET } = await import("../lib/popup-helpers.js");
    const run = (title, titlePx) => ({
      card: snippetWidthVerdict(titlePx, SNIPPET.titleIdealPx, SNIPPET.titleMaxPx).kind,
      finding: collectFindings({ onpage: { ...page, title }, tech, titlePx }).find((f) => f.id.startsWith("title-"))?.id || null,
      score: computeHealthScore({ ...page, title }, tech, { titlePx }).checks.find((c) => c.label === "Title length").score
    });
    expect(run("t".repeat(25), 300)).toEqual({ card: "good", finding: null, score: 1 });
    expect(run("t".repeat(36), 280)).toEqual({ card: "warn", finding: "title-short", score: 0.5 });
    expect(run("t".repeat(50), 640)).toEqual({ card: "warn", finding: "title-long", score: 0.5 });
  });
});

describe("full check of 1.0.2 (Ponytail): smaller logic gaps", () => {
  it("dates of an Article inside a WebPage count, dates of mentioned things don't", async () => {
    const { analyzeEEAT } = await import("../lib/geo.js");
    const s = analyzeEEAT({ schema: [{ raw: { "@type": "WebPage", mainEntity: { "@type": "Article", datePublished: "2026-11-01T12:00:00+01:00" }, about: { "@type": "Event", dateModified: "2020-01-01" } } }] });
    expect(s.find((x) => x.label === "Published date").value).toBe("2026-11-01");
    expect(s.find((x) => x.label === "Modified date").ok).toBe(false);
  });

  it("one 'same site' rule: two-part suffixes and shared hosts", async () => {
    const { siteOf } = await import("../lib/urls.js");
    const { isSubdomain } = await import("../lib/variants.js");
    expect(siteOf("shop.example.co.uk")).toBe("example.co.uk");
    expect(siteOf("a.example.ne.jp")).toBe("example.ne.jp");
    expect(siteOf("alice.github.io")).toBe("alice.github.io");
    expect([isSubdomain("example.co.uk"), isSubdomain("shop.example.com"), isSubdomain("example.com")]).toEqual([false, true, false]);
  });

  it("language redirects: es-419 counts; an index page only when the path stays", async () => {
    const { isLanguageRedirect } = await import("../lib/link-checker.js");
    expect(isLanguageRedirect("https://site.example/page", "https://site.example/es-419/page")).toBe(true);
    expect(isLanguageRedirect("https://site.example/2019/campaign/index.html", "https://site.example/en/index.html")).toBe(false);
    expect(isLanguageRedirect("https://site.example/shop/index.html", "https://site.example/en/shop/index.html")).toBe(true);
    // A section added after the language is another page, also when both end in index.html.
    expect(isLanguageRedirect("https://site.example/index.html", "https://site.example/en/promo/index.html")).toBe(false);
    expect(isLanguageRedirect("https://site.example/shop/default.aspx", "https://site.example/fr/archive/shop/default.aspx")).toBe(false);
  });

  it("the sitemap check compares URLs with the shared key", async () => {
    const { findInSitemaps } = await import("../lib/sitemap-check.js");
    const xml = `<urlset><url><loc>https://Site.example/fr</loc></url></urlset>`;
    const fetcher = async (reqs) => reqs.map(() => ({ ok: true, status: 200, headers: { "content-type": "application/xml" }, text: xml }));
    expect((await findInSitemaps("https://site.example/fr/#top", ["https://site.example/sitemap.xml"], fetcher)).found).toBe(true);
  });
});

describe("full check of 1.0.2 (Break UI, read from the code)", () => {
  it("dates: an ISO date as written, anything else as written too, never guessed", async () => {
    const { dateAsWritten } = await import("../lib/geo.js");
    expect(dateAsWritten("2026-11-21Z")).toBe("2026-11-21");
    expect(dateAsWritten("05/11/2026")).toBe("05/11/2026");
    expect(dateAsWritten("2026-11")).toBe("2026-11");
    expect(dateAsWritten("Winter 2026")).toBe("Winter 2026");
    expect(dateAsWritten({ "@value": "2026-11-21", "@type": "Date" })).toBe("2026-11-21");
  });

  it("Needle's own dates are the user's day, not UTC", async () => {
    const { localDate } = await import("../lib/popup-helpers.js");
    const lateEvening = new Date(2026, 10, 21, 23, 30);
    expect(localDate(lateEvening)).toBe("2026-11-21");
    const { readFileSync } = await import("node:fs");
    for (const f of ["popup.js", "options.js", "lib/export.js", "lib/handoff.js", "lib/ai-prompt.js", "lib/compare-export.js"]) {
      expect(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), f).not.toMatch(/toISOString\(\)\.slice\(0, 10\)/);
    }
  });

  it("a size rule needs both numbers", async () => {
    const { normaliseImageRules } = await import("../lib/image-rules.js");
    expect(normaliseImageRules({ imgWidth: "1200", imgHeight: "0" })).toMatchObject({ width: 0, height: 0 });
    expect(normaliseImageRules({ imgWidth: "1200", imgHeight: "630", imgMaxKB: "0" })).toMatchObject({ width: 1200, height: 630, maxKB: 100 });
  });

  it("'Measure them' reports what happened, also past the 300-file limit", async () => {
    const { measureNote } = await import("../lib/image-rules.js");
    expect(measureNote({ got: 2, asked: 2, missing: 2, known: 1 })).toBe("Measured 2 images. The other image's size was already known.");
    expect(measureNote({ got: 300, asked: 300, missing: 320, known: 0 })).toBe("Measured 300 images (the first 300 of 320 images; measure again for the rest).");
    expect(measureNote({ got: 10, asked: 20, missing: 20, known: 0 })).toBe("Measured 10 of 20 images; the servers gave no size for the rest.");
    expect(measureNote({ got: 0, asked: 5, missing: 5, known: 0 })).toBe("The image servers gave no file sizes.");
  });
});
