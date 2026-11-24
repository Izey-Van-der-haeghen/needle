// @vitest-environment jsdom
// "Check again" under the lazy-image note reads the images again and keeps every other result:
// the link check, the file sizes measured earlier, and keyboard focus. An answer that arrives after
// a Refresh belongs to the old audit and is dropped.
import { it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPopup } from "./helpers/popup-harness.js";
import { fmtKB } from "../lib/popup-helpers.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FX = JSON.parse(readFileSync(path.join(ROOT, "dev/preview/fixtures/riverside.json"), "utf8"));
const SITE = "https://www.riverside-bikes.example";
const SRC = `${SITE}/img/ride-out.jpg`;
const BYTES = 51200;

// A content image below the fold that hasn't loaded yet, and the same image once it has.
const lazy = { domIndex: 9, src: SRC, alt: "A group ride", altMissing: false, lazy: true, loaded: false, missingDims: false,
  naturalWidth: 0, naturalHeight: 0, displayedWidth: 0, displayedHeight: 0, format: "jpg", bytes: 0, context: "main",
  isBackground: false, brokenLoad: false, aboveFold: false, lazyAboveFold: false };
const loaded = { ...lazy, loaded: true, naturalWidth: 1200, naturalHeight: 800, displayedWidth: 600, displayedHeight: 400 };
const page = (img) => ({ ...FX.onpage, images: [...FX.onpage.images, img] });

// What the tab answers to ANALYZE_ONPAGE; each test sets it.
let answer = () => page(lazy);
let harness;
const $ = (id) => document.getElementById(id);
const imageItem = () => [...document.querySelectorAll("#image-list .image-item")].find((li) => li.querySelector(".item-title")?.title === SRC);
const typesSince = (n) => harness.tabMessages.slice(n).map((m) => m.msg.type);
/** Let a promise chain that is already resolving run to its end (one turn of the event loop, no timing). */
const settle = () => new Promise((r) => setTimeout(r, 0));

it("keeps the link check and the measured size, takes the loaded image, and keeps focus in the card", async () => {
  harness = await loadPopup({
    allSites: true,
    tabHandlers: { ANALYZE_ONPAGE: () => answer() },
    runtime: {
      CHECK_LINKS: ({ urls }) => ({ data: urls.map((url) => (url === `${SITE}/bikes/`
        ? { url, kind: "redirect", status: 301, finalUrl: `${SITE}/shop/bikes/` } : { url, kind: "ok", status: 200 })) }),
      FETCH_IMAGE_SIZES: ({ urls }) => ({ data: Object.fromEntries(urls.filter((u) => u === SRC).map((u) => [u, BYTES])) })
    }
  });
  await vi.waitFor(() => expect($("export-audit-header").hidden).toBe(false)); // every check of the audit has answered

  // The link check first: its result must survive "Check again".
  $("check-broken").click();
  await vi.waitFor(() => expect(document.querySelectorAll("#link-list .hint").length).toBeGreaterThan(0));
  const linkStatus = $("link-check-status").innerHTML;
  const hints = document.querySelectorAll("#link-list .hint").length;

  // The lazy image's file size is measured on request.
  expect(imageItem().textContent).not.toContain(fmtKB(BYTES));
  $("measure-images").click();
  await vi.waitFor(() => expect(imageItem().textContent).toContain(fmtKB(BYTES)));
  expect(imageItem().textContent).not.toContain("1200×800"); // not loaded: no dimensions yet

  // The image has loaded on the page meanwhile. "Check again" by keyboard.
  answer = () => page(loaded);
  const sent = harness.tabMessages.length;
  $("recheck-images").focus();
  $("recheck-images").click();
  await vi.waitFor(() => expect($("recheck-images")).toBeNull()); // no lazy image left, so no note and no button

  expect(typesSince(sent)).toEqual(["ANALYZE_ONPAGE"]); // only the page's images were read again
  expect(document.querySelector("#panel-onpage > .loading")).toBeNull(); // no "Reading the page…"
  expect($("link-check-status").innerHTML).toBe(linkStatus);
  expect(document.querySelectorAll("#link-list .hint")).toHaveLength(hints);
  expect(imageItem().textContent).toContain("1200×800");
  expect(imageItem().textContent).toContain(fmtKB(BYTES));
  // The pressed button is gone: focus goes to the card it was in, not to the page.
  expect(document.activeElement).toBe($("images-card").querySelector("summary"));
});

it("drops an answer that arrives after a Refresh started a new audit", async () => {
  // A fresh audit with the image not loaded yet: the note and its button are back.
  answer = () => page(lazy);
  $("panel-onpage").querySelector("[data-refresh='onpage']").click();
  await vi.waitFor(() => expect($("export-audit-header").hidden).toBe(false));
  expect($("recheck-images")).not.toBeNull();

  // "Check again" waits for the tab; meanwhile the reader presses Refresh.
  let release;
  answer = () => new Promise((resolve) => { release = () => resolve(page(loaded)); });
  $("recheck-images").click();
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  answer = () => page(lazy);
  $("panel-onpage").querySelector("[data-refresh='onpage']").click();
  await vi.waitFor(() => expect($("export-audit-header").hidden).toBe(false));

  // The old answer arrives now: the new audit's images stay as they are.
  release();
  await settle();
  expect($("recheck-images")).not.toBeNull();
  expect(imageItem().textContent).not.toContain("1200×800");
});
