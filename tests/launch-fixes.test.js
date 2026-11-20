import { describe, it, expect, vi } from "vitest";
import { findInSitemaps } from "../lib/sitemap-check.js";
import { keywordPlacement } from "../lib/terms.js";
import { buildAiPrompt } from "../lib/ai-prompt.js";
import { snapshotOf } from "../lib/changes.js";
import { clearCache } from "../lib/cache.js";
import { hasUncleanFilename } from "../lib/popup-helpers.js";

describe("sitemaps that were not really read", () => {
  it("a gzipped or non-XML answer counts as unread", async () => {
    const r = await findInSitemaps("https://e.com/a", ["https://e.com/sitemap.xml.gz"], async () => [{ ok: true, status: 200, text: "\u001f\u008b binary" }]);
    expect(r).toMatchObject({ found: false, unread: 1, unreadable: true, complete: false });
  });

  it("a sitemap cut off at 10 MB without the page is not 'complete'", async () => {
    const text = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://e.com/other</loc></url>';
    const r = await findInSitemaps("https://e.com/a", ["https://e.com/sitemap.xml"], async () => [{ ok: true, status: 200, text, truncated: true }]);
    expect(r).toMatchObject({ found: false, complete: false, unread: 1 });
  });

  it("a page found in the part that was read is still found", async () => {
    const text = '<urlset><url><loc>https://e.com/a</loc></url>';
    const r = await findInSitemaps("https://e.com/a", ["https://e.com/sitemap.xml"], async () => [{ ok: true, status: 200, text, truncated: true }]);
    expect(r.found).toBe(true);
  });
});

describe("a hidden H1 doesn't count", () => {
  const page = { url: "https://e.com/bike-repair", title: "Bike repair", description: "", headings: [{ level: 1, text: "Bike repair", hidden: true }, { level: 2, text: "Prices" }], images: [], schema: [], og: {}, links: { details: [] } };
  it("in the keyword check, the AI prompt and the change snapshot", () => {
    expect(keywordPlacement("bike repair", page, "").find((r) => /H1/.test(r.place)).found).toBe(false);
    expect(buildAiPrompt({ onpage: page, findings: [] })).toMatch(/H1: \(none\)/);
    expect(snapshotOf(page, null).h1).toBe("");
  });
});

describe("clearing the cache", () => {
  it("an empty list of prefixes clears nothing", async () => {
    const set = vi.fn();
    globalThis.chrome = { storage: { local: { get: vi.fn(async () => ({ _cache: { "dfs::a": { data: 1, ts: Date.now() } } })), set } } };
    await clearCache([]);
    expect(set).not.toHaveBeenCalled();
    delete globalThis.chrome;
  });
});

describe("descriptive image names", () => {
  it.each([
    "4x4-off-road-guide.jpg", "nissan-patrol-4x4.webp", "photo-2024-team-day-ghent.jpg", "image-2-bike-repair-steps.png",
    "p1000-camera-review.jpg", "pic1-before-after.jpg", "screenshot-search-console-coverage.png"
  ])("%s is clear", (name) => {
    expect(hasUncleanFilename(`https://e.com/${name}`)).toBe(false);
  });
  it.each(["IMG_4512.jpg", "Screenshot 2026-11-20 at 10.00.00.png", "untitled-3.png", "hero-1200x630.jpg"])("%s is unclear", (name) => {
    expect(hasUncleanFilename(`https://e.com/${name}`)).toBe(true);
  });
});
