// @vitest-environment jsdom
// A page can put anything in its title, headings, links, alt texts, schema, headers, robots.txt and
// sitemap; so can the pages Needle loads for its checks (hreflang alternates, the http/https/www
// versions, a Compare competitor), and the history keeps page titles. The popup builds its views with
// innerHTML, so every such text must arrive as text, never as HTML.
// tests/popup-hostile-page-proof.test.js shows this test fails when escaping breaks.
import { it, expect, vi, afterAll } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";
import { hostileOptions, hostileFetch, visitEverything, injected, hostileReport, MARK, RESULT_BOXES } from "./helpers/hostile-page.js";

afterAll(() => vi.unstubAllGlobals());

it("shows hostile texts as text in every tab, in History and in every check result, and makes no element from them", async () => {
  vi.stubGlobal("fetch", hostileFetch);
  await loadPopup(hostileOptions());
  await vi.waitFor(() => expect(document.querySelector("#verdict-slot .health")?.textContent).toMatch(/\d+\/100/), { timeout: 3000 });
  await visitEverything();

  expect(injected().map((el) => el.outerHTML.slice(0, 120))).toEqual([]);
  // Not vacuous: the payload was drawn, as text, in each tab that shows page text and in each result.
  for (const id of ["panel-onpage", "panel-technical", "panel-ai", ...RESULT_BOXES]) {
    expect(document.getElementById(id).textContent, id).toContain(MARK);
  }
});

it("keeps the hostile page's texts as text in the downloadable report too", () => {
  const doc = hostileReport();
  expect([...doc.querySelectorAll(`[${MARK}], img[src="x"], [onerror]`)].map((el) => el.outerHTML.slice(0, 120))).toEqual([]);
  expect(doc.body.textContent).toContain(MARK);
});
