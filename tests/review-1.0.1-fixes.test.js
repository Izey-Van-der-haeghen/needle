// Fixes from the code review of 1.0.1 (Ponytail method, 21 November 2026).
import { describe, it, expect } from "vitest";
import { analyzeEEAT } from "../lib/geo.js";
import { validateSchema } from "../lib/schema-validator.js";
import { collectFindings } from "../lib/findings.js";
import { computeHealthScore } from "../lib/popup-compute.js";
import { matchesExpectedSize } from "../lib/image-rules.js";
import { charTag } from "../lib/popup-helpers.js";
import { alternatesOf } from "../lib/hreflang-cluster.js";
import { loadContentScript } from "./helpers/content-harness.js";

const ctx = "https://schema.org";
const page = { url: "https://person.example/en/", title: "A personal site title", description: "x".repeat(100), canonical: "https://person.example/en/", headings: [{ level: 1, text: "Hi" }], images: [], schema: [], links: { details: [] }, og: {} };
const tech = { status: 200, headers: {}, robotsTxt: { ok: true, pathAllowed: { allowed: true } } };
const errors = (raw) => validateSchema([{ raw: { "@context": ctx, ...raw } }])[0].issues.filter((i) => i.level === "error").map((i) => i.msg);

describe("nested items get the rules that fit them", () => {
  it("a Q&A question with suggested answers only is fine", () => {
    expect(errors({ "@type": "QAPage", mainEntity: { "@type": "Question", name: "How?", answerCount: 2, suggestedAnswer: [{ "@type": "Answer", text: "Like this" }] } })).toEqual([]);
  });

  it("an FAQ question still needs an accepted answer", () => {
    expect(errors({ "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Why?", suggestedAnswer: { "@type": "Answer", text: "Maybe" } }] }))
      .toEqual(['mainEntity › Question: missing required "acceptedAnswer" (an FAQ answer)']);
  });

  it("an image named by contentUrl is fine", () => {
    expect(errors({ "@type": "ItemPage", mainEntity: { "@type": "ImageObject", contentUrl: "https://person.example/photo.jpg" } })).toEqual([]);
    expect(errors({ "@type": "ImageObject" })).toEqual(['ImageObject: missing required "contentUrl" or "url"']);
  });
});

describe("an 'Exact size' rule on a responsive image", () => {
  const rules = { width: 2400, height: 1024, mode: "exact" };
  it("compares the largest file the page offers, not the one this screen loaded", () => {
    expect(matchesExpectedSize({ naturalWidth: 760, naturalHeight: 324, largestWidth: 2400 }, rules)).toBe(true);
    expect(matchesExpectedSize({ naturalWidth: 760, naturalHeight: 324, largestWidth: 1520 }, rules)).toBe(false);
    expect(matchesExpectedSize({ naturalWidth: 2400, naturalHeight: 1024 }, rules)).toBe(true);
  });
});

describe("srcset without a space after the comma", () => {
  it("still gives every candidate", async () => {
    const html = `<!doctype html><html lang="en"><head><title>T</title></head><body><main>
      <img src="a-800.jpg" alt="A" width="400" height="300" srcset="a-800.jpg 800w,a-1600.jpg 1600w">
      <img src="c.jpg" alt="C" width="400" height="300" srcset="https://cdn.example/w_800,c_fill/c.jpg 800w, https://cdn.example/w_1200,c_fill/c.jpg 1200w">
      <img src="d.jpg" alt="D" width="400" height="300" srcset="d.jpg, d-2x.jpg 2x">
    </main></body></html>`;
    const tab = await loadContentScript(html, { url: "https://site.example/" });
    const d = await tab.send({ type: "ANALYZE_ONPAGE" });
    tab.window.close();
    expect(d.images.map((i) => i.largestWidth)).toEqual([1600, 1200, 400]);
  });
});

describe("the site's own entity in an @graph", () => {
  it("skips an employer that worksFor points to by @id", () => {
    const graph = [
      { "@type": "ProfilePage", mainEntity: { "@id": "#me" } },
      { "@type": "Person", "@id": "#me", name: "Someone", sameAs: ["https://github.com/someone"], worksFor: { "@id": "#employer" } },
      { "@type": "Organization", "@id": "#employer", name: "Employer" }
    ];
    const signals = analyzeEEAT({ schema: graph.map((raw) => ({ raw })) });
    expect(signals.find((s) => s.label === "Organization entity")).toBeUndefined();
    expect(signals.find((s) => s.label === "Person entity")).toMatchObject({ ok: true });
  });
});

describe("a language chooser", () => {
  const hreflang = [
    { lang: "nl", href: "https://person.example/nl/" },
    { lang: "fr", href: "https://person.example/fr/" },
    { lang: "x-default", href: "https://person.example/" }
  ];
  const chooser = { ...page, url: "https://person.example/?utm_source=news", canonical: "https://person.example/", hreflang, mainContentWordCount: 27 };

  it("is recognised by its canonical, also when opened with ?utm_source", () => {
    expect(collectFindings({ onpage: chooser, tech }).find((x) => x.id === "thin")).toBeUndefined();
  });

  it("gets full marks for content depth in the score", () => {
    const depth = (op) => computeHealthScore(op, tech).checks.find((c) => c.label === "Content depth").score;
    expect(depth(chooser)).toBe(1);
    expect(depth({ ...chooser, hreflang: [] })).toBe(0);
  });
});

describe("title and description length", () => {
  it("follow the pixel width when it is known", () => {
    const t = (titlePx) => collectFindings({ onpage: { ...page, title: "t".repeat(62) }, tech, titlePx }).find((x) => x.id === "title-long");
    expect(t(590)).toBeUndefined();
    expect(t(610)).toBeDefined();
    expect(t(0)).toBeDefined(); // width unknown: characters decide
    const desc = (descPx) => collectFindings({ onpage: { ...page, description: "d".repeat(165) }, tech, descPx }).find((x) => x.id === "desc-long");
    expect(desc(950)).toBeUndefined();
    expect(desc(1000)).toBeDefined();
  });

  it("show a long count neutrally when the width fits", () => {
    expect(charTag(62, 30, 60, 70, true)).toMatch(/class="tag neutral".*62 characters</);
    expect(charTag(62, 30, 60, 70)).toMatch(/class="tag warn".*62 characters, long/);
  });
});

describe("Check the alternates on a page with many", () => {
  it("counts each alternate once, without the page itself", () => {
    const list = [{ lang: "en", href: "https://site.example/" }, { lang: "fr", href: "https://site.example/fr/" }, { lang: "x-default", href: "https://site.example/fr/" }];
    expect(alternatesOf("https://site.example/", list)).toEqual([{ lang: "fr", href: "https://site.example/fr/", key: "https://site.example/fr" }]);
  });

  it("says in the finding when only the first ones were checked", () => {
    const rows = [{ lang: "fr", href: "https://site.example/fr", problems: ["no hreflang link back to this page"] }];
    const f = collectFindings({ onpage: page, tech, hreflangCluster: { rows, total: 30 } }).find((x) => x.id === "hreflang-alternates");
    expect(f.why).toMatch(/Only the first 1 of 30 alternates were checked/);
  });
});

describe("design review of 1.0.1 (Impeccable)", () => {
  it("the AI score sentence says data tables don't count", async () => {
    const { AI_SCORE_NOTE } = await import("../lib/geo.js");
    expect(AI_SCORE_NOTE).toMatch(/data tables don't count/);
  });

  it("the alternates check shows each URL as the page wrote it", async () => {
    const { checkHreflangCluster } = await import("../lib/hreflang-cluster.js");
    const { JSDOM } = await import("jsdom");
    const parse = (html) => new JSDOM(html).window.document;
    const load = async (url) => ({ status: 200, url, html: `<link rel="canonical" href="${url}"><link rel="alternate" hreflang="en" href="https://site.example/en/">` });
    const rows = await checkHreflangCluster("https://site.example/en/", [{ lang: "nl", href: "https://site.example/nl/herstellingen/" }], load, parse);
    expect(rows[0]).toMatchObject({ href: "https://site.example/nl/herstellingen/", problems: [] });
  });

  it("Refresh and 'Try again' move keyboard focus to their tab panel before it is redrawn", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../popup.js", import.meta.url), "utf8");
    const handler = src.slice(src.indexOf("closest('[data-refresh]')"), src.indexOf("loadOnpageAndTechnical(true)", src.indexOf("closest('[data-refresh]')")));
    expect(handler).toMatch(/closest\('\[role="tabpanel"\]'\)\?\.focus\(\)/);
  });
});
