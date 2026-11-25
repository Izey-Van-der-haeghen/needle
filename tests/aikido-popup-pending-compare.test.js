// @vitest-environment jsdom
// "Compare this link's page" in the right-click menu leaves the link in storage (pendingCompare) for the
// view that opens next. When no view opened within a minute, the popup ignored the link but left it
// there for good, and neither "Clear history and snapshots" removed it: a page address no button cleared.
import { it, expect, vi } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

const $ = (id) => document.getElementById(id);
const STALE = { url: "https://rival.example/secret-page", ts: Date.now() - 5 * 60 * 1000 };

it("removes a stale right-clicked link on opening without using it, and Clear history removes one too", async () => {
  // deferChanges: the popup hears of a later write only when the test says, so only Clear can remove it.
  const { storage } = await loadPopup({ local: { pendingCompare: STALE }, deferChanges: true });
  await vi.waitFor(async () => expect(await storage.local.get("pendingCompare")).toEqual({}));
  // Too old to act on: not put in Compare, and Compare is not opened.
  expect(document.querySelector('.competitor-url[data-idx="0"]').value).toBe("");
  expect($("tab-compare").getAttribute("aria-selected")).toBe("false");

  // A right-click whose view never opened, while this popup is open.
  await storage.local.set({ pendingCompare: { ...STALE, url: "https://rival.example/other-page" } });
  $("open-history").click();
  const btn = $("clear-history");
  btn.click(); // arms: "Confirm"
  btn.click();
  await vi.waitFor(() => expect($("history-list").textContent).toMatch(/cleared/));
  expect(await storage.local.get("pendingCompare")).toEqual({});
});
