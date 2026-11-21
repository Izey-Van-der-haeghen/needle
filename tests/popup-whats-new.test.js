// @vitest-environment jsdom
// The real popup after an update from 1.0.0: "Needle was updated", once, instead of the welcome note.
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPopup } from "./helpers/popup-harness.js";

// A path, not a URL object: in a jsdom test the global URL is jsdom's.
const MANIFEST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../manifest.json");

it("shows what changed, links the changelog, and goes away with Got it", async () => {
  const { storage } = await loadPopup({ local: { whatsNew: { from: "1.0.0", at: 1 }, popupState: { onboardingDismissed: false } } });
  const version = JSON.parse(readFileSync(MANIFEST, "utf8")).version;
  const note = document.querySelector(".whats-new");
  expect(note).not.toBeNull();
  expect(note.querySelector("strong").textContent).toBe(`Needle was updated to ${version}`);
  expect(note.querySelectorAll("li").length).toBeGreaterThan(0);
  expect(note.querySelector('a[href$="/CHANGELOG.md"]').getAttribute("rel")).toBe("noopener noreferrer");
  expect(document.querySelector(".onboarding")).toBeNull();
  note.querySelector("[data-whats-new-dismiss]").click();
  expect(document.querySelector(".whats-new")).toBeNull();
  expect((await storage.local.get("whatsNew")).whatsNew).toBeUndefined();
});
