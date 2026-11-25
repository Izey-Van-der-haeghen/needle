// @vitest-environment jsdom
// Full check of 25 November 2026, open item L7: Esc clears the marks on the page from a text field
// too, as it does from a button. Other single keys in a text field stay typing.
import { it, expect, vi, beforeAll } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

let tabMessages;
beforeAll(async () => {
  ({ tabMessages } = await loadPopup());
});

const press = (el, key, mods = {}) => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods }));
const unmarks = () => tabMessages.map((m) => m.msg.type).filter((t) => /^UNHIGHLIGHT_/.test(t));

it("Esc in the keyword field clears the marks and the count", async () => {
  const field = document.getElementById("kw-input");
  field.focus();
  document.getElementById("highlight-count").textContent = "13 marked on the page";
  tabMessages.length = 0;

  press(field, "Escape");
  await vi.waitFor(() => expect(unmarks()).toEqual(["UNHIGHLIGHT_LINKS", "UNHIGHLIGHT_HEADINGS", "UNHIGHLIGHT_ISSUES"]));
  expect(document.getElementById("highlight-count").textContent).toBe("");
});

it("Esc with Ctrl, Alt or Cmd does nothing, and a digit in a text field doesn't switch tabs", async () => {
  const field = document.getElementById("kw-input");
  tabMessages.length = 0;
  press(field, "Escape", { ctrlKey: true });
  press(field, "Escape", { altKey: true });
  press(field, "Escape", { metaKey: true });
  press(field, "2");
  await new Promise((r) => setTimeout(r, 20));
  expect(unmarks()).toEqual([]);
  expect(document.getElementById("tab-onpage").getAttribute("aria-selected")).toBe("true");
  // Control: outside a text field the same key does switch tabs.
  press(document.body, "2");
  expect(document.getElementById("tab-technical").getAttribute("aria-selected")).toBe("true");
});
