// One word and one colour per validator level, and one H1 label for the card and the report.
import { describe, it, expect } from "vitest";
import { SCHEMA_LEVEL, HREFLANG_LEVEL, h1Status } from "../lib/labels.js";
import { buildHtmlReport } from "../lib/export.js";

describe("labels", () => {
  it("an hreflang note is information (outlined), a structured-data recommendation is neutral", () => {
    expect(HREFLANG_LEVEL.info).toEqual(["note", "info"]);
    expect(SCHEMA_LEVEL.info).toEqual(["recommended", "neutral"]);
    expect(SCHEMA_LEVEL.note).toEqual(["note", "info"]);
  });

  it("the H1 label: one, several, only hidden, none", () => {
    expect(h1Status([{ level: 1 }])).toEqual(["one H1", "good"]);
    expect(h1Status([{ level: 1 }, { level: 1 }])).toEqual(["2 H1s", "warn"]);
    expect(h1Status([{ level: 1, hidden: true }])).toEqual(["H1 hidden", "warn"]);
    expect(h1Status([{ level: 2 }])).toEqual(["no H1", "bad"]);
  });

  it("the report draws the x-default note as information, like the popup", () => {
    const onpage = { url: "https://e.com/en/", title: "T", description: "", robots: "", lang: "en", headings: [], images: [], schema: [], links: { details: [], internal: 0, external: 0, byContext: {} },
      hreflang: [{ lang: "en", href: "https://e.com/en/" }, { lang: "nl", href: "https://e.com/nl/" }], og: {} };
    const html = buildHtmlReport({ onpage, tech: null });
    expect(html).toContain(`<span class="tag info">note</span> No x-default declared`);
  });
});

describe("one rule for the main content", () => {
  const words = (n, w) => Array.from({ length: n }, () => w).join(" ");
  it("the word count, readability and the word list read the same block", async () => {
    const { loadContentScript, html } = await import("./helpers/content-harness.js");
    const { countWords } = await import("../lib/words.js");
    const pages = [
      // a blog list: three articles together
      html(`<header><p>${words(20, "menu")}</p></header><article>${words(200, "fiets")}</article><article>${words(150, "herstel")}</article><article>${words(120, "gent")}</article>`),
      // <main> inside a #content wrapper with a sidebar
      html(`<div id="content"><main><p>${words(300, "fiets")}</p></main><aside>${words(250, "zijbalk")}</aside></div>`)
    ];
    for (const page of pages) {
      const { send, window } = await loadContentScript(page);
      const d = await send({ type: "ANALYZE_ONPAGE" });
      const t = await send({ type: "GET_MAIN_TEXT" });
      expect(countWords(t.text)).toBe(d.mainContentWordCount);
      window.close();
    }
  });
});

describe("Compare reads like the On-page tab", () => {
  it("counts characters as a reader does, and resolves a relative canonical as the server check", async () => {
    const { JSDOM } = await import("jsdom");
    const { parseCompetitorHtml } = await import("../lib/parse-competitor.js");
    const { buildCompareCsv } = await import("../lib/compare-export.js");
    const c = parseCompetitorHtml('<html><head><title>Café Brussel 🇧🇪 fietsherstel</title><link rel="canonical" href="/fiets/"><meta name="googlebot" content="nosnippet"></head><body><h1>A</h1></body></html>', "https://c.example/a", new JSDOM("").window.DOMParser);
    expect(c.canonical).toBe("https://c.example/fiets/");
    expect(c.robots).toBe("googlebot: nosnippet");
    const csv = buildCompareCsv([{ isMe: true, url: "https://c.example/a", data: c }], "", ",");
    expect(csv).toMatch(/Title length \(chars\),27/); // 27 as a reader counts (the flag is one), not 30 code units
  });

  it("the preview-image setting uses the one robots parser (dates with a comma, scopes)", async () => {
    const { imagePreviewSetting } = await import("../lib/image-rules.js");
    expect(imagePreviewSetting("max-image-preview:large, unavailable_after: Sat, 21 Nov 2026 00:00:00 GMT", "bingbot: max-image-preview:none")).toBe("large");
    expect(imagePreviewSetting("googlebot: max-image-preview:standard", "max-image-preview:large")).toBe("standard");
  });
});
