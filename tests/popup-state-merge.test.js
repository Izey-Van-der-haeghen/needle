// @vitest-environment jsdom
// Two Needle views (side panels in two windows, or the popup next to the side panel) save the same
// popupState. A view writes only what it changed, so it never puts back an old copy of the rest.
// The other view's change reaches this view late (deferChanges): only reading the stored copy at
// save time keeps it.
import { it, expect, vi } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

it("a tab click in one view keeps what another view saved, even before this view hears of it", async () => {
  const { storage, deliverChanges } = await loadPopup({ local: { popupState: {} }, deferChanges: true });
  const stored = async () => (await storage.local.get("popupState")).popupState;
  const other = {
    onboardingDismissed: true,
    compare: { competitorUrls: ["https://rival.example/a"], selfUrl: "", keyword: "bike repair", visibleComps: 1 },
    marketByHost: { "www.other.example": { locationCode: 2056, languageCode: "fr" } }
  };
  await storage.local.set({ popupState: other });
  document.getElementById("tab-technical").click();
  await vi.waitFor(async () => expect((await stored()).activeTab).toBe("technical"));
  expect(await stored()).toEqual({ ...other, activeTab: "technical" });
  await deliverChanges();

  // The other view's write lands while this view's change is still waiting: both survive.
  document.getElementById("tab-ai").click();
  await storage.local.set({ popupState: { ...(await stored()), serp: { keyword: "bike shop" } } });
  await vi.waitFor(async () => expect((await stored()).activeTab).toBe("ai"));
  expect(await stored()).toEqual({ ...other, activeTab: "ai", serp: { keyword: "bike shop" } });

  // Once the changes arrive, this view's copy follows them: its next save keeps them too.
  await deliverChanges();
  document.getElementById("tab-onpage").click();
  await vi.waitFor(async () => expect((await stored()).activeTab).toBe("onpage"));
  expect(await stored()).toEqual({ ...other, activeTab: "onpage", serp: { keyword: "bike shop" } });
});
