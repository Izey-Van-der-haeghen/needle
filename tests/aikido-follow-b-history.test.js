// @vitest-environment jsdom
// History keeps an address of up to 2,048 characters whole, so its buttons open the page, but it showed
// all of it: a page can make its own address that long (history.pushState). Each entry now also stores a
// readable copy of at most 200 characters, which the list shows; an entry saved before has one made when shown.
import { it, expect, vi } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

const BASE = "https://www.riverside-bikes.example/";
const LONG = `${BASE}r%C3%A9paration/${"p".repeat(2048 - BASE.length - "r%C3%A9paration/".length)}`;
const OLD = { url: `${BASE}${"o".repeat(1000)}`, title: "Saved before", verdict: "good", healthScore: 90, previousScore: null, ts: Date.now() - 60_000 };
const entries = () => [...document.querySelectorAll("#history-list .history-item")];

it("stores and shows a readable address of at most 200 characters, and its buttons keep the whole address", async () => {
  const { storage, tab, chrome } = await loadPopup({ panel: true, local: { history: [OLD] } });
  await vi.waitFor(async () => expect((await storage.local.get("history")).history).toHaveLength(2), { timeout: 3000 });

  // The side panel follows the tab to a page whose address is 2,048 characters long.
  Object.assign(tab, { url: LONG });
  chrome.tabs.onActivated._all.forEach((f) => f({ tabId: 1, windowId: 1 }));
  await vi.waitFor(async () => expect((await storage.local.get("history")).history[0].url).toBe(LONG), { timeout: 3000 });
  const [saved] = (await storage.local.get("history")).history;
  expect(LONG).toHaveLength(2048);
  // The copy is the address as people read it (é, not %C3%A9), cut to 200 characters and marked as cut.
  const shown = `${`${BASE}réparation/${"p".repeat(200)}`.slice(0, 200)}…`;
  expect(saved.shown).toBe(shown);
  expect([...saved.shown]).toHaveLength(201);

  document.getElementById("open-history").click();
  await vi.waitFor(() => expect(entries()).toHaveLength(3));
  const [first, , old] = entries();
  expect(first.querySelector(".item-url").textContent).toBe(shown);
  // The buttons still open the whole address.
  expect([...first.querySelectorAll("button[data-url]")].map((b) => b.dataset.url)).toEqual([LONG, LONG]);
  // An entry saved before this change has no copy: the list makes one.
  expect(old.querySelector(".item-url").textContent).toBe(`${BASE}${"o".repeat(200 - BASE.length)}…`);
  expect(old.querySelector("button[data-url]").dataset.url).toBe(OLD.url);
});
