// @vitest-environment jsdom
// The real popup: "Show all on page" says what is on the page. When the page doesn't answer,
// the button goes back to "Show all on page" instead of claiming the marks are there. Esc takes
// every mark off the page, and the buttons and the marked count say so. The label is the state:
// the toggles have no aria-pressed.
import { it, expect, vi } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

let harness;
let pageAnswers = false;

it("stays pressed only when the page marked the findings", async () => {
  harness = await loadPopup({
    tabHandlers: {
      HIGHLIGHT_ISSUES: ({ items }) => {
        if (!pageAnswers) throw new Error("The tab was closed.");
        return { shown: items.length, hidden: 0, missing: 0 };
      },
      UNHIGHLIGHT_ISSUES: () => ({ ok: true }),
      HIGHLIGHT_LINKS: () => ({ matched: 7 }),
      UNHIGHLIGHT_LINKS: () => ({ ok: true }),
      UNHIGHLIGHT_HEADINGS: () => ({ ok: true })
    }
  });
  const btn = () => document.getElementById("toggle-issues");
  const toast = () => document.getElementById("copy-toast")?.textContent || "";

  btn().click();
  expect(btn().textContent).toBe("Hide on page");
  await vi.waitFor(() => expect(btn().textContent).toBe("Show all on page"));

  pageAnswers = true;
  btn().click();
  await vi.waitFor(() => expect(toast()).toMatch(/marked on the page/));
  expect(btn().textContent).toBe("Hide on page");

  btn().click();
  await vi.waitFor(() => expect(btn().textContent).toBe("Show all on page"));
  expect(btn().hasAttribute("aria-pressed")).toBe(false);
});

it("Esc takes the marks off the page and clears the marked count", async () => {
  const $ = (id) => document.getElementById(id);
  $("toggle-links").click();
  await vi.waitFor(() => expect($("highlight-count").textContent).toMatch(/\b7\b/));
  $("toggle-issues").click();
  await vi.waitFor(() => expect($("toggle-issues").textContent).toBe("Hide on page"));
  expect($("toggle-links").textContent).toBe("Hide on page");

  const sent = harness.tabMessages.length;
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await vi.waitFor(() => expect(harness.tabMessages.slice(sent).map((m) => m.msg.type).sort())
    .toEqual(["UNHIGHLIGHT_HEADINGS", "UNHIGHLIGHT_ISSUES", "UNHIGHLIGHT_LINKS"]));
  expect($("highlight-count").textContent).toBe("");
  expect($("toggle-links").textContent).toBe("Show on page");
  expect($("toggle-issues").textContent).toBe("Show all on page");
});
