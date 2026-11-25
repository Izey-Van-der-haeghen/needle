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
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
    const r = rects.get(this.id);
    return typeof r === "function" ? r(this) : r || own.call(this);
  });
  // The toast sits at the bottom of a 600 px popup, or at the top with .toast-top (popup.css).
  rects.set("copy-toast", (el) => (el.classList.contains("toast-top") ? rect(96, 40) : rect(548, 40)));
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

/** Press again while the last toast is still in the page, the way a reader does a second later. */
async function pressAgain(btn) {
  const toast = $("copy-toast");
  toast.classList.remove("visible"); // faded out; its place (.toast-top or not) stays
  btn.focus();
  btn.click();
  await vi.waitFor(() => expect(toast.classList.contains("visible")).toBe(true));
  return toast;
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

it("moves to the top again when the same bottom button is pressed twice", async () => {
  rects.set("copy-dev", rect(552, 32));
  const first = await press($("copy-dev"));
  expect(first.classList.contains("toast-top")).toBe(true);
  // The toast is measured where it would show, at the bottom: not at the top, where the last one went.
  const second = await pressAgain($("copy-dev"));
  expect(second.classList.contains("toast-top")).toBe(true);
});

it("goes back to the bottom when a button at the top is pressed after a toast at the top", async () => {
  rects.set("copy-dev", rect(552, 32));
  rects.set("copy-ai", rect(100, 32));
  const first = await press($("copy-dev"));
  expect(first.classList.contains("toast-top")).toBe(true);
  const second = await pressAgain($("copy-ai"));
  expect(second.classList.contains("toast-top")).toBe(false);
});
