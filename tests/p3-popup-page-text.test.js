// @vitest-environment jsdom
// Full check of 25 November 2026, P3-14 (popup part) and P3-15. Page text next to Needle's own
// words sits in <bdi>, so right-to-left text keeps its punctuation on its own side: after "alt:",
// in the social cards, and in the heading examples of Fix this first. A broken image's line has
// no separator with nothing after it.
import { it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPopup } from "./helpers/popup-harness.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FX = JSON.parse(readFileSync(path.join(ROOT, "dev/preview/fixtures/riverside.json"), "utf8"));

// Hebrew, each ending in punctuation that the bidi algorithm would put on the wrong side.
const ALT = "\u05D0\u05D5\u05E4\u05E0\u05D9\u05D9\u05DD!"; // "bicycles!"
const OG_TITLE = "\u05EA\u05D9\u05E7\u05D5\u05DF \u05D0\u05D5\u05E4\u05E0\u05D9\u05D9\u05DD?"; // "bike repair?"
const OG_DESCRIPTION = "\u05EA\u05D9\u05E7\u05D5\u05DF \u05DE\u05D4\u05D9\u05E8."; // "quick repair."
const X_TITLE = "\u05E1\u05D3\u05E0\u05D4!"; // "workshop!"
const H1_A = "\u05EA\u05D9\u05E7\u05D5\u05DF?";
const H1_B = "\u05E9\u05D9\u05E8\u05D5\u05EA.";
const H4 = "\u05D7\u05DC\u05E7\u05D9\u05DD:";

const base = FX.onpage.images[1]; // the workshop photo, a content image
const images = [
  { ...base, domIndex: 0, src: "https://www.riverside-bikes.example/img/shop.jpg", alt: ALT, format: "jpg", bytes: 50000, brokenLoad: false, context: "main" },
  { ...base, domIndex: 1, src: "https://www.riverside-bikes.example/img/gone.jpg", alt: "Gone", format: "jpg", bytes: 0, naturalWidth: 0, naturalHeight: 0, brokenLoad: true, context: "main" }
];

beforeAll(async () => {
  await loadPopup({
    onpage: {
      images,
      og: { ...FX.onpage.og, title: OG_TITLE, description: OG_DESCRIPTION },
      twitter: { ...FX.onpage.twitter, title: X_TITLE },
      headings: [{ level: 1, text: H1_A, hidden: false }, { level: 1, text: H1_B, hidden: false }, { level: 2, text: "Prices", hidden: false }, { level: 4, text: H4, hidden: false }]
    }
  });
  await vi.waitFor(() => expect(document.getElementById("findings-card")).not.toBeNull());
  document.getElementById("findings-more")?.click();
});

const itemFor = (file) => [...document.querySelectorAll("#image-list .image-item")].find((li) => li.querySelector(".item-title").textContent === file);
const metas = (li) => [...li.querySelectorAll(".item-meta")];

it("puts the alt text after \"alt:\" in <bdi>", () => {
  const alt = metas(itemFor("shop.jpg")).find((m) => m.textContent.startsWith("alt: "));
  expect(alt.querySelector("bdi")?.textContent).toBe(ALT);
});

it("keeps \"alt:\" and the alt text one item of the flex row, so a long alt wraps after \"alt:\"", () => {
  // .item-meta is a flex row: each child element and each loose run of text is a flex item of its own.
  expect(readFileSync(path.join(ROOT, "popup.css"), "utf8")).toMatch(/\.item-meta\s*\{[^}]*display:\s*flex/);
  const alt = metas(itemFor("shop.jpg")).find((m) => m.textContent.startsWith("alt: "));
  const items = [...alt.childNodes].filter((n) => n.nodeType === 1 || n.textContent.trim());
  expect(items).toHaveLength(1);
  expect(items[0].textContent).toBe(`alt: ${ALT}`);
});

it("puts the social cards' titles and the description in <bdi>", () => {
  const cards = [...document.querySelectorAll(".social-card")];
  expect(cards.map((c) => c.querySelector("strong > bdi")?.textContent)).toEqual([OG_TITLE, X_TITLE]);
  expect(cards[0].querySelector(".social-body > div:last-child > bdi")?.textContent).toBe(OG_DESCRIPTION);
});

it("puts the page part of heading examples in Fix this first in <bdi>", () => {
  const examples = (id) => [...document.querySelectorAll(`details[data-fid="${id}"] ul li`)];
  expect(examples("h1-multiple").map((li) => li.querySelector("bdi")?.textContent)).toEqual([H1_A, H1_B]);
  const [skip] = examples("heading-skips");
  expect(skip.textContent).toBe(`H4 ${H4}`);
  // "H4" is Needle's label and stays outside.
  expect(skip.querySelector("bdi")?.textContent).toBe(H4);
});

it("ends a broken image's line without a separator", () => {
  const [size] = metas(itemFor("gone.jpg"));
  expect(size.textContent).toBe("size unknown");
  // A working image still shows its size after the dimensions.
  expect(metas(itemFor("shop.jpg"))[0].textContent).toMatch(/^\d+\u00D7\d+ \u00B7 /);
});
