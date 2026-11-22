// @vitest-environment jsdom
// The real popup on a noindex page: the shorter "Fix this first" says, visibly, that it left findings out.
import { it, expect } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

it("shows 'N left out' in the summary and a line above the list", async () => {
  await loadPopup({ onpage: { robots: "noindex", description: "" } });
  const card = document.getElementById("findings-card");
  expect(card.querySelector("summary").textContent).toMatch(/\d+ left out/);
  expect(card.querySelector(".card-body > p.muted").textContent).toMatch(/only matter(s)? in search results (is|are) left out while the page is noindex/);
});
