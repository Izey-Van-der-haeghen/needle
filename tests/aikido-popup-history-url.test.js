// @vitest-environment jsdom
// A page can make its own address megabytes long (history.pushState), and the side panel audits each new
// address, so clipping the title alone left the history able to fill chrome.storage.local's 10 MB. A page
// whose address is over 2,048 characters is left out of the history now, and so is one saved before.
import { it, expect, vi } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

const BASE = "https://www.riverside-bikes.example/";
const at = (length) => BASE + "p".repeat(length - BASE.length);
const LONGEST = at(2048);
// Long enough to show it: 50 such entries are 5 MB. (Each new URL() of it costs jsdom milliseconds, so
// the test stays at 100,000 characters; Chrome takes addresses of up to 2 MB.)
const HUGE = at(100_000);
const OLD = { url: at(500_000), title: "Old long page", verdict: "good", healthScore: 90, previousScore: null, ts: Date.now() - 60_000 };

const stored = async (storage) => (await storage.local.get("history")).history || [];

it("keeps addresses up to 2,048 characters in the history and leaves out longer ones, old and new", async () => {
  const { storage, chrome, tab } = await loadPopup({ panel: true, local: { history: [OLD] } });
  // The first audit's save also drops the long entry saved before.
  await vi.waitFor(async () => expect((await stored(storage)).map((h) => h.url)).toEqual([BASE + "repairs/"]), { timeout: 3000 });
  // Every history write from here on, so the test knows when an audit has saved.
  const writes = [];
  const set = storage.local.set;
  storage.local.set = (o) => { if ("history" in o) writes.push(o.history); return set(o); };

  // The side panel follows the tab to an address of exactly 2,048 characters: kept.
  Object.assign(tab, { url: LONGEST });
  chrome.tabs.onActivated._all.forEach((f) => f({ tabId: 1, windowId: 1 }));
  await vi.waitFor(() => expect(writes).toHaveLength(1), { timeout: 3000 });
  expect((await stored(storage)).map((h) => h.url.length)).toEqual([2048, BASE.length + 8]);

  // Then to one of 100,000 characters: audited, but not kept.
  Object.assign(tab, { url: HUGE });
  chrome.tabs.onActivated._all.forEach((f) => f({ tabId: 1, windowId: 1 }));
  await vi.waitFor(() => expect(writes).toHaveLength(2), { timeout: 3000 });
  const history = await stored(storage);
  expect(history.map((h) => h.url.length)).toEqual([2048, BASE.length + 8]);
  expect(JSON.stringify(history).length).toBeLessThan(4096);
});
