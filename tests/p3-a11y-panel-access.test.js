// @vitest-environment jsdom
// The real side panel: a switch to a tab Needle may not read shows "Click the Needle button to
// audit this tab", and a screen reader hears it too, as it hears the permission notice (P3-3).
import { it, expect, vi } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

const $ = (id) => document.getElementById(id);
const said = () => $("sr-status").textContent;

it("announces the access notice when the panel switches to a tab it may not read", async () => {
  const { chrome, tab } = await loadPopup({ panel: true });
  await vi.waitFor(() => expect(said()).toMatch(/^Page analysed/), { timeout: 3000 });

  // Chrome hides the address of a tab the side panel may not read.
  Object.assign(tab, { id: 2, url: "" });
  chrome.tabs.onActivated._all.forEach((f) => f({ tabId: 2, windowId: 1 }));
  await vi.waitFor(() => expect($("panel-onpage").textContent).toMatch(/Click the Needle button to audit this tab/), { timeout: 3000 });
  await vi.waitFor(() => expect(said()).toBe("Click the Needle button to audit this tab"));
});
