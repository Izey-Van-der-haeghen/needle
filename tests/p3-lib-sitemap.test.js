// @vitest-environment jsdom
// Full check of 25 November 2026, P3-4: a sitemap <loc> or an RSS <link> with "[" or "]".
import { describe, it, expect } from "vitest";
import { readLocs, sitemapEntries, findInSitemaps } from "../lib/sitemap-check.js";

const xmlText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

describe("sitemaps and feeds with square brackets", () => {
  it("reads a <loc> with brackets, plain or in CDATA", () => {
    const xml = `<urlset>
      <url><loc>https://e.com/bikes?filter[color]=red</loc></url>
      <url><loc><![CDATA[ https://e.com/bikes?size[]=m&amp;size[]=l ]]></loc></url>
      <url><loc>https://e.com/[draft]/</loc></url>
    </urlset>`;
    expect(readLocs(xml)).toEqual(["https://e.com/bikes?filter[color]=red", "https://e.com/bikes?size[]=m&size[]=l", "https://e.com/[draft]/"]);
  });

  it("reads an RSS item's <link> with brackets, plain or in CDATA", () => {
    const rss = `<rss><channel><link>https://e.com/</link>
      <item><title>A</title><link>https://e.com/a?tag[0]=x</link></item>
      <item><title>B</title><link><![CDATA[https://e.com/b?tag[1]=y]]></link></item>
    </channel></rss>`;
    expect(sitemapEntries(rss, "rss")).toEqual(["https://e.com/a?tag[0]=x", "https://e.com/b?tag[1]=y"]);
  });

  it("finds the page in the sitemap", async () => {
    const files = { "https://e.com/sitemap.xml": "<urlset><url><loc>https://e.com/bikes?filter[color]=red</loc></url></urlset>" };
    const fetcher = async (reqs) => reqs.map((r) => ({ ok: true, status: 200, text: files[r.url] }));
    expect(await findInSitemaps("https://e.com/bikes?filter[color]=red", ["https://e.com/sitemap.xml"], fetcher)).toMatchObject({ found: true });
  });

  it("reads every <loc> as an XML parser does", () => {
    // A fixed pseudo-random run, so a failure can be repeated.
    let seed = 42;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const chars = "abz09-._~:/?#[]@!$&'()*+,;=% é中";
    const urls = [];
    for (let i = 0; i < 500; i++) {
      let path = "";
      const n = 1 + Math.floor(next() * 30);
      for (let j = 0; j < n; j++) path += chars[Math.floor(next() * chars.length)];
      urls.push(`https://e.com/${path}`.trim());
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset>${urls.map((u) => `<url><loc>${xmlText(u)}</loc></url>`).join("\n")}</urlset>`;
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const parsed = [...doc.getElementsByTagName("loc")].map((el) => el.textContent.trim());
    expect(parsed).toHaveLength(500);
    expect(readLocs(xml)).toEqual(parsed);
  });
});

describe("files that could make reading slow", () => {
  // Each of these took seconds with a pattern that could try every split of the text.
  // Read in one pass, they take well under a millisecond.
  const timed = (fn) => {
    const start = performance.now();
    const result = fn();
    return { result, ms: performance.now() - start };
  };

  it("reads a <loc> with a long run of spaces and no closing tag quickly", () => {
    const xml = `<urlset>${`<url><loc>${" ".repeat(2000)}<x></url>`.repeat(2)}<url><loc> https://e.com/a </loc></url></urlset>`;
    const { result, ms } = timed(() => readLocs(xml));
    expect(result).toEqual(["https://e.com/a"]);
    expect(ms).toBeLessThan(250);
  });

  it("reads an RSS <link> with a long run of spaces and no closing tag quickly", () => {
    const rss = `<rss><channel><item><link>${" ".repeat(2000)}<x></item><item><link>https://e.com/b</link></item></channel></rss>`;
    const { result, ms } = timed(() => sitemapEntries(rss, "rss"));
    expect(result).toEqual(["https://e.com/b"]);
    expect(ms).toBeLessThan(250);
  });

  it("reads a file full of unclosed <loc tags quickly", () => {
    const { result, ms } = timed(() => readLocs(`<loc>https://e.com/c</loc>${"<loc".repeat(40000)}`));
    expect(result).toEqual(["https://e.com/c"]);
    expect(ms).toBeLessThan(250);
  });
});
