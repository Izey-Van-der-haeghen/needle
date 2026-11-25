// The downloaded report (full check of 25 November 2026):
// - P3-24: its contents and section headings use the popup's card and tab titles, and every
//   contents label equals the heading it leads to;
// - P3-11: counts in the singular for 1, and with thousands separators ("First 100 of 1,500 images");
// - P3-14: right-to-left page text after a label, in a social card or in a heading example sits in
//   <bdi>, so its punctuation stays on its own side.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { buildHtmlReport } from "../lib/export.js";
import { collectFindings } from "../lib/findings.js";
import { computeHealthScore, computeIndexability } from "../lib/popup-compute.js";
import { analyzeAIAccess, analyzeEEAT, analyzeCitability, aiReadinessScore } from "../lib/geo.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(path.join(ROOT, f), "utf8");

// Arabic page text that ends in punctuation: in a left-to-right line the "!" would land on the wrong side.
const AR_TITLE = "إصلاح الدراجات في غنت!";
const AR_DESC = "نصلح كل الدراجات، بسرعة.";
const AR_ALT = "دراجة حمراء!";
const AR_H3 = "ساعات العمل؟";

const image = (i, extra = {}) => ({ src: `https://e.be/img/${i}.jpg`, alt: "", altMissing: true, context: "main", displayedWidth: 800, displayedHeight: 400, ...extra });
const onpage = {
  url: "https://e.be/ar/", title: AR_TITLE, description: AR_DESC, canonical: "https://e.be/ar/", robots: "", lang: "ar", viewport: "width=device-width",
  og: { title: AR_TITLE, description: AR_DESC }, twitter: {},
  headings: [{ level: 1, text: "عنوان" }, { level: 1, text: "عنوان آخر" }, { level: 3, text: AR_H3 }],
  links: { total: 1234, internal: 1200, external: 34, nofollow: 0, broken: 0, byContext: { main: 1234 }, details: [] },
  images: [image(0, { alt: AR_ALT, altMissing: false })],
  schema: [{ type: "Organization", raw: { "@type": "Organization" } }],
  hreflang: [{ lang: "ar", href: "https://e.be/ar/" }, { lang: "nl", href: "https://e.be/nl/" }],
  wordCount: 10, mainContentWordCount: 8, mainContentSelector: "main", textRatio: 20
};
const technical = { status: 200, finalUrl: onpage.url, headers: {}, robotsTxt: { ok: true, status: 200, sitemaps: [] }, sitemap: { ok: true, url: "https://e.be/sitemap.xml", urlCount: 3 } };
const aiAccess = analyzeAIAccess({ text: "User-agent: *\nAllow: /\n" });
const eeat = analyzeEEAT(onpage);
const citability = analyzeCitability(onpage);
const geo = { aiAccess, eeat, citability, llmsTxt: { summary: { ok: false }, full: { ok: false } }, score: aiReadinessScore(aiAccess, eeat, citability) };
const report = (over = {}, extra = {}) => {
  const op = { ...onpage, ...over };
  return new JSDOM(buildHtmlReport({
    url: op.url, onpage: op, technical, geo, theme: "light",
    health: computeHealthScore(op, technical), verdict: computeIndexability(op, technical),
    offpage: null, findings: collectFindings({ onpage: op, tech: technical, imageRules: null }), ...extra
  })).window.document;
};
const doc = report();
const text = (el) => el.textContent.replace(/\s+/g, " ").trim();

describe("the report's contents and section headings", () => {
  const links = [...doc.querySelectorAll("nav.toc a")];

  it("list every section, in order", () => {
    expect(links.map((a) => a.getAttribute("href").slice(1))).toEqual([...doc.querySelectorAll("main > section")].map((s) => s.id));
    expect(links).toHaveLength(14);
  });

  it("every contents label equals its section's heading; a heading may add a count or a score", () => {
    for (const a of links) {
      const label = text(a);
      const h2 = text(doc.querySelector(`${a.getAttribute("href")} h2`));
      const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(h2, label).toMatch(new RegExp(`^${esc}(?: \\([\\d,]+(?: [a-z]+)?\\)|: (?:\\d+|—)/100)?$`));
    }
  });

  it("use the popup's card and tab titles", () => {
    const js = read("popup.js");
    const html = read("popup.html");
    const popupTitles = new Set([
      // Card titles, without the count or score after them: "Headings (${…})" is "Headings".
      ...[...js.matchAll(/<h2(?: class="card-title")?>([^<$]+?)\s*(?:\(\$\{|\$\{|<\/h2>)/g)].map((m) => m[1].trim()),
      ...[...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1].trim()),
      // Tabs: Technical, Speed & keywords.
      ...[...html.matchAll(/role="tab"[^>]*>([^<]+)<\/button>/g)].map((m) => m[1].replace(/&amp;/g, "&").trim())
    ]);
    // The popup shows the verdict and the score together in one block without a title: these two
    // are the report's own names for its halves.
    const reportOnly = ["Checklist score", "Indexability"];
    const labels = links.map(text).filter((l) => !reportOnly.includes(l));
    expect(labels.filter((l) => !popupTitles.has(l))).toEqual([]);
    expect(labels).toEqual(expect.arrayContaining(["Title and description", "Content and keywords", "Content images", "AI search readiness", "Speed & keywords"]));
  });

  it("the Links heading counts the links, as the popup's card does", () => {
    expect(text(doc.querySelector("#links h2"))).toBe("Links (1,234)");
  });
});

describe("the report's counts", () => {
  it("say 1 character, 1 image and 1 block in the singular", () => {
    const one = report({ title: "T", description: "D", og: {}, schema: [{ type: "Thing", raw: {} }] });
    const tags = [...one.querySelectorAll("#meta .tag")].map(text);
    expect(tags).toEqual(["! 1 character", "! 1 character"]);
    expect(text(one.querySelector("#images p"))).toMatch(/^1 image · /);
    expect(text(one.querySelector("#schema h2"))).toBe("Structured data (1 block)");
  });

  it("write 1,500 images with a thousands separator, in the count and under the list", () => {
    const many = report({ images: Array.from({ length: 1500 }, (_, i) => image(i)) });
    expect(text(many.querySelector("#images p"))).toMatch(/^1,500 images · ! 1,500 without alt ✓ 0 over the size limit /);
    expect(text(many.querySelector("#images p.muted:last-child"))).toBe("First 100 of 1,500 images.");
    expect(many.querySelectorAll("#images .img-row")).toHaveLength(100);
  });

  it("count headings per level with a thousands separator", () => {
    const many = report({ headings: [{ level: 1, text: "H" }, ...Array.from({ length: 1200 }, () => ({ level: 2, text: "Kop" }))] });
    expect(text(many.querySelector("#headings p.muted"))).toBe("H1: 1 · H2: 1,200 · H3: 0 · H4: 0 · H5: 0 · H6: 0");
    expect(text(many.querySelector("#headings h2"))).toBe("Headings (1,201)");
  });
});

describe("right-to-left page text in the report", () => {
  it("after alt: the alt text is isolated, the label is not", () => {
    const bdi = doc.querySelector("#images .img-row bdi");
    expect(bdi.textContent).toBe(AR_ALT);
    expect(bdi.previousSibling.textContent).toBe("alt: ");
  });

  it("in the social cards: title and description each isolated", () => {
    const cards = [...doc.querySelectorAll("#social .card")];
    expect(cards).toHaveLength(2);
    for (const c of cards) expect(c.querySelector("strong > bdi").textContent).toBe(AR_TITLE);
    expect([...cards[0].querySelectorAll("div > bdi")].map((b) => b.textContent)).toEqual([AR_DESC]);
  });

  it("a social card without a title still says so, outside any <bdi>", () => {
    const none = report({ title: "", og: {}, twitter: {} });
    const strongs = [...none.querySelectorAll("#social .card strong")];
    expect(strongs.map((s) => s.innerHTML)).toEqual(["<em>no title</em>", "<em>no title</em>"]);
  });

  it("in heading examples under Fix this first: the heading's text, not its level", () => {
    const items = [...doc.querySelectorAll("#fix-first ul.code li")];
    const skip = items.find((li) => li.textContent === `H3 ${AR_H3}`);
    expect(skip).toBeTruthy();
    expect(skip.querySelector("bdi").textContent).toBe(AR_H3);
    expect(skip.firstChild.textContent).toBe("H3 ");
    // Several H1s: each example is all page text.
    const h1s = items.filter((li) => /^عنوان/.test(li.textContent));
    expect(h1s.map((li) => li.innerHTML)).toEqual(["<bdi>عنوان</bdi>", "<bdi>عنوان آخر</bdi>"]);
  });

  it("other examples stay as they were: no <bdi> around an address", () => {
    const items = [...doc.querySelectorAll("#fix-first ul.code li")].filter((li) => /^https?:/.test(li.textContent));
    for (const li of items) expect(li.querySelector("bdi")).toBeNull();
  });
});
