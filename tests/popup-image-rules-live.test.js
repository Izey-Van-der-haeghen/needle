// @vitest-environment jsdom
// The side panel stays open while the user changes Settings: a new image size limit redraws the
// Images card and Fix this first at once, without a new audit.
import { it, expect, vi } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

it("follows a new size limit from Settings in the Images card and in Fix this first", async () => {
  const { storage } = await loadPopup({ panel: true });
  const card = () => document.getElementById("images-card").textContent;
  const findings = () => [...document.querySelectorAll("#findings-card .finding-title")].map((t) => t.textContent);
  // The demo page's workshop photo is 402 KB: over the default limit of 100 KB.
  expect(card()).toMatch(/workshop-hero\.jpg[\s\S]*over 100 KB/);
  expect(findings()).toContain("1 image over 100 KB");

  await storage.sync.set({ imgMaxKB: "500" });
  await vi.waitFor(() => expect(card()).not.toMatch(/over 100 KB/));
  expect(card()).toMatch(/workshop-hero\.jpg/);
  expect(findings().some((t) => /over \d+ KB/.test(t))).toBe(false);
});
