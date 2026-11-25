// The last follow-ups of the Aikido round: what Needle says when robots.txt couldn't be checked in
// time, and a depth cap on flattening JSON-LD.
import { describe, it, expect, vi, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import { flattenJsonLd } from "../lib/schema-validator.js";
import { computeIndexability } from "../lib/popup-compute.js";
import { collectFindings } from "../lib/findings.js";
import { buildHtmlReport } from "../lib/export.js";

afterEach(() => vi.restoreAllMocks());

describe("flattenJsonLd", () => {
  it("stops past 64 levels of nesting instead of recursing without end", () => {
    const deep = JSON.parse("[".repeat(5000) + '{"@type":"Deep"}' + "]".repeat(5000));
    expect(() => flattenJsonLd(deep)).not.toThrow();
    expect(flattenJsonLd(deep)).toEqual([]);
    expect(flattenJsonLd(JSON.parse("[".repeat(10) + '{"@type":"Ok"}' + "]".repeat(10)))).toEqual([{ "@type": "Ok" }]);
  });
});

const page = { url: "https://e.com/a", title: "A good title for this page, about forty chars", description: "D", canonical: "https://e.com/a", robots: "", lang: "en", headings: [{ level: 1, text: "Main" }], images: [], schema: [], hreflang: [], links: { details: [] }, og: {}, twitter: {} };
const UNCHECKED = { allowed: null, rule: null, unchecked: true };
const tech = (pathAllowed) => ({ status: 200, finalUrl: page.url, headers: {}, robotsTxt: { ok: true, status: 200, pathAllowed }, sitemap: { ok: true } });

describe("when robots.txt couldn't be checked in time", () => {
  it("the indexing verdict says so for Googlebot, and doesn't call the page blocked", () => {
    const v = computeIndexability(page, tech(UNCHECKED));
    expect(v.issues.map((i) => i.msg)).toContain("robots.txt is too complex to check fully for Googlebot");
    expect(v.verdict).not.toMatch(/Blocked/);
  });
  it("the note's fix points to Search Console only when Googlebot is the one unchecked", () => {
    const geo = { aiAccess: { bots: [{ ua: "GPTBot", kind: "training", ...UNCHECKED }] } };
    const onlyAi = collectFindings({ onpage: page, tech: tech({ allowed: true, rule: null }), geo, imageRules: {} }).find((f) => f.id === "robots-too-complex");
    expect(onlyAi.fix).not.toMatch(/Search Console/);
    const google = collectFindings({ onpage: page, tech: tech(UNCHECKED), imageRules: {} }).find((f) => f.id === "robots-too-complex");
    expect(google.fix).toMatch(/URL Inspection in Google Search Console/);
  });
  it("the report's AI score says how many bots weren't checked", () => {
    const geo = { aiAccess: { bots: [{ ua: "GPTBot", ...UNCHECKED }, { ua: "ClaudeBot", ...UNCHECKED }, { ua: "OAI-SearchBot", allowed: true, rule: null }] }, eeat: [], citability: [], llmsTxt: { summary: { ok: false }, full: { ok: false } }, score: { score: 100, level: "good" }, robotsKnown: true };
    const text = new JSDOM(buildHtmlReport({ url: page.url, onpage: page, technical: null, geo, health: null, verdict: null, theme: "light", version: "0", offpage: null })).window.document.body.textContent;
    expect(text).toContain("(2 bots not checked)");
  });
});
