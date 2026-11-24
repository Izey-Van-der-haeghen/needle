// @vitest-environment jsdom
// The real popup: changing the country while a keyword lookup runs doesn't wipe that lookup
// (a market change only shows a saved result; it never takes over a paid lookup in progress).
import { it, expect, vi } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

it("keeps a running keyword lookup on screen when the country changes, and shows its answer", async () => {
  const lookups = [];
  const { storage } = await loadPopup({
    local: { dfsLogin: "me@example.com", dfsPassword: "secret" },
    runtime: { RUN_DFS: (msg) => new Promise((resolve) => lookups.push({ msg, resolve })) }
  });
  const result = document.getElementById("dfs-result");
  document.getElementById("run-dfs").click();
  await vi.waitFor(() => expect(lookups).toHaveLength(1));
  expect(result.textContent).toMatch(/Asking DataForSEO/);

  const country = document.getElementById("offpage-location");
  const other = [...country.options].find((o) => o.value !== country.value && o.value !== String(lookups[0].msg.locationCode)).value;
  country.value = other;
  country.dispatchEvent(new Event("change", { bubbles: true }));
  // The new country is saved for this site (after the save delay): by then the change has been handled.
  await vi.waitFor(async () => expect((await storage.local.get("popupState")).popupState.marketByHost?.["www.riverside-bikes.example"]?.locationCode).toBe(Number(other)));
  expect(result.textContent).toMatch(/Asking DataForSEO/);
  expect(result.querySelector('[role="status"]')).not.toBeNull();

  lookups[0].resolve({ error: "DataForSEO answered HTTP 500." });
  await vi.waitFor(() => expect(result.textContent).toMatch(/The keyword lookup failed/));
  expect(lookups).toHaveLength(1);
});
