// @vitest-environment jsdom
// The side panel, with the real popup.html, theme-boot.js and popup.js (review of 1.0.2:
// marking <html> "panel" before popup.js made a tab click hide the whole page).
import { it, expect } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

it("stays visible on every tab click, and is marked before popup.js runs", async () => {
  const { markedBeforePopupJs } = await loadPopup({ panel: true, activeTab: "ai" });
  const html = document.documentElement;
  expect(markedBeforePopupJs).toBe(true);
  expect(html.classList.contains("side-panel")).toBe(true);
  expect(html.hidden).toBe(false);
  for (const id of ["tab-technical", "tab-ai", "tab-offpage", "tab-onpage"]) {
    document.getElementById(id).click();
    expect(html.hidden).toBe(false);
    expect(document.body.hidden).toBe(false);
    expect(document.getElementById(id.replace("tab-", "panel-")).hidden).toBe(false);
  }
});
