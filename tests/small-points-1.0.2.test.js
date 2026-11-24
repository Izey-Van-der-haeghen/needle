// The five small points left open after the 1.0.1 review, done for 1.0.2.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { buildHtmlReport } from "../lib/export.js";
import { urlKey } from "../lib/urls.js";
import { validateHreflang, isLanguageChooser } from "../lib/hreflang.js";

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

describe("information-only labels look different from a 'Low' finding", () => {
  it("have their own outlined style in the popup and the report", () => {
    expect(read("base.css")).toMatch(/\.tag\.info \{[^}]*background: transparent;[^}]*box-shadow: inset 0 0 0 1px var\(--rule\)/);
    const html = buildHtmlReport({ url: "https://site.example/", onpage: { url: "https://site.example/", title: "T", description: "", headings: [], links: { details: [] }, schema: [], hreflang: [], og: {}, twitter: {}, images: [] }, technical: null, offpage: null, geo: null, health: null, verdict: null, theme: "light" });
    expect(html).toMatch(/\.tag\.info \{[^}]*background: transparent/);
  });

});

describe("the report's colours", () => {
  // name → value for each `--name: value;` in a CSS block
  const tokens = (block) => Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]));
  const base = read("base.css");
  const report = buildHtmlReport({ url: "https://site.example/", onpage: { url: "https://site.example/", title: "T", description: "", headings: [], links: { details: [] }, schema: [], hreflang: [], og: {}, twitter: {}, images: [] }, technical: null, offpage: null, geo: null, health: null, verdict: null, theme: "light" });
  const block = (css, start) => css.slice(css.indexOf(start), css.indexOf("}", css.indexOf(start)));
  const colours = ["paper", "surface", "ink", "ink-2", "line", "rule", "accent", "on-accent", "good", "good-bg", "warn", "warn-bg", "bad", "bad-bg"];

  it("use the same names and values as Needle itself, in light and dark", () => {
    const pick = (t) => Object.fromEntries(colours.map((c) => [c, t[c]]));
    expect(pick(tokens(block(report, ":root {")))).toEqual(pick(tokens(block(base, ":root {"))));
    expect(pick(tokens(block(report, ':root[data-theme="dark"] {')))).toEqual(pick(tokens(block(base, ':root[data-theme="dark"] {'))));
  });

  it("no longer use the old names", () => {
    expect(report).not.toMatch(/--shade/);
  });
});

describe("the side panel is marked before the first paint", () => {
  const boot = read("theme-boot.js");
  const run = (path, views) => {
    const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: `chrome-extension://abc${path}`, runScripts: "outside-only" });
    dom.window.matchMedia = () => ({ matches: false });
    dom.window.chrome = { extension: { getViews: () => views(dom.window) } };
    dom.window.eval(boot);
    return dom.window.document.documentElement.classList.contains("side-panel");
  };

  it("in the side panel, not in the popup", () => {
    expect(run("/popup.html", () => [])).toBe(true);
    expect(run("/popup.html", (w) => [w])).toBe(false);
  });

  it("only on popup.html (Settings and privacy use the same script)", () => {
    expect(run("/options.html", () => [])).toBe(false);
    expect(run("/privacy.html", () => [])).toBe(false);
  });
});

// "Settings tests run once at a time": tests/busy.test.js and tests/options-page.test.js.

describe("one way to compare URLs", () => {
  it("ignores the #fragment and a trailing slash, and resolves relative URLs", () => {
    expect(urlKey("https://site.example/fr/#top")).toBe("https://site.example/fr");
    expect(urlKey("/fr/", "https://site.example/en/")).toBe("https://site.example/fr");
    expect(urlKey("not a url")).toBe("");
  });

  it("is what the hreflang checks use", () => {
    expect(validateHreflang([{ lang: "en", href: "https://site.example/en/#x" }, { lang: "x-default", href: "https://site.example/en" }], "https://site.example/en/").find((i) => /self/i.test(i.msg))).toBeUndefined();
    expect(isLanguageChooser([{ lang: "nl", href: "/nl/" }, { lang: "fr", href: "/fr/" }, { lang: "x-default", href: "/#" }], "https://site.example/")).toBe(true);
    for (const f of ["lib/hreflang.js", "lib/hreflang-cluster.js", "popup.js"]) expect(read(f)).not.toMatch(/x\.href\.replace\(\/\\\/\$\//);
  });
});

describe("izey.dev round of 22 November (link check)", () => {
  it("knows a redirect to a language version of the same page", async () => {
    const { isLanguageRedirect } = await import("../lib/link-checker.js");
    expect(isLanguageRedirect("https://privacy.microsoft.com/privacystatement", "https://www.microsoft.com/fr-fr/privacy/privacystatement")).toBe(true);
    expect(isLanguageRedirect("https://site.example/", "https://site.example/en/")).toBe(true);
    expect(isLanguageRedirect("https://site.example/old-page", "https://site.example/en/new-page")).toBe(false);
    expect(isLanguageRedirect("https://short.example/abc", "https://other.example/en/abc")).toBe(false);
    expect(isLanguageRedirect("https://site.example/en/page", "https://site.example/fr/page")).toBe(false);
  });

  it("counts a language redirect as working, not as a redirect to fix", async () => {
    const { checkLinks } = await import("../lib/link-checker.js");
    const { vi } = await import("vitest");
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200, url: "https://www.microsoft.com/fr-fr/privacy/privacystatement", redirected: true, type: "basic" })));
    const [r] = await checkLinks(["https://privacy.microsoft.com/privacystatement"]);
    vi.unstubAllGlobals();
    expect(r).toMatchObject({ kind: "ok", language: true });
  });

  it("tries once more after its own deadline", async () => {
    const { checkLinks } = await import("../lib/link-checker.js");
    const { vi } = await import("vitest");
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      calls++;
      if (calls === 1) throw new DOMException("Timed out", "TimeoutError");
      return { status: 200, url, redirected: false, type: "basic" };
    }));
    const [r] = await checkLinks(["https://slow.example/"]);
    expect(r.kind).toBe("ok");
    expect(calls).toBe(2);
    calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { calls++; throw new DOMException("Timed out", "TimeoutError"); }));
    const [t] = await checkLinks(["https://dead.example/"]);
    expect(t.kind).toBe("timeout");
    expect(calls).toBe(2);
    vi.unstubAllGlobals();
  });
});

describe("labels shared by the popup and the report (full check of 1.0.2)", () => {
  it("give plain facts the information label, problems their colour", async () => {
    const { botStatus, signalStatus, llmsStatus, cwvStatus, SCHEMA_LEVEL, SEV_KIND, leftOutNote } = await import("../lib/labels.js");
    expect(botStatus({ allowed: false, kind: "training" }, true)).toEqual(["blocked", "info"]);
    expect(botStatus({ allowed: false, kind: "search" }, true)).toEqual(["blocked", "bad"]);
    expect(botStatus({ allowed: true }, false)).toEqual(["unknown", "neutral"]);
    expect(signalStatus({ ok: false, info: true }, "low")).toEqual(["not scored", "info"]);
    expect(signalStatus({ ok: false }, "missing")).toEqual(["missing", "warn"]);
    expect(llmsStatus({ ok: false })).toEqual(["not found", "info"]);
    expect(cwvStatus("AVERAGE")).toEqual(["needs work", "warn"]);
    expect([SCHEMA_LEVEL.note[1], SEV_KIND.low]).toEqual(["info", "neutral"]);
    expect(leftOutNote(1)).toBe("1 finding that only matters in search results is left out while the page is noindex.");
  });

  it("the report shows a blocked training bot and a missing llms.txt like the popup does", async () => {
    const { buildHtmlReport } = await import("../lib/export.js");
    const geo = { aiAccess: { bots: [{ ua: "GPTBot", vendor: "OpenAI", kind: "training", allowed: false, purpose: "" }] }, robotsKnown: true, llmsTxt: { summary: { ok: false }, full: { ok: false } }, eeat: [], citability: [], score: { score: 90, level: "good" } };
    const html = buildHtmlReport({ url: "https://site.example/", onpage: { url: "https://site.example/", title: "T", description: "", headings: [], links: { details: [] }, schema: [], hreflang: [], og: {}, twitter: {}, images: [] }, technical: null, offpage: null, geo, health: null, verdict: null, theme: "light" });
    expect(html).toMatch(/<span class="tag info">blocked<\/span> <strong>GPTBot<\/strong>/);
    expect(html).toMatch(/<span class="tag info">not found<\/span> \/llms\.txt/);
  });
});
