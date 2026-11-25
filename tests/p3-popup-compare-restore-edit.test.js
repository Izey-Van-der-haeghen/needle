// @vitest-environment jsdom
// Review of the L3 fix (25 November 2026). With "Your page" empty, the restored comparison first
// reads the tab, which can take a while. A competitor address edited meanwhile wins: the restore
// doesn't show a comparison for the address that was there before.
import { it, expect, vi } from "vitest";
import { openWithHeldTabReads, settle } from "./p3-popup-compare-hold.js";

it("drops the restore when a competitor address is edited while the tab is read", async () => {
  const { tabReads, opened } = openWithHeldTabReads();
  await opened;
  await vi.waitFor(() => expect(tabReads).toHaveLength(1), { timeout: 3000 });
  const input = document.querySelector('.competitor-url[data-idx="0"]');
  input.value = "https://other.example/bikes";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  tabReads[0]();
  await settle();
  expect(document.getElementById("compare-result").innerHTML).toBe("");
});
