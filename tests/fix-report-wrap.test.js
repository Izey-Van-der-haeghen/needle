// The downloaded report at 375 px: one long word or address from the page must wrap,
// not widen the page (full check of 25 November 2026, P2-1). Page text shows in many places:
// social cards, headings, the why line under Fix this first, Indexability and hreflang issues,
// structured-data headings. So the report wraps everything in main, and this test looks everywhere.
// jsdom has no layout, so this reads the report's own stylesheet: the nearest rule that sets
// overflow-wrap for an element or its ancestors must say anywhere, and white-space must allow wrapping.
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { buildHtmlReport } from "../lib/export.js";
import { collectFindings } from "../lib/findings.js";
import { computeIndexability } from "../lib/popup-compute.js";

const longWord = "Fietsenmakerij".repeat(16);
const slug = "FietsherstellingenEnOnderhoudVoorParticulierenEnBedrijven";
const pageUrl = `https://e.be/fietsen/${slug}`;
// A redirect that keeps a long click id.
const finalUrl = `https://e.be/nl/fietsen/${slug}?fbclid=${"IwAR0aBcDeFgHiJkLmNoPqRsTuVwXyZ".repeat(2)}`;
const onpage = {
  url: pageUrl, title: longWord, description: "D", canonical: `https://e.be/nl/${slug}`, robots: "", lang: "nl", viewport: "width=device-width",
  og: { title: longWord }, twitter: { title: longWord },
  headings: [{ level: 1, text: "H" }, { level: 2, text: longWord }],
  links: { total: 0, internal: 0, external: 0, nofollow: 0, broken: 0, details: [] },
  images: [], schema: [{ type: longWord, raw: { "@type": longWord } }],
  hreflang: [{ lang: "nl-BE", href: pageUrl }, { lang: "nl-be", href: finalUrl }],
  wordCount: 10, mainContentWordCount: 8, textRatio: 20
};
const technical = {
  status: 200, redirected: true, finalUrl, headers: {},
  robotsTxt: { ok: true, status: 200, pathAllowed: { allowed: false, rule: `Disallow: /fietsen/${slug}` }, sitemaps: [] }
};
const findings = collectFindings({ onpage, tech: technical, imageRules: null });
const verdict = computeIndexability(onpage, technical);
const html = buildHtmlReport({ url: pageUrl, onpage, technical, offpage: null, geo: null, health: null, verdict, theme: "light", findings });
const doc = new JSDOM(html).window.document;

const css = doc.querySelector("style").textContent.replace(/\/\*[\s\S]*?\*\//g, "");
/** Every rule in the stylesheet, in source order. */
const RULES = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selectors, body]) => ({ selectors: selectors.split(",").map((s) => s.trim()), body }));

/** The value of a property for an element: from its own rules, or else from the closest ancestor that sets it. */
function declared(el, prop) {
  const re = new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`);
  for (let node = el; node; node = node.parentElement) {
    const inline = (node.getAttribute("style") || "").match(re);
    if (inline) return inline[1].trim();
    // Source order stands in for specificity: in the report the later rule is also the more specific one.
    const hit = RULES.filter((r) => re.test(r.body) && r.selectors.some((s) => {
      try { return node.matches(s); } catch { return false; }
    })).pop();
    if (hit) return hit.body.match(re)[1].trim();
  }
  return null;
}
const wraps = (el) => declared(el, "overflow-wrap") === "anywhere" && !/^(nowrap|pre)$/.test(declared(el, "white-space") || "");

/** A short name for an element in a failure message. */
const describeEl = (el) => `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(" ").join(".")}` : ""} "${el.textContent.trim().slice(0, 50)}"`;

describe("the report wraps one long word or address", () => {
  it("in the titles of the social cards", () => {
    const titles = [...doc.querySelectorAll("#social .card strong")];
    expect(titles).toHaveLength(2);
    for (const t of titles) {
      expect(t.textContent).toBe(longWord);
      expect(wraps(t)).toBe(true);
    }
  });

  it("in a heading row", () => {
    const row = [...doc.querySelectorAll("#headings .h-row")].find((r) => r.textContent.includes(longWord));
    expect(row).toBeTruthy();
    expect(wraps(row)).toBe(true);
  });

  it("in the why line under Fix this first", () => {
    const why = [...doc.querySelectorAll("#fix-first .findings p.muted")].filter((p) => p.textContent.includes(slug));
    // The redirect, the canonical and the robots.txt rule.
    expect(why.length).toBeGreaterThanOrEqual(3);
    for (const p of why) expect(wraps(p), describeEl(p)).toBe(true);
  });

  it("in an Indexability issue", () => {
    const issues = [...doc.querySelectorAll("#verdict .issue")].filter((d) => d.textContent.includes(slug));
    expect(issues.some((d) => d.textContent.startsWith("This URL redirects to"))).toBe(true);
    for (const d of issues) expect(wraps(d), describeEl(d)).toBe(true);
  });

  it("in a hreflang issue", () => {
    const issues = [...doc.querySelectorAll("#hreflang .issue")];
    expect(issues.length).toBeGreaterThan(0);
    for (const d of issues) expect(wraps(d), describeEl(d)).toBe(true);
  });

  it("in a structured-data heading", () => {
    const h3 = [...doc.querySelectorAll("#schema h3")].find((h) => h.textContent.includes(longWord));
    expect(h3).toBeTruthy();
    expect(wraps(h3)).toBe(true);
  });

  it("everywhere such a word shows", () => {
    // Every element whose own text holds a run of 40 or more characters without a space.
    const long = [...doc.querySelectorAll("main *")].filter((el) =>
      /\S{40,}/.test([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.data).join("")));
    expect(long.length).toBeGreaterThan(10);
    expect(long.filter((el) => !wraps(el)).map(describeEl)).toEqual([]);
  });

  it("from one rule on main", () => {
    expect(css).toMatch(/(?:^|\})\s*main\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });
});
