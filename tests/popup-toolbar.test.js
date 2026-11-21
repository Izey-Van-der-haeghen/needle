// @vitest-environment jsdom
// The toolbar popup, with the real popup.html, theme-boot.js and popup.js.
import { it, expect } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

it("is not marked as the side panel and keeps working on tab clicks", async () => {
  const { markedBeforePopupJs } = await loadPopup({ panel: false });
  const html = document.documentElement;
  expect(markedBeforePopupJs).toBe(false);
  expect(html.classList.contains("side-panel")).toBe(false);
  document.getElementById("tab-technical").click();
  expect(html.hidden).toBe(false);
  expect(document.getElementById("panel-technical").hidden).toBe(false);
  expect(document.getElementById("panel-onpage").hidden).toBe(true);
});
