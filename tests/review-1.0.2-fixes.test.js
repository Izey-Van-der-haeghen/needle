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
