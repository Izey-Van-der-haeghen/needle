// @vitest-environment jsdom
// The real side panel: the top bar's tooltip shows the same decoded address as the text under it.
import { it, expect, vi } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

const $ = (id) => document.getElementById(id);
const SITE = "https://www.riverside-bikes.example";

it("shows the decoded address in the tooltip of the top bar's address", async () => {
  const { chrome, tab } = await loadPopup({ panel: true });
  expect($("current-url").title).toBe($("current-url").textContent);

  // The next tab has an encoded address, as Chrome gives it.
  Object.assign(tab, { id: 2, url: `${SITE}/fr/v%C3%A9los-%C3%A9lectriques/` });
  chrome.tabs.onActivated._all.forEach((f) => f({ tabId: 2, windowId: 1 }));
  const decoded = `${SITE}/fr/vélos-électriques/`;
  await vi.waitFor(() => expect($("current-url").textContent).toBe(decoded), { timeout: 3000 });
  expect($("current-url").title).toBe(decoded);
});
