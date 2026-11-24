// Full check of 24 November 2026, Break UI: addresses as people read them, numbers and names.
import { describe, it, expect } from "vitest";
import { displayUrl, pathSlug, fmtKB, timeAgo } from "../lib/popup-helpers.js";
import { compareExportFilename } from "../lib/compare-export.js";
import { collectFindings } from "../lib/findings.js";

describe("Break UI round of 24 November 2026", () => {
  it("shows an address with its letters, and keeps escapes that mean something", () => {
    expect(displayUrl("https://fr.wikipedia.org/wiki/R%C3%A9gion_de_Bruxelles-Capitale")).toBe("https://fr.wikipedia.org/wiki/Région_de_Bruxelles-Capitale");
    expect(displayUrl("https://a.example/a%2Fb?q=%26")).toBe("https://a.example/a%2Fb?q=%26");
    expect(displayUrl("https://a.example/%E9")).toBe("https://a.example/%E9"); // not UTF-8: left as written
  });

  it("gives each page its own report name", () => {
    expect(pathSlug("https://www.example.be/fr/vélos/")).toBe("-fr-velos");
    expect(pathSlug("https://www.example.be/")).toBe("");
  });

  it("writes sizes with thousands separators, and old times as a date", () => {
    expect(fmtKB(13248000)).toBe("12,937.5 KB");
    expect(timeAgo(Date.now() - 3 * 86400e3)).toBe("3 d ago");
    expect(timeAgo(Date.now() - 412 * 86400e3)).toMatch(/^on \d{4}-\d{2}-\d{2}$/);
  });

  it("names a Compare file in any script", () => {
    expect(compareExportFilename([{ isMe: true, url: "https://ar.example/" }], "اتصل بنا", "csv")).toContain("اتصل-بنا");
  });

  it("says 1 word and no words properly", () => {
    const page = (n) => ({ url: "https://e.com/", title: "A good title for this page, about forty chars", description: "x".repeat(120), robots: "", lang: "en", headings: [{ level: 1, text: "A" }], images: [], schema: [], hreflang: [], links: { details: [] }, og: { image: "https://e.com/og.jpg" }, mainContentWordCount: n });
    const thin = (n) => collectFindings({ onpage: page(n) }).find((f) => f.id === "thin")?.title;
    expect(thin(1)).toBe("Only 1 word of main content");
    expect(thin(0)).toBe("No text in the main content");
  });
});
