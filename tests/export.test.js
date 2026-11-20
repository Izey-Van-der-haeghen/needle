import { describe, it, expect } from "vitest";
import { buildHtmlReport } from "../lib/export.js";
import { analyzeAIAccess, analyzeEEAT, analyzeCitability, aiReadinessScore } from "../lib/geo.js";

const onpage = {
  url: "https://e.com/page", title: "A <b>title</b>", description: "Desc", canonical: "https://e.com/page", robots: "", lang: "en",
  viewport: "width=device-width", og: {}, twitter: {}, headings: [{ level: 1, text: "Hello" }],
  links: { total: 1, internal: 1, external: 0, nofollow: 0, broken: 0, byContext: { main: 1 } },
  images: [
    { src: "https://e.com/hero.jpg", alt: "", altMissing: true, displayedWidth: 800, displayedHeight: 400, context: "main", bytes: 200000, naturalWidth: 1600, naturalHeight: 800 },
    { src: "https://t.example/pixel.gif", alt: "", altMissing: false, displayedWidth: 1, displayedHeight: 1, context: "main" }
  ],
  schema: [], hreflang: [], wordCount: 10, mainContentWordCount: 8, mainContentSelector: "main", textRatio: 20, externalLinkCount: 0, listCount: 0, tableCount: 0
};

describe("buildHtmlReport", () => {
  const aiAccess = analyzeAIAccess({ text: "User-agent: OAI-SearchBot\nDisallow: /\n" });
  const eeat = analyzeEEAT(onpage);
  const citability = analyzeCitability(onpage);
  const geo = { aiAccess, eeat, citability, llmsTxt: { summary: { ok: false }, full: { ok: false } }, score: aiReadinessScore(aiAccess, eeat, citability) };
  const html = buildHtmlReport({
    url: onpage.url, onpage, technical: null, geo, health: null, verdict: null, theme: "light", version: "1.0.0",
    offpage: { psi: { mobile: { performanceScore: 55, cls: 0.12, clsCategory: "AVERAGE", lcp: 2600, lcpCategory: "AVERAGE" }, desktop: { error: "PageSpeed Insights answered HTTP 500." } }, psiError: null, dfs: null, dfsError: "Payment Required." }
  });

  it("escapes page text", () => {
    expect(html).toContain("A &lt;b&gt;title&lt;/b&gt;");
    expect(html).not.toContain("A <b>title</b>");
  });

  it("prints the AI section from the same data as the popup (bot names, E-E-A-T rows)", () => {
    expect(html).toContain("OAI-SearchBot");
    expect(html).toContain("Author byline");
    expect(html).not.toContain("undefined");
  });

  it("shows CLS as the real value and the DataForSEO error instead of '0 keywords'", () => {
    expect(html).toContain("0.12");
    expect(html).toContain("Payment Required.");
    expect(html).not.toMatch(/Organic keywords[^<]*<\/th><td>0</);
  });

  it("leaves tracking pixels out of the image list", () => {
    expect(html).toContain("hero.jpg");
    expect(html).not.toContain("pixel.gif");
  });

  it("links to Needle's own open-source repository", () => {
    expect(html).toMatch(/Made with <a href="https:\/\/github\.com\/Izey-Van-der-haeghen\/needle">Needle<\/a> 1\.0\.0/);
    expect(html.match(/github\.com\/[^"<\s]+/g)).toEqual(["github.com/Izey-Van-der-haeghen/needle"]);
  });

  it("links to the store page instead when Needle was installed from the store", () => {
    const fromStore = buildHtmlReport({ url: onpage.url, onpage, technical: null, geo: null, health: null, verdict: null, theme: "light", storeLink: "https://chromewebstore.google.com/detail/abc" });
    expect(fromStore).toContain('Made with <a href="https://chromewebstore.google.com/detail/abc">Needle</a>');
  });
});
