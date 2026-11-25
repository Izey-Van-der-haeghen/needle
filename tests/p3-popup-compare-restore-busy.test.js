// @vitest-environment jsdom
// Review of the L3 fix (25 November 2026). The comparison is restored after the audit. When Compare
// was pressed during the audit and still runs, the restore leaves it alone: it doesn't replace the
// run's "Loading" line.
import { it, expect, vi } from "vitest";
import { openWithHeldTabReads, settle, FX } from "./p3-popup-compare-hold.js";

it("doesn't restore over a Compare run that started during the audit", async () => {
  let finishAudit = null;
  let asked = false;
  const auditDone = new Promise((go) => { finishAudit = go; });
  const { tabReads, opened } = openWithHeldTabReads({ allSites: true, tabHandlers: { ANALYZE_ONPAGE: () => { asked = true; return auditDone.then(() => FX.onpage); } } });
  const result = document.getElementById("compare-result");
  // popup.js is running once it asks the page for the audit.
  await vi.waitFor(() => expect(asked).toBe(true), { timeout: 3000 });
  document.getElementById("run-compare").click();
  await vi.waitFor(() => expect(tabReads).toHaveLength(1)); // Compare's read of the tab
  finishAudit();
  await opened;
  await settle();
  // Any later read of the tab would be the restore's: let it answer.
  tabReads.slice(1).forEach((go) => go());
  await settle();
  expect(result.querySelector(".compare-table")).toBeNull();
  expect(result.textContent).toContain("Loading 2 pages");
  tabReads[0]();
  await vi.waitFor(() => expect(result.querySelector(".compare-table")).not.toBeNull());
});
