// @vitest-environment jsdom
// The proof for tests/popup-hostile-page.test.js: with escapeHtml broken on purpose, the same hostile
// page must make elements in the popup. If this ever passes without them, the check proves nothing.
import { it, expect, vi, afterAll } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";
import { hostileOptions, hostileFetch, visitEverything, injected, hostileReport, MARK } from "./helpers/hostile-page.js";

vi.mock("../lib/popup-helpers.js", async (importOriginal) => ({ ...(await importOriginal()), escapeHtml: (s) => String(s ?? "") }));

afterAll(() => vi.unstubAllGlobals());

it("catches page text drawn as HTML when escaping is broken", async () => {
  vi.stubGlobal("fetch", hostileFetch);
  await loadPopup(hostileOptions());
  await new Promise((r) => setTimeout(r, 300));
  await visitEverything();
  expect(injected().length).toBeGreaterThan(0);
});

it("catches page text drawn as HTML in the report when escaping is broken", () => {
  expect(hostileReport().querySelectorAll(`[${MARK}]`).length).toBeGreaterThan(0);
});
