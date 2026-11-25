// @vitest-environment jsdom
// Review of the L3 fix (25 November 2026). With "Your page" empty, the restored comparison first
// reads the tab, which can take a while. A Compare run started meanwhile wins: the restore doesn't
// replace its "Loading" line, and only the run's own result shows.
import { it, expect, vi } from "vitest";
import { openWithHeldTabReads, settle } from "./p3-popup-compare-hold.js";

it("leaves Compare's own run alone when Compare is pressed while the restore reads the tab", async () => {
  const { tabReads, opened } = openWithHeldTabReads({ allSites: true });
  await opened;
  await vi.waitFor(() => expect(tabReads).toHaveLength(1), { timeout: 3000 });
  const result = document.getElementById("compare-result");
  document.getElementById("run-compare").click();
  // Compare reads the tab too: that is the second read.
  await vi.waitFor(() => expect(tabReads).toHaveLength(2));
  expect(result.textContent).toContain("Loading 2 pages");
  tabReads[0](); // the restore's read answers first
  await settle();
  expect(result.querySelector(".compare-table")).toBeNull();
  expect(result.textContent).toContain("Loading 2 pages");
  tabReads[1]();
  await vi.waitFor(() => expect(result.querySelector(".compare-table")).not.toBeNull());
});
