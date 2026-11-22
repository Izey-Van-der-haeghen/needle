// Fixes from the review round of 1.0.2 (22 November 2026).
import { describe, it, expect, vi, afterEach } from "vitest";
import { readablePageError, safeSendTabMessage } from "../lib/popup-messaging.js";

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

  it("Settings tests have a deadline, so a hanging request can't keep the button busy", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../options.js", import.meta.url), "utf8");
    expect(src).toMatch(/fetchWithTimeout\("https:\/\/api\.dataforseo\.com[\s\S]*?\}, 30000\)/);
    expect(src).toMatch(/fetchWithTimeout\(`https:\/\/www\.googleapis\.com\/pagespeedonline[^`]*`, \{\}, 60000\)/);
    expect(src).not.toMatch(/await fetch\(/);
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
    expect(pixelTag(764, 580, 600)).toMatch(/class="tag bad".*764 px, cut off/);
    const t = collectFindings({ onpage: { ...page, robots: "", title: "t".repeat(83) }, tech, titlePx: 764 }).find((x) => x.id === "title-long");
    expect(t.title).toBe("Title is cut off in Google results (764 px)");
  });

  it("only a leading language segment makes a language redirect; common words don't", async () => {
    const { isLanguageRedirect } = await import("../lib/link-checker.js");
    expect(isLanguageRedirect("https://site.example/account", "https://site.example/my/account")).toBe(false);
    expect(isLanguageRedirect("https://site.example/page", "https://site.example/shop/en/page")).toBe(false);
    expect(isLanguageRedirect("https://privacy.microsoft.com/privacystatement", "https://www.microsoft.com/fr-fr/privacy/privacystatement")).toBe(true);
    expect(isLanguageRedirect("https://site.example/", "https://site.example/nl/")).toBe(true);
  });

  it("plain facts use the outlined information label", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
    for (const s of ["tag('external', 'info')", "tag('nofollow', 'info')", "tag('not found', 'info')", "tag('featured snippet', 'info')", "['partly built by JavaScript', 'info']"]) expect(src).toContain(s);
  });
});

describe("polish review of 1.0.2 (Make interfaces feel better)", () => {
  const read = async (f) => (await import("node:fs")).readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

  it("Got it puts focus on the active tab without scrolling", async () => {
    expect(await read("popup.js")).toContain(`document.querySelector('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });`);
  });

  it("link hints put the URL on its own line in the code font", async () => {
    const src = await read("popup.js");
    expect(src).toMatch(/Redirects\. Link straight to the final URL:<div class="item-url">/);
    expect(src).toMatch(/Keep this link: it works for every language\.<div class="item-url">/);
  });

  it("the popup has no static loading line for a note to push down, and Check again keeps its width", async () => {
    expect(await read("popup.html")).not.toMatch(/Reading the page…/);
    expect(await read("popup.css")).toMatch(/#check-broken \{ min-width: 11em; \}/);
  });
});

describe("stress test of 1.0.2 (Break UI)", () => {
  it("max-snippet:-1 (no limit) is not amber; a real limit is", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
    expect(src).toContain("tag(x, x === 'nosnippet' || /^max-snippet:(0|[1-9]\\d?)$/.test(x) ? 'warn' : 'info')");
    const limited = (x) => x === "nosnippet" || /^max-snippet:(0|[1-9]\d?)$/.test(x);
    expect([limited("max-snippet:-1"), limited("max-snippet:50"), limited("nosnippet"), limited("max-image-preview:large")]).toEqual([false, true, true, false]);
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

  it("says when a lazy image hasn't loaded yet", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(new URL("../popup.js", import.meta.url), "utf8")).toMatch(/loaded yet \(lazy loading\), so how large/);
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
