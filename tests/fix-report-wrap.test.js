// The downloaded report at 375 px: one long word in a social title or a heading must wrap,
// not widen the page (full check of 25 November 2026, P2-1).
// jsdom has no layout, so this reads the report's own stylesheet: the element that holds the
// long word must sit inside a rule with overflow-wrap: anywhere.
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { buildHtmlReport } from "../lib/export.js";

const longWord = "Fietsenmakerij".repeat(16);
const onpage = {
  url: "https://e.be/", title: longWord, description: "D", canonical: "https://e.be/", robots: "", lang: "nl", viewport: "width=device-width",
  og: { title: longWord }, twitter: { title: longWord },
  headings: [{ level: 1, text: "H" }, { level: 2, text: longWord }],
  links: { total: 0, internal: 0, external: 0, nofollow: 0, broken: 0 },
  images: [], schema: [], hreflang: [], wordCount: 10, mainContentWordCount: 8, textRatio: 20
};
const html = buildHtmlReport({ url: onpage.url, onpage, technical: null, offpage: null, geo: null, health: null, verdict: null, theme: "light" });
const doc = new JSDOM(html).window.document;

/** Every selector in the report's stylesheet whose rule sets overflow-wrap: anywhere. */
function wrappingSelectors() {
  const css = doc.querySelector("style").textContent.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, , body]) => /overflow-wrap:\s*anywhere/.test(body))
    .flatMap(([, selectors]) => selectors.split(",").map((s) => s.trim()));
}
const wraps = (el) => wrappingSelectors().some((s) => el.closest(s));

describe("the report wraps one long word", () => {
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

  it("names the rules the fix added", () => {
    expect(html).toMatch(/\.card div\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(html).toMatch(/\.h-row\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });
});
