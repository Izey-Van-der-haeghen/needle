// @vitest-environment jsdom
// Two Needle views (side panels in two windows, or the popup next to the side panel) save the same
// popupState. A view writes only what it changed, so it never puts back an old copy of the rest.
import { it, expect } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

it("a tab click in one view keeps what another view saved", async () => {
  const { storage } = await loadPopup({ local: { popupState: {} } });
  await wait(200);
  const other = {
    onboardingDismissed: true,
    compare: { competitorUrls: ["https://rival.example/a"], selfUrl: "", keyword: "bike repair", visibleComps: 1 },
    marketByHost: { "www.other.example": { locationCode: 2056, languageCode: "fr" } }
  };
  await storage.local.set({ popupState: other });
  document.getElementById("tab-technical").click();
  await wait(300);
  const { popupState } = await storage.local.get("popupState");
  expect(popupState).toMatchObject(other);
  expect(popupState.activeTab).toBe("technical");

  // The other view's write lands while this view's change is still waiting: both survive.
  document.getElementById("tab-ai").click();
  const { popupState: now } = await storage.local.get("popupState");
  await storage.local.set({ popupState: { ...now, serp: { keyword: "bike shop" } } });
  await wait(300);
  const { popupState: after } = await storage.local.get("popupState");
  expect(after.activeTab).toBe("ai");
  expect(after.serp).toEqual({ keyword: "bike shop" });
  expect(after.marketByHost).toEqual(other.marketByHost);
});
