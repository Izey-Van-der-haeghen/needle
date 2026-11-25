// @vitest-environment jsdom
// The real popup: at most one coral button in what a reader sees on a tab, with the welcome note
// dismissed and no update note (the harness starts that way). The run button is the tab's main action.
// The paid keyword lookup and every "Allow …" button inside a tab are secondary: a coral Allow next to
// a run button competes with it, and On-page can ask for access three times at once (links, image
// sizes, hreflang).
import { it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPopup } from "./helpers/popup-harness.js";
import { NEEDS_PERMISSION } from "../lib/permissions.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FX = JSON.parse(readFileSync(path.join(ROOT, "dev/preview/fixtures/riverside.json"), "utf8"));
const $ = (id) => document.getElementById(id);
/** The coral buttons a reader sees anywhere in the view: not hidden, and not in a closed card. */
const coral = () => [...document.querySelectorAll(".primary-btn")]
  .filter((b) => !b.closest("[hidden]") && !(b.closest("details:not([open])") && !b.closest("summary")))
  .map((b) => b.textContent.trim());
const show = (name) => { $(`tab-${name}`).click(); expect($(`panel-${name}`).hidden).toBe(false); };
let storage;

beforeAll(async () => {
  ({ storage } = await loadPopup({
    // One content image whose file size the browser didn't report, so "Measure them" shows.
    onpage: { images: [...FX.onpage.images, { ...FX.onpage.images[2], domIndex: 3, src: "https://www.riverside-bikes.example/img/team.jpg", bytes: 0 }] },
    runtime: {
      RUN_DFS: () => ({ error: NEEDS_PERMISSION }),
      RUN_BING: () => ({ error: NEEDS_PERMISSION }),
      FETCH_SERP: () => ({ error: NEEDS_PERMISSION })
    }
  }));
});

it("On-page: the link, image-size and hreflang notices add no coral button", async () => {
  show("onpage");
  // A reader opens each card to press its button.
  $("panel-onpage").querySelectorAll("details.card").forEach((d) => { d.open = true; });
  $("check-broken").click();
  $("measure-images").click();
  $("hreflang-check").click();
  await vi.waitFor(() => {
    expect($("link-check-status").querySelector("[data-grant='all-sites']")).not.toBeNull();
    expect(document.querySelector("[data-retry='measure-images']")).not.toBeNull();
    expect($("hreflang-cluster").querySelector("[data-grant='all-sites']")).not.toBeNull();
  });
  expect(coral()).toEqual([]);
});

it("Speed with no keys: Run speed test is the one coral button", async () => {
  show("offpage");
  // Every card asks for its key in Settings.
  ["run-psi", "run-crux", "run-bing", "run-dfs"].forEach((id) => $(id).click());
  await vi.waitFor(() => {
    expect($("psi-result").textContent).toMatch(/Add your free Google API key/);
    expect($("crux-result").textContent).toMatch(/Add a Google API key first/);
    expect($("bing-result").textContent).toMatch(/Add your Bing Webmaster Tools API key/);
    expect($("dfs-result").textContent).toMatch(/Add your DataForSEO login first/);
  });
  expect(coral()).toEqual(["Run speed test"]);
});

it("Speed with the DataForSEO and Bing notices: Run speed test is the one coral button", async () => {
  show("offpage");
  await storage.local.set({ dfsLogin: "me@example.com", dfsPassword: "secret", bingKey: "bing-key" });
  $("run-dfs").click();
  $("run-bing").click();
  await vi.waitFor(() => {
    expect($("dfs-result").querySelector("[data-grant='dataforseo']")).not.toBeNull();
    expect($("bing-result").querySelector("[data-grant-bing]")).not.toBeNull();
  });
  expect(coral()).toEqual(["Run speed test"]);
});

it("Compare with the site-access notice: Compare is the one coral button", async () => {
  show("compare");
  document.querySelector(".competitor-url[data-idx='0']").value = "https://competitor.example/page";
  $("run-compare").click();
  await vi.waitFor(() => expect($("compare-result").querySelector("[data-grant='all-sites']")).not.toBeNull());
  expect(coral()).toEqual(["Compare"]);
});

it("SERP with the DataForSEO notice: Search Google is the one coral button", async () => {
  show("serp");
  $("serp-keyword").value = "bike repairs";
  $("run-serp").click();
  await vi.waitFor(() => expect($("serp-result").querySelector("[data-grant='dataforseo']")).not.toBeNull());
  expect(coral()).toEqual(["Search Google"]);
});
