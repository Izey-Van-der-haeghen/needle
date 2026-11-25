// Aikido triage of 25 November 2026, in content.js:
//  - finding 17: the price check backtracked over every digit of a long run of digits, and the word
//    count of the rendered page (whose outerHTML has no size limit) scanned to the end from every
//    unclosed "<!--" in the text of an <xmp>;
//  - finding 12: a JSON-LD block nested thousands of levels deep went to the popup as it was, where
//    recursive readers overflowed and the pretty-printed JSON grew with the square of the depth. Now
//    it is reported as unreadable, as a block with a syntax error is.
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { loadContentScript, analyze, html } from "./helpers/content-harness.js";

const CONTENT = readFileSync(new URL("../content.js", import.meta.url), "utf8");

const opened = [];
afterEach(() => { while (opened.length) opened.pop().window.close(); });

describe("the price check in content.js (finding 17)", () => {
  const source = CONTENT.match(/const hasPricing = (\/.+\/i)\.test\(bodyText\);/)?.[1];
  const hasPricing = new Function(`return ${source};`)();
  // The check as it was, for the answers.
  const BEFORE = /(?:€|\$|£)\s*\d|\d[\d.,]*\s*(?:€|\$|£)|\d[.,]\d{2}\s*(?:eur|usd|gbp)\b/i;

  it("reads 50,000 digits (the most of the page it reads) in a moment", () => {
    for (const text of ["1".repeat(50000), "1.".repeat(25000), `${"9".repeat(49990)} kiezen`]) {
      const t0 = performance.now();
      expect(hasPricing.test(text)).toBe(false);
      expect(performance.now() - t0, text.slice(0, 12)).toBeLessThan(100);
    }
    expect(hasPricing.test(`${"1".repeat(49990)} €`)).toBe(true);
  });

  it("gives the same answers as before", () => {
    const fixed = ["Prijs 1.299,00 €", "€ 12", "12,50 EUR", "kost 5$", "2026 kiezen", "1.000.000 €", ".5€", ",50 €", "..5 €", "1. €", "£3", "3 £",
      "1.99 usd", "1,99usd", "1.9 usd", "€", "$ x", "v1.2.3 $", "12.34 euro", "a1€", "1\n€", "1  €", ""];
    for (const s of fixed) expect(hasPricing.test(s), JSON.stringify(s)).toBe(BEFORE.test(s));
    let seed = 17;
    // mulberry32: an LCG in floating point loses its low bits, so rnd(2), rnd(4) and rnd(8) were nearly always 0.
    const rnd = (k) => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) % k; };
    const pieces = ["1", "2", ".", ",", " ", "€", "$", "£", "eur", "usd", "a", "\n", "0", "x"];
    for (let i = 0; i < 20000; i++) {
      let s = "";
      for (let k = rnd(12); k > 0; k--) s += pieces[rnd(pieces.length)];
      expect(hasPricing.test(s), JSON.stringify(s)).toBe(BEFORE.test(s));
    }
  });

  it("is still the check ANALYZE_ONPAGE uses", async () => {
    expect((await analyze(html("<p>Prijs: 1.250 €</p>"))).schemaSignals.hasPricing).toBe(true);
    expect((await analyze(html(`<p>${"3".repeat(60000)}</p>`))).schemaSignals.hasPricing).toBe(false);
  });
});

describe("the word count of the rendered page (finding 17)", () => {
  it("answers GET_RENDERED in under a second for an <xmp> holding 100,000 unclosed comments", async () => {
    const page = await loadContentScript(html(`<p>a b</p><xmp>${"<!--".repeat(100000)}</xmp>`));
    opened.push(page);
    const t0 = performance.now();
    const rendered = await page.send({ type: "GET_RENDERED" });
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(rendered.wordCount).toBe(2);
  });
});

describe("JSON-LD nested too deep (finding 12)", () => {
  const nested = (levels) => `{"@context":"https://schema.org","@type":"Thing","name":"x","about":${'{"a":'.repeat(levels - 1)}1${"}".repeat(levels - 1)}}`;
  const schemaOf = async (blocks) => (await analyze(html("<p>x</p>", blocks.map((b) => `<script type="application/ld+json">${b}</script>`).join("")))).schema;

  it("reports a block nested deeper than 64 levels as unreadable instead of passing it on", async () => {
    for (const levels of [65, 2000, 10000]) {
      const [item, ...rest] = await schemaOf([nested(levels)]);
      expect(rest).toEqual([]);
      expect(item.type, `${levels} levels`).toBe("Invalid JSON");
      expect(item.raw.error).toBe("Nested more than 64 levels deep");
      expect(item.raw.text).toBe(nested(levels).slice(0, 200));
    }
    const [arrays] = await schemaOf([`${"[".repeat(5000)}{"@type":"Thing"}${"]".repeat(5000)}`]);
    expect(arrays.type).toBe("Invalid JSON");
  });

  it("passes a block of 64 levels on as it is, next to a deep one", async () => {
    const schema = await schemaOf([nested(64), nested(3000)]);
    expect(schema.map((s) => s.type)).toEqual(["Thing", "Invalid JSON"]);
    expect(schema[0].raw.about.a.a.a).toBeTypeOf("object");
  });
});
