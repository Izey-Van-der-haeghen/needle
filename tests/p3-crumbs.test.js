// @vitest-environment jsdom
// The Google preview shows an internationalised host as Google does: readable, not as xn--.
import { it, expect, vi } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

it("shows a readable internationalised host in the Google preview's crumbs", async () => {
  await loadPopup({ onpage: { url: "https://xn--bcher-kva.example/fr/repairs/" } });
  await vi.waitFor(() => expect(document.querySelector(".g-crumbs")).not.toBeNull(), { timeout: 3000 });
  expect(document.querySelector(".g-crumbs").textContent).toMatch(/^bücher\.example › fr › repairs/);
});
