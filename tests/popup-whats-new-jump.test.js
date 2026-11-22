// @vitest-environment jsdom
// After a jump over versions (1.0.0 → now), the note shows only the newest lines and points to the changelog.
import { it, expect } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";
import { WHATS_NEW } from "../lib/whats-new.js";

it("keeps the note short", async () => {
  await loadPopup({ local: { whatsNew: { from: "1.0.0", at: 1 } } });
  const note = document.querySelector(".whats-new");
  const newest = Object.keys(WHATS_NEW).sort().reverse()[0];
  expect(note.querySelectorAll("li").length).toBe(WHATS_NEW[newest].length);
  expect(note.textContent).toMatch(/More changed since 1\.0\.0: see the full changelog\./);
});
