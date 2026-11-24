// @vitest-environment jsdom
// The real popup: Clear history also forgets the country and language picked per website (they name
// those sites too), and keeps the rest of what the popup remembers. The pickers on screen follow at once.
import { it, expect, vi } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";
import { detectMarketFromUrl } from "../lib/popup-compute.js";

const $ = (id) => document.getElementById(id);
const pickers = () => ({
  offpage: [$("offpage-location").value, $("offpage-language").value],
  serp: [$("serp-location").value, $("serp-language").value]
});

it("clears history and snapshots, forgets the per-site markets, keeps the other saved choices", async () => {
  const { storage, tab } = await loadPopup({
    local: {
      history: [{ url: "https://www.other.example/", title: "Other", verdict: "good", ts: Date.now() }],
      snapshots: { "https://www.other.example/": { ts: 1 } },
      popupState: {
        onboardingDismissed: true,
        compare: { keyword: "bike repair" },
        marketByHost: {
          "www.other.example": { locationCode: 2056, languageCode: "fr" },
          "www.riverside-bikes.example": { locationCode: 2056, languageCode: "fr" }
        },
        serpMarketByHost: {
          "www.other.example": { locationCode: 2056, languageCode: "nl" },
          "www.riverside-bikes.example": { locationCode: 2528, languageCode: "nl" }
        }
      }
    }
  });
  // The audit of this page adds it to the history first, and the pickers show the markets picked for this site.
  await vi.waitFor(async () => expect((await storage.local.get("history")).history).toHaveLength(2));
  expect(pickers()).toEqual({ offpage: ["2056", "fr"], serp: ["2528", "nl"] });

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

  // Both pickers are back on the market the page itself suggests: the demo page is <html lang="en-GB">.
  const own = detectMarketFromUrl(tab.url, "en-GB");
  expect(own).toEqual({ code: 2826, lang: "en" });
  expect(pickers()).toEqual({ offpage: ["2826", "en"], serp: ["2826", "en"] });
});
