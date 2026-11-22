// Full check of 1.0.2, Impeccable round: a fresh audit can be redone, noindex says what it left
// out, and a language redirect has to keep the page.
import { describe, it, expect } from "vitest";
import { cachedBanner } from "../lib/popup-helpers.js";
import { isLanguageRedirect } from "../lib/link-checker.js";
import { buildIssuesMarkdown } from "../lib/handoff.js";

describe("the audit banner", () => {
  it("a fresh audit says when it was made and offers Refresh", () => {
    const now = new Date(2026, 10, 22, 14, 32);
    const html = cachedBanner(0, "onpage", { always: true, now });
    expect(html).toContain(`Audited at ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`); // 24-hour, as the report
    expect(html).toMatch(/data-refresh="onpage"/);
    expect(cachedBanner(0, null)).toBe("");
  });
});

describe("a language redirect", () => {
  it("keeps the page, with at most one section added", () => {
    expect(isLanguageRedirect("https://privacy.example.com/privacystatement", "https://privacy.example.com/fr-fr/privacy/privacystatement")).toBe(true);
    expect(isLanguageRedirect("https://site.example/help", "https://site.example/en/help")).toBe(true);
    expect(isLanguageRedirect("https://site.example/blog/post", "https://site.example/de/archive/2019/post")).toBe(false);
    expect(isLanguageRedirect("https://site.example/help", "https://site.example/es/help/old-page-moved")).toBe(false);
    expect(isLanguageRedirect("https://site.example/products/index", "https://site.example/en/index")).toBe(false);
  });
});

describe("a noindex page's hand-off", () => {
  it("lists the findings left out", () => {
    const onpage = { url: "https://e.com/page", title: "Short", description: "", robots: "noindex", headings: [{ level: 1, text: "A" }], images: [], schema: [], hreflang: [], links: { details: [] }, og: {}, viewport: "width=device-width", lang: "en", mainContentWordCount: 40 };
    const md = buildIssuesMarkdown(onpage, null, { now: new Date(2026, 10, 22) });
    const list = md.split("Left out while noindex:\n")[1].split("\n\n")[0].split("\n");
    expect(list).toEqual(["- No canonical URL", "- Title is only 5 characters", "- No meta description", "- Only 40 words of main content"]);
  });
});
