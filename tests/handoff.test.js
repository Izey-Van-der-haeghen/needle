import { describe, it, expect } from "vitest";
import { buildIssuesMarkdown } from "../lib/handoff.js";
import { snippetDirectives } from "../lib/popup-compute.js";

describe("snippetDirectives", () => {
  it("collects snippet and AI-use directives from meta robots and X-Robots-Tag", () => {
    expect(snippetDirectives("index, follow, max-snippet: 50", "googlebot: nosnippet, noarchive")).toEqual(["max-snippet:50", "nosnippet", "noarchive"]);
    expect(snippetDirectives("index, follow", "")).toEqual([]);
  });
});

describe("buildIssuesMarkdown", () => {
  const onpage = {
    url: "https://e.com/page", title: "", description: "x".repeat(200), canonical: "", robots: "noindex", lang: "", viewport: "",
    headings: [{ level: 2, text: "Sub" }],
    links: { broken: 1, details: [{ href: "https://e.com/gone", checkedStatus: { kind: "broken", status: 404 } }] },
    images: [{ src: "https://e.com/a.jpg", altMissing: true, bytes: 300000, oversized: true, upscaled: true, displayedWidth: 400, displayedHeight: 300, missingDims: true }],
    schema: [{ type: "Product", raw: { "@context": "https://schema.org", "@type": "Product" } }],
    hreflang: [{ lang: "en-UK", href: "/en" }],
    mixedContent: [{ tag: "img", url: "http://e.com/x.png" }]
  };
  const md = buildIssuesMarkdown(onpage, { status: 200, headers: {}, robotsTxt: { ok: true, pathAllowed: { allowed: true, rule: null } } }, { now: new Date("2026-11-20T10:00:00Z") });

  it("lists every kind of problem with a fix, grouped by priority, as Markdown", () => {
    expect(md).toMatch(/^# SEO issues: https:\/\/e\.com\/page/);
    expect(md).toContain("Checked: 2026-11-20 with Needle");
    expect(md).toContain("Indexability: Not indexable");
    expect(md.indexOf("## Critical")).toBeLessThan(md.indexOf("## High"));
    expect(md).toContain("No `<title>`");
    expect(md).toContain("No H1 heading");
    expect(md).toContain("without an alt attribute");
    expect(md).toContain("https://e.com/a.jpg");
    expect(md).toContain("shown larger than the file");
    expect(md).toContain("https://e.com/gone (404)");
    expect(md).toContain("http://e.com/x.png");
  });

  it("lists structured data and hreflang once the page may be indexed (left out while it is noindex)", () => {
    expect(md).not.toContain('Product: missing required "name"');
    const indexable = buildIssuesMarkdown({ ...onpage, robots: "" }, { status: 200, headers: {}, robotsTxt: { ok: true, pathAllowed: { allowed: true, rule: null } } }, { now: new Date("2026-11-20T10:00:00Z") });
    expect(indexable).toContain('Product: missing required "name"');
    expect(indexable).toContain("Invalid hreflang region");
  });
});

describe("buildIssuesMarkdown on GitHub and GitLab", () => {
  it("shows tags as code and keeps page text from adding links or tags", async () => {
    const { buildIssuesMarkdown } = await import("../lib/handoff.js");
    const onpage = { url: "https://e.com/page", title: "[click](https://evil.example) *Sale*", description: "", robots: "", headings: [{ level: 1, text: "<details>Open" }, { level: 1, text: "B" }], images: [], schema: [], hreflang: [], links: { details: [] }, og: {} };
    const md = buildIssuesMarkdown(onpage, null, { now: new Date(2026, 10, 22) });
    expect(md).toContain("# SEO issues: \\[click\\](https://evil.example) \\*Sale\\*");
    expect(md).toContain("`<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">`");
    expect(md).toContain("  - \\<details\\>Open");
    expect(md).not.toMatch(/(^|[^`\\])<details>/);
  });
});
