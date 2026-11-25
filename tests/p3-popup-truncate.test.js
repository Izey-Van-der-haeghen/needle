// @vitest-environment jsdom
// Full check of 25 November 2026, P3-12: the Google preview cuts a long title or description
// between characters as a reader sees them, never inside an emoji or an emoji sequence.
// The harness measures 8 px per UTF-16 unit: the title fits 75 units with its "…", the description 123.
import { it, expect, beforeAll } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

const FACE = "\u{1F600}"; // one emoji, two UTF-16 units
const FAMILY = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}"; // one emoji sequence, eight units
// No spaces, so the cut can't fall back to the last word.
const TITLE = "a".repeat(73) + FACE + "b".repeat(20);
const DESCRIPTION = "c".repeat(118) + FAMILY + "d".repeat(30);
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

beforeAll(async () => {
  await loadPopup({ onpage: { title: TITLE, description: DESCRIPTION } });
});

it("cuts the title before an emoji that doesn't fit, not inside it", () => {
  const shown = document.querySelector(".g-title").textContent;
  expect(shown).not.toMatch(LONE_SURROGATE);
  expect(shown).toBe("a".repeat(73) + "…");
});

it("cuts the description before an emoji sequence that doesn't fit, not inside it", () => {
  const shown = document.querySelector(".g-desc").textContent;
  expect(shown).not.toMatch(LONE_SURROGATE);
  expect(shown).not.toContain("\u200D");
  expect(shown).toBe("c".repeat(118) + "…");
});
