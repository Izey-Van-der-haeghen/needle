import { describe, it, expect, vi } from "vitest";
import { findInSitemaps, readLocs } from "../lib/sitemap-check.js";

const files = {
  "https://e.com/sitemap_index.xml": "<sitemapindex><sitemap><loc>https://e.com/a.xml</loc></sitemap><sitemap><loc>https://e.com/b.xml</loc></sitemap></sitemapindex>",
  "https://e.com/a.xml": "<urlset><url><loc>https://e.com/one/</loc></url></urlset>",
  "https://e.com/b.xml": "<urlset><url><loc><![CDATA[https://E.com/two?x=1&amp;y=2]]></loc></url></urlset>"
};
const fetcher = vi.fn(async (reqs) => reqs.map((r) => (files[r.url] ? { ok: true, status: 200, text: files[r.url] } : { ok: false, status: 404 })));

describe("findInSitemaps", () => {
  it("follows a sitemap index and normalises URLs", async () => {
    const r = await findInSitemaps("https://e.com/two?x=1&y=2#top", ["https://e.com/sitemap_index.xml"], fetcher);
    expect(r).toEqual({ found: true, sitemap: "https://e.com/b.xml", filesRead: 3, unread: 0, complete: true, unreadable: false });
  });

  it("reports not found, and whether every file was read", async () => {
    expect(await findInSitemaps("https://e.com/three", ["https://e.com/sitemap_index.xml"], fetcher)).toMatchObject({ found: false, complete: true });
    expect(await findInSitemaps("https://e.com/three", ["https://e.com/sitemap_index.xml"], fetcher, { maxFiles: 1 })).toMatchObject({ found: false, complete: false });
  });

  it("reads plain and CDATA <loc> values", () => {
    expect(readLocs(files["https://e.com/b.xml"])).toEqual(["https://E.com/two?x=1&y=2"]);
  });
});
