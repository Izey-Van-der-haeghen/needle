// @vitest-environment jsdom
// The real popup: "Show all on page" says what is on the page. When the page doesn't answer,
// the button goes back to "Show all on page" instead of claiming the marks are there.
import { it, expect, vi } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

it("stays pressed only when the page marked the findings", async () => {
  let pageAnswers = false;
  await loadPopup({
    tabHandlers: {
      HIGHLIGHT_ISSUES: ({ items }) => {
        if (!pageAnswers) throw new Error("The tab was closed.");
        return { shown: items.length, hidden: 0, missing: 0 };
      },
      UNHIGHLIGHT_ISSUES: () => ({ ok: true })
    }
  });
  const btn = () => document.getElementById("toggle-issues");
  const toast = () => document.getElementById("copy-toast")?.textContent || "";

  btn().click();
  expect(btn().getAttribute("aria-pressed")).toBe("true");
  await vi.waitFor(() => expect(btn().getAttribute("aria-pressed")).toBe("false"));
  expect(btn().textContent).toBe("Show all on page");

  pageAnswers = true;
  btn().click();
  await vi.waitFor(() => expect(toast()).toMatch(/marked on the page/));
  expect(btn().getAttribute("aria-pressed")).toBe("true");
  expect(btn().textContent).toBe("Hide on page");

  btn().click();
  await vi.waitFor(() => expect(btn().getAttribute("aria-pressed")).toBe("false"));
});
