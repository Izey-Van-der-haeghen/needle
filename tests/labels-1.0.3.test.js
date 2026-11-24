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
