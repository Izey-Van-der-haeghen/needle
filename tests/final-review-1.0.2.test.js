// Last check of 1.0.2: a fresh review of the final commits.
import { describe, it, expect, vi } from "vitest";
import { JSDOM } from "jsdom";
import { analyze, html } from "./helpers/content-harness.js";
import { noConnection } from "../lib/link-checker.js";
import { analyzeEEAT } from "../lib/geo.js";
import { snapshotOf, recordSnapshot } from "../lib/changes.js";
import { analyzeTechnical } from "../lib/technical.js";
import { parseCompetitorHtml } from "../lib/parse-competitor.js";
import { cachedBanner } from "../lib/popup-helpers.js";
import { collectFindings } from "../lib/findings.js";

// Chrome's checkVisibility(): false without a box, and for everything but the summary of a closed <details>.
const chromeLike = (window) => {
  window.Element.prototype.checkVisibility = function () {
    for (let n = this; n && n.nodeType === 1; n = n.parentElement) {
      if (window.getComputedStyle(n).display === "none") return false;
      const p = n.parentElement;
      if (p && p.tagName === "DETAILS" && !p.open && n.tagName !== "SUMMARY") return false;
    }
    return true;
  };
};

describe("last check of 1.0.2", () => {
  it("a heading in a closed <details> keeps its whole text", async () => {
    const d = await analyze(html('<details><summary>Specs</summary><h3>Step <strong>1</strong>: unpack</h3><h4><a href="/x">Warranty</a></h4></details><h2>Visible <em>heading</em></h2>'), { setup: chromeLike });
    expect(d.headings.map((h) => h.text)).toEqual(["Step 1: unpack", "Warranty", "Visible heading"]);
  });

  it("offline with every link on one host is 'no connection'; a host that hangs while online isn't", () => {
    const res = ["https://a.example/1", "https://a.example/2"].map((url) => ({ url, kind: "broken", status: 0 }));
    vi.stubGlobal("navigator", { onLine: false });
    expect(noConnection(res)).toBe(true);
    vi.stubGlobal("navigator", { onLine: true });
    expect(noConnection(res)).toBe(false);
    vi.unstubAllGlobals();
  });

  it("WordPress's zero date and an empty list are no date", () => {
    const s = analyzeEEAT({ schema: [{ type: "Article", raw: { "@type": "Article", datePublished: "0000-00-00 00:00:00", dateModified: [] } }], og: {} });
    expect(s.find((x) => x.label === "Published date")).toMatchObject({ ok: false, value: "not detected" });
    expect(s.find((x) => x.label === "Modified date")).toMatchObject({ ok: false, value: "not detected" });
  });

  it("a snapshot from an older Needle sets a new baseline instead of showing changes", () => {
    const onpage = { title: "T", robots: "index, follow, googlebot: index, follow", headings: [] };
    const old = { ...snapshotOf(onpage, null), robots: "index, follow, index, follow" };
    delete old.v;
    const r = recordSnapshot({ u: { snap: old, ts: 1, prev: null, prevTs: null } }, "u", snapshotOf(onpage, null), 2);
    expect(r.changes).toEqual([]);
  });

  it("a guessed /sitemap.xml that answers 403 is missing; a listed one is 'not checked'", async () => {
    const run = (robots) => analyzeTechnical("https://e.com/page", async (reqs) => reqs.map((r) => (r.url.endsWith("/robots.txt")
      ? { ok: true, status: 200, text: robots, headers: {} }
      : r.url.endsWith("sitemap.xml") ? { ok: false, status: 403, text: "", headers: {} }
      : { ok: true, status: 200, text: "<html><body><p>x</p></body></html>", headers: { "content-type": "text/html" } })));
    expect((await run("User-agent: *\nAllow: /\n")).sitemap.unchecked).toBeFalsy();
    expect((await run("User-agent: *\nAllow: /\nSitemap: https://e.com/sitemap.xml\n")).sitemap.unchecked).toBe(true);
  });

  it("Compare reads robots and H1s as the On-page tab does", () => {
    const c = parseCompetitorHtml('<html><head><meta name="robots" content="index"><meta name="googlebot" content="nosnippet"><meta name="bingbot" content="noarchive"></head><body><h1>Web Vitals<span hidden>tooltip</span></h1><h1><svg aria-label="News"><title>News</title></svg></h1></body></html>', "https://c.example/", new JSDOM("").window.DOMParser);
    expect(c.robots).toBe("index, googlebot: nosnippet, bingbot: noarchive");
    expect(c.h1s).toEqual(["Web Vitals", "News"]);
  });

  it("a result saved a moment ago reads 'Saved just now'", () => {
    expect(cachedBanner(1000, "onpage")).toContain("Saved just now");
  });

  it("an inline image is named in Fix this first, not printed as base64", () => {
    const img = { src: "data:image/png;base64," + "A".repeat(4000), alt: undefined, altMissing: true, displayedWidth: 400, displayedHeight: 300, naturalWidth: 400, naturalHeight: 300, context: "main" };
    const page = { url: "https://e.com/", title: "A good title for this page, about forty chars", description: "x".repeat(120), robots: "", headings: [{ level: 1, text: "A" }], images: [img], schema: [], hreflang: [], links: { details: [] }, og: {} };
    const alt = collectFindings({ onpage: page }).find((f) => f.id === "img-alt");
    expect(alt.examples[0]).toMatch(/^Inline image \(PNG, /);
  });
});
