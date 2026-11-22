// @vitest-environment jsdom
// The real popup: the Images card shows the Discover line only on articles, as Fix this first does.
import { it, expect } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

it("leaves the Discover line out on a page that isn't an article (the demo bike shop)", async () => {
  await loadPopup();
  const card = document.querySelector("#images-card");
  expect(card.querySelector("#image-list")).not.toBeNull();
  expect(card.textContent).not.toMatch(/Discover/);
});
