// @vitest-environment jsdom
// The real popup: the Images card lists the first 100 images and says so, as the Links list does.
// The note is part of the list, so a filter change keeps it right.
import { it, expect } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

// 150 content images: 30 without alt, 120 with.
const images = Array.from({ length: 150 }, (_, i) => ({
  domIndex: i, src: `https://www.riverside-bikes.example/img/bike-${i}.jpg`, alt: i < 30 ? "" : `Bike ${i}`, altMissing: i < 30,
  naturalWidth: 800, naturalHeight: 600, displayedWidth: 400, displayedHeight: 300, format: "jpg", bytes: 50000,
  context: "main", isBackground: false, brokenLoad: false, lazy: false, aboveFold: false, lazyAboveFold: false
}));

it("says the list stops at 100, and keeps that right when a filter changes", async () => {
  await loadPopup({ onpage: { images } });
  const list = document.getElementById("image-list");
  const note = () => [...list.querySelectorAll("li.muted")].map((li) => li.textContent.trim()).find((t) => /^First 100/.test(t)) || "";
  const items = () => list.querySelectorAll("li.image-item").length;
  const filter = (val) => document.querySelector(`#images-card .filter-btn[data-filter-val="${val}"]`).click();

  expect(items()).toBe(100);
  expect(note()).toBe("First 100 of 150 images. Copy as table lists all 150.");
  // The note is the last item, after the images.
  expect(list.lastElementChild.textContent.trim()).toBe(note());

  // 30 without alt: all of them show, so no note.
  filter("no-alt");
  expect(items()).toBe(30);
  expect(note()).toBe("");

  // Back to all: the note is back.
  filter("all");
  expect(items()).toBe(100);
  expect(note()).toBe("First 100 of 150 images. Copy as table lists all 150.");
});
