// @vitest-environment jsdom
// A page can make its <title> megabytes long. The history kept it whole, 50 entries deep, in the 10 MB
// that chrome.storage.local shares with the cache, the snapshots and the API keys. It keeps the first
// 200 characters now, of the new entry and of any entry saved before.
import { it, expect, vi } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

// 199 letters and a bicycle make 200 characters; the bicycle is two UTF-16 units and must stay whole.
const TITLE = `${"a".repeat(199)}\u{1F6B2}${"b".repeat(1_000_000)}`;
const OLD = { url: "https://www.other.example/", title: "z".repeat(500_000), verdict: "good", healthScore: 90, previousScore: null, ts: Date.now() - 60_000 };

it("keeps 200 characters of each title in the history, never half a character", async () => {
  const { storage } = await loadPopup({ onpage: { title: TITLE }, local: { history: [OLD] } });
  await vi.waitFor(async () => expect((await storage.local.get("history")).history).toHaveLength(2), { timeout: 3000 });
  const { history } = await storage.local.get("history");
  expect(history[0].title).toBe(`${"a".repeat(199)}\u{1F6B2}`);
  expect(history[1]).toEqual({ ...OLD, title: "z".repeat(200) });
  expect(JSON.stringify(history).length).toBeLessThan(2048);
});
