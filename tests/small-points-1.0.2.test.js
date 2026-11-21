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

  it("are used for notes, 'not scored' and widths that still fit", () => {
    const popup = read("popup.js");
    expect(popup).toContain("s.info ? tag('not scored', 'info')");
    expect(popup).toContain("iss.level === 'note' ? 'info' : 'neutral'");
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
    return dom.window.document.documentElement.classList.contains("panel");
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

describe("Settings tests run once at a time", () => {
  it("wrap both test buttons in the busy guard", () => {
    const src = read("options.js");
    expect(src).toMatch(/function whileBusy\(btn, run\)[\s\S]*aria-disabled[\s\S]*finally \{ btn\.removeAttribute\("aria-disabled"\)/);
    expect(src).toContain('$("test-dfs").addEventListener("click", whileBusy($("test-dfs"),');
    expect(src).toContain('$("test-psi").addEventListener("click", whileBusy($("test-psi"),');
  });
});

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
