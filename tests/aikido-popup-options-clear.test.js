// @vitest-environment jsdom
// Settings > "Clear history and snapshots" also removes a link right-clicked for Compare that no view
// picked up (pendingCompare): it names a page, as the history does. Keys and preferences stay.
import { it, expect, vi } from "vitest";
import { loadOptions } from "./helpers/options-harness.js";

const $ = (id) => document.getElementById(id);

it("removes a waiting right-clicked link with the history, and keeps the API keys", async () => {
  const { storage } = await loadOptions({
    local: {
      history: [{ url: "https://www.other.example/", title: "Other", verdict: "good", ts: 1 }],
      snapshots: {},
      pendingCompare: { url: "https://rival.example/secret-page", ts: 1 },
      psiKey: "key-123"
    }
  });
  const btn = $("clear-history");
  btn.click(); // arms: "Confirm"
  btn.click();
  await vi.waitFor(() => expect($("maint-status").textContent).toMatch(/cleared/));
  const left = await storage.local.get(null);
  expect(left.pendingCompare).toBeUndefined();
  expect(left.history).toEqual([]);
  expect(left.psiKey).toBe("key-123");
});
