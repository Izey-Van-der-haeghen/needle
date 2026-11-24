// @vitest-environment jsdom
// The real popup: the "Copied" toast appears at the bottom, unless the button that was pressed sits
// there. Then it moves to the top, so it never covers the button the reader is on.
import { it, expect, vi, beforeAll, afterAll } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

const $ = (id) => document.getElementById(id);
// jsdom has no layout: give the toast and the pressed button their place on screen.
const rects = new Map();
const rect = (top, height) => ({ top, bottom: top + height, left: 100, right: 300, width: 200, height, x: 100, y: top });

beforeAll(async () => {
  await loadPopup();
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => {} }, configurable: true });
  const own = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () { return rects.get(this.id) || own.call(this); });
  rects.set("copy-toast", rect(548, 40)); // the bottom of a 600 px popup
});
afterAll(() => vi.restoreAllMocks());

/** Press the button by keyboard and wait for its toast (a new one: the last may still show). */
async function press(btn) {
  $("copy-toast")?.remove();
  btn.focus();
  btn.click();
  await vi.waitFor(() => expect($("copy-toast")?.classList.contains("visible")).toBe(true));
  return $("copy-toast");
}

it("moves to the top when the pressed button is under it", async () => {
  rects.set("copy-dev", rect(552, 32));
  const toast = await press($("copy-dev"));
  expect(toast.classList.contains("toast-top")).toBe(true);
});

it("stays at the bottom when the pressed button is elsewhere", async () => {
  rects.set("copy-ai", rect(120, 32));
  const toast = await press($("copy-ai"));
  expect(toast.classList.contains("toast-top")).toBe(false);
});
