// @vitest-environment jsdom
// The real popup on a tab that shows Chrome's error page (no internet): one alert, in plain words.
import { it, expect } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

it("says why once, and the Technical tab points to it", async () => {
  await loadPopup({ unreadable: "Frame with ID 0 is showing error page" });
  const alerts = [...document.querySelectorAll('[role="alert"]')];
  expect(alerts.length).toBe(1);
  expect(alerts[0].textContent).toMatch(/The tab shows an error page instead of the website/);
  expect(alerts[0].textContent).not.toMatch(/Frame with ID/);
  expect(document.getElementById("panel-technical").textContent).toMatch(/The server check needs the page too; see the On-page tab/);
});
