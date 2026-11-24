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
