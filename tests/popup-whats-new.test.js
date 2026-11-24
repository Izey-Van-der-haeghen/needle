// @vitest-environment jsdom
// The real popup after an update from 1.0.0: "Needle was updated", once, instead of the welcome note.
import { it, expect, vi } from "vitest";
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

  // Got it by keyboard: the button goes with the note, and focus moves to the active tab without scrolling.
  const gotIt = note.querySelector("[data-whats-new-dismiss]");
  gotIt.focus();
  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  gotIt.click();
  expect(document.querySelector(".whats-new")).toBeNull();
  const active = document.querySelector('[role="tab"][aria-selected="true"]');
  expect(active.id).toBe("tab-onpage");
  expect(document.activeElement).toBe(active);
  expect(focus.mock.contexts.at(-1)).toBe(active);
  expect(focus.mock.calls.at(-1)).toEqual([{ preventScroll: true }]);
  focus.mockRestore();
  await vi.waitFor(async () => expect((await storage.local.get("whatsNew")).whatsNew).toBeUndefined());
});
