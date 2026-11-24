// @vitest-environment jsdom
// Full check of 24 November 2026, measured accessibility: focus after a button removes itself, the
// right message for an empty keyword, one main landmark in history.
import { it, expect, vi } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

it("keeps focus, says the right thing, and names history as the main content", async () => {
  await loadPopup({ local: { popupState: {} } }); // first visit: the welcome note shows
  const note = await vi.waitFor(() => { const n = document.querySelector(".onboarding"); if (!n) throw new Error("no welcome note"); return n; });
  expect(note.querySelector("details summary").textContent).toBe("What Needle reads, and when");

  note.querySelector("[data-onb-dismiss]").focus();
  note.querySelector("[data-onb-dismiss]").click();
  expect(document.activeElement?.getAttribute("role")).toBe("tab"); // not <body>

  // Search Google with no keyword: the title says what to do, and no network message follows.
  document.getElementById("tab-serp").click();
  const run = [...document.querySelectorAll("#panel-serp button")].find((b) => /Search Google/.test(b.textContent));
  run.click();
  await vi.waitFor(() => expect(document.getElementById("serp-result").textContent).toMatch(/Type a keyword first/));
  expect(document.getElementById("serp-result").textContent).not.toMatch(/internet connection/i);
  expect(document.getElementById("serp-result").getAttribute("aria-live")).toBeNull(); // announced once, not read out whole

  // History is the main content while it is open.
  document.getElementById("open-history").click();
  await vi.waitFor(() => expect(document.getElementById("history-panel").getAttribute("role")).toBe("main"));
  document.getElementById("close-history").click();
  expect(document.getElementById("history-panel").hasAttribute("role")).toBe(false);
});
