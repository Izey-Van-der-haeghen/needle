// @vitest-environment jsdom
// The real popup while the server check is still running: the score line is short on screen
// ("Score …") and complete for screen readers; the number comes when the check answers.
import { it, expect, vi } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

it("says 'Score …' and, to screen readers, 'after the server check', until the server check answers", async () => {
  // The server check reads the page through chrome.scripting; hold it until the test answers.
  const held = [];
  let hold = true;
  await loadPopup({ scripting: () => (hold ? new Promise((resolve) => held.push(resolve)) : Promise.resolve([{ result: undefined }])) });
  await vi.waitFor(() => expect(document.querySelector("#verdict-slot .health")).not.toBeNull());
  const health = () => document.querySelector("#verdict-slot .health");
  expect(health().querySelector('[aria-hidden="true"]').textContent).toBe("…");
  expect(health().querySelector(".visually-hidden").textContent).toBe("after the server check");
  expect(health().textContent.replace(/\s+/g, " ").trim()).toBe("Score …after the server check");
  expect(health().textContent).not.toMatch(/\d/);

  expect(held.length).toBeGreaterThan(0);
  hold = false;
  held.forEach((resolve) => resolve([{ result: undefined }]));
  await vi.waitFor(() => expect(health().textContent).toMatch(/^Score \d+\/100$/));
  expect(health().querySelector(".visually-hidden")).toBeNull();
});
