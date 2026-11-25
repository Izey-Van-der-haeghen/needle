// @vitest-environment jsdom
// The Technical tab's Sitemap row shows the path of the sitemap the server check found. A robots.txt
// "Sitemap:" value on a scheme other than http(s) keeps < > " ' in that path (new URL('x:"<b>').pathname is
// '"<b>'), and the row put it into innerHTML as HTML. tests/popup-hostile-page.test.js covers the whole way
// from robots.txt; this test hands the popup such a result straight from its cache, so the escape in the
// row stays tested whatever lib/robots.js and lib/technical.js come to accept.
import { it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPopup } from "./helpers/popup-harness.js";
import { analyzeTechnical } from "../lib/technical.js";
import { cacheKey, pageId } from "../lib/cache.js";

// A path, not a URL object: in a jsdom test the global URL is jsdom's, which node:fs refuses.
const FX = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../dev/preview/fixtures/riverside.json"), "utf8"));
const MARK = "data-needle-xss";
const RAW = `x:"'><b/${MARK}><img/src=x>`;

/** The demo site's server answers, as lib/page-fetch.js reports them. */
const fetcher = async (requests) => requests.map((r) => {
  const p = FX.pages[r.url];
  return p ? { ok: p.status < 400, status: p.status, url: r.url, redirected: false, headers: p.headers, text: p.text, truncated: false, ms: 40 }
    : { ok: false, status: 404, url: r.url, redirected: false, headers: {}, text: "", truncated: false, ms: 20 };
});

it("shows a raw sitemap path as text in the Technical tab", async () => {
  const technical = await analyzeTechnical(FX.url, fetcher);
  technical.sitemap = { ok: false, status: 0, url: RAW, unchecked: true, reason: "on another site, not checked" };
  await loadPopup({ activeTab: "technical", local: { _cache: { [cacheKey("technical", pageId(FX.url))]: { data: technical, ts: Date.now() } } } });

  const sitemapCard = () => [...document.querySelectorAll("#panel-technical .card")].find((c) => c.querySelector("h2")?.textContent === "Sitemap");
  await vi.waitFor(() => expect(sitemapCard()).toBeTruthy());
  const card = sitemapCard();
  expect([...document.querySelectorAll(`[${MARK}], img[src="x"]`)].map((el) => el.outerHTML)).toEqual([]);
  // Not vacuous: the row drew the path, as text.
  expect(card.querySelector(".row .k").textContent).toBe(`"'><b/${MARK}><img/src=x>`);
});
