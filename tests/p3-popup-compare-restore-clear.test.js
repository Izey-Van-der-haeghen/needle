// @vitest-environment jsdom
// Review of the L3 fix (25 November 2026). With "Your page" empty, the restored comparison first
// reads the tab, which can take a while. Clear pressed meanwhile wins: the comparison stays away.
import { it, expect, vi } from "vitest";
import { openWithHeldTabReads, settle } from "./p3-popup-compare-hold.js";

it("leaves the result empty when Clear is pressed while the tab is read", async () => {
  const { tabReads, opened } = openWithHeldTabReads();
  await opened;
  // The restore found the competitor in the cache and now reads the tab.
  await vi.waitFor(() => expect(tabReads).toHaveLength(1), { timeout: 3000 });
  document.getElementById("clear-compare").click();
  tabReads[0]();
  await settle();
  expect(document.getElementById("compare-result").innerHTML).toBe("");
});
