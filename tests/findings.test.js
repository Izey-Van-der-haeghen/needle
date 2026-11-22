import { describe, it, expect } from "vitest";
import { collectFindings } from "../lib/findings.js";
import { buildAiPrompt } from "../lib/ai-prompt.js";

const page = (over = {}) => ({
  url: "https://e.com/page", title: "A good title for this page, about forty chars", description: "A description long enough to pass the length check without any trouble at all here.",
  canonical: "https://e.com/page", robots: "", lang: "en", viewport: "width=device-width",
  headings: [{ level: 1, text: "Main" }, { level: 2, text: "Sub" }], images: [], schema: [], hreflang: [],
  links: { details: [] }, mainContentWordCount: 600, og: { image: "https://e.com/og.jpg" }, ...over
});
const tech = (over = {}) => ({ status: 200, finalUrl: "https://e.com/page", headers: {}, robotsTxt: { ok: true, pathAllowed: { allowed: true, rule: null } }, sitemap: { ok: true }, ...over });

describe("collectFindings", () => {
  it("finds nothing on a clean page", () => {
    expect(collectFindings({ onpage: page(), tech: tech() })).toEqual([]);
  });

  it("puts blocking problems first", () => {
    const f = collectFindings({ onpage: page({ robots: "noindex", title: "" }), tech: tech() });
    expect(f.map((x) => x.id)).toEqual(["noindex-meta", "title-missing"]);
    expect(f[0].severity).toBe("critical");
  });

  it("on a noindex page, leaves out what only matters in search results", () => {
    const f = collectFindings({ onpage: page({ robots: "noindex", description: "" }), tech: tech() });
    expect(f.map((x) => x.id)).toEqual(["noindex-meta"]);
    expect(f[0].why).toMatch(/leaves out what only matters in search results/);
    expect(collectFindings({ onpage: page({ description: "" }), tech: tech() }).map((x) => x.id)).toContain("desc-missing");
  });

  it("points to the elements on the page", () => {
    const f = collectFindings({
      onpage: page({
        headings: [{ level: 1, text: "A" }, { level: 1, text: "B" }, { level: 3, text: "C" }],
        images: [{ domIndex: 2, src: "https://e.com/a.jpg", alt: "", altMissing: true, context: "main", displayedWidth: 400, displayedHeight: 300 }]
      }),
      tech: tech()
    });
    const byId = Object.fromEntries(f.map((x) => [x.id, x]));
    expect(byId["h1-multiple"].targets).toEqual([{ kind: "heading", index: 0, level: 1, text: "A" }, { kind: "heading", index: 1, level: 1, text: "B" }]);
    expect(byId["heading-skips"].targets).toEqual([{ kind: "heading", index: 2, level: 3, text: "C" }]);
    expect(byId["img-alt"].targets).toEqual([{ kind: "image", index: 2, src: "https://e.com/a.jpg" }]);
  });

  it("ignores hidden headings for the H1 count but flags a hidden H1", () => {
    const f = collectFindings({ onpage: page({ headings: [{ level: 1, text: "Main" }, { level: 1, text: "SEO text", hidden: true }] }), tech: tech() });
    expect(f.map((x) => x.id)).toEqual(["h1-hidden"]);
  });

  it("reports blocked AI search bots, JavaScript-only text and limited snippets", () => {
    const f = collectFindings({
      onpage: page({ robots: "nosnippet" }),
      tech: tech({ raw: { wordCount: 50 } }),
      rendered: { wordCount: 600 },
      geo: { aiAccess: { bots: [{ ua: "OAI-SearchBot", kind: "search", allowed: false }, { ua: "GPTBot", kind: "training", allowed: false }] }, eeat: [] }
    });
    expect(f.map((x) => x.id).sort()).toEqual(["ai-blocked", "js-content", "nosnippet"]);
    expect(f.find((x) => x.id === "ai-blocked").why).toContain("OAI-SearchBot");
    expect(f.find((x) => x.id === "ai-blocked").why).not.toContain("GPTBot");
  });
});

describe("buildAiPrompt", () => {
  it("contains the page data, the outline and the findings, and asks for a plan in the page's language", () => {
    const onpage = page({ lang: "nl-BE", description: "" });
    const findings = collectFindings({ onpage, tech: tech() });
    const prompt = buildAiPrompt({ onpage, tech: tech(), findings, now: new Date("2026-11-20") });
    expect(prompt).toContain("prioritised action plan");
    expect(prompt).toContain("(nl-BE)");
    expect(prompt).toContain("H1 Main");
    expect(prompt).toContain("[High] No meta description");
    expect(prompt).toContain("Audit date: 2026-11-20");
  });
});
