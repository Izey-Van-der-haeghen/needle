import { describe, it, expect, vi, afterEach } from "vitest";
import { buildHtmlReport } from "../lib/export.js";
import { countPhrase } from "../lib/terms.js";
import { analyzeEEAT } from "../lib/geo.js";

describe("pixel widths", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
  it("are measured with the canvas the first time they are asked for", async () => {
    vi.resetModules();
    const ctx = { font: "", measureText: (t) => ({ width: t.length * 9.5 }) };
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => ctx }) });
    const { pixelWidth } = await import("../lib/popup-helpers.js");
    expect(pixelWidth("Bike repair in Ghent", "20px Arial")).toBe(190);
    expect(ctx.font).toBe("20px Arial");
    expect(pixelWidth("", "20px Arial")).toBe(0);
  });
});

describe("the downloaded report", () => {
  const onpage = { url: "https://e.com/", title: "T", description: "", headings: [], links: { details: [] }, schema: [], hreflang: [], og: {}, twitter: {}, images: [] };
  const verdict = { level: "good", verdict: "Indexable", issues: [{ msg: "All checks passed" }] };
  it("starts with Fix this first, the same list the popup shows", () => {
    const findings = [{ id: "title-long", severity: "medium", area: "Content", title: "Title is 83 characters", why: "Google cuts it.", fix: "Shorten it.", examples: [] }];
    const html = buildHtmlReport({ url: onpage.url, onpage, technical: null, offpage: null, geo: null, health: null, verdict, theme: "light", findings });
    expect(html).toContain('<section id="fix-first">');
    expect(html).toContain("Title is 83 characters");
    expect(html.indexOf('id="fix-first"')).toBeLessThan(html.indexOf('id="verdict"'));
    expect(html).not.toContain("All checks passed");
    expect(html).toContain("No indexing problems found.");
  });
  it("says so when there is nothing to fix", () => {
    const html = buildHtmlReport({ url: onpage.url, onpage, technical: null, offpage: null, geo: null, health: null, verdict: null, theme: "light", findings: [] });
    expect(html).toContain("found nothing to fix");
  });
});

describe("keyword check", () => {
  it("counts plural forms in English, Dutch and French", () => {
    expect(countPhrase("Bike Repairs in Ghent", "bike repair")).toBe(1);
    expect(countPhrase("Fast bikes", "bike")).toBe(1);
    expect(countPhrase("Wij herstellen fietsen", "fiets")).toBe(1);
    expect(countPhrase("Réparation de vélos", "vélo")).toBe(1);
    expect(countPhrase("Bike rental", "bike repair")).toBe(0);
  });
});

describe("author in structured data", () => {
  it("is found when it sits deeper, as Google reads it", () => {
    const d = { schema: [{ raw: { "@graph": [{ "@type": "WebPage", mainEntity: { "@type": "Article", author: { "@type": "Person", name: "An Peeters" } } }] } }], links: { details: [] }, headings: [] };
    expect(analyzeEEAT(d).find((s) => s.label === "Author byline")).toMatchObject({ ok: true, value: "An Peeters" });
  });
});
