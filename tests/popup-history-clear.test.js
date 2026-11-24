// @vitest-environment jsdom
// The real popup: Clear history also forgets the country and language picked per website (they name
// those sites too), and keeps the rest of what the popup remembers.
import { it, expect, vi } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

it("clears history and snapshots, forgets the per-site markets, keeps the other saved choices", async () => {
  const { storage } = await loadPopup({
    local: {
      history: [{ url: "https://www.other.example/", title: "Other", verdict: "good", ts: Date.now() }],
      snapshots: { "https://www.other.example/": { ts: 1 } },
      popupState: {
        onboardingDismissed: true,
        compare: { keyword: "bike repair" },
        marketByHost: { "www.other.example": { locationCode: 2056, languageCode: "fr" } },
        serpMarketByHost: { "www.other.example": { locationCode: 2056, languageCode: "nl" } }
      }
    }
  });
  // The audit of this page adds it to the history first.
  await vi.waitFor(async () => expect((await storage.local.get("history")).history).toHaveLength(2));
  document.getElementById("open-history").click();
  const btn = document.getElementById("clear-history");
  btn.click(); // arms: "Confirm"
  btn.click();
  await vi.waitFor(async () => expect((await storage.local.get("popupState")).popupState.marketByHost).toBeUndefined());
  const { history, snapshots, popupState } = await storage.local.get(["history", "snapshots", "popupState"]);
  expect(history).toEqual([]);
  expect(snapshots).toEqual({});
  expect(popupState.serpMarketByHost).toBeUndefined();
  expect(popupState).toMatchObject({ onboardingDismissed: true, compare: { keyword: "bike repair" } });
  expect(document.getElementById("history-list").textContent).toMatch(/cleared/);
});
