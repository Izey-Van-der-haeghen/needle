// @vitest-environment jsdom
// Result areas are not live regions (a whole result read out is too much): each result says one
// short sentence in #sr-status instead, and it must be the headline the screen shows. Removing an
// announce() call, or announcing other words than the screen, fails this test.
import { it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPopup } from "./helpers/popup-harness.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FX = JSON.parse(readFileSync(path.join(ROOT, "dev/preview/fixtures/riverside.json"), "utf8"));
const pageFetchAll = (requests) => (requests || []).map((r) => {
  const p = FX.pages[r.url];
  if (!p) return { ok: false, status: 404, url: r.url, redirected: false, headers: { "content-type": "text/html" }, text: "", truncated: false, ms: 20 };
  return { ok: p.status < 400, status: p.status, url: r.url, redirected: false, headers: p.headers, text: p.text, truncated: false, ms: 40 };
});

const said = () => document.getElementById("sr-status").textContent;
/** The headline as a screen reader reads it: the tag's words without its aria-hidden symbol. */
const shown = (box) => {
  const el = box.querySelector("p .tag, .notice strong");
  if (!el) return "";
  const copy = el.cloneNode(true);
  copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return copy.textContent.trim();
};
const click = (id) => document.getElementById(id).click();

// One popup for the whole file (popup.js runs once); each test may answer the worker's messages.
const runtime = {};
let chrome;
beforeAll(async () => {
  ({ chrome } = await loadPopup({
    runtime,
    scripting: async ({ func, args, files }) => [{ result: files ? undefined : func?.name === "pageFetchAll" ? pageFetchAll(args?.[0]) : undefined }]
  }));
  // The audit's own announcement comes 30 ms after the page shows: let it pass before a test listens.
  await vi.waitFor(() => expect(said()).toBe("Page analysed"));
});

it("announces each result's headline, as the screen shows it", async () => {
  click("tab-technical");
  await vi.waitFor(() => expect(document.getElementById("variants-check")).not.toBeNull(), { timeout: 3000 });
  const variants = () => document.getElementById("variants-result");

  // Without access to websites: the permission notice says its title.
  chrome.permissions.contains = async () => false;
  click("variants-check");
  await vi.waitFor(() => expect(said()).toBe("Needle needs your permission for this"));
  expect(shown(variants())).toBe(said());

  // With access, one version failing: the screen and the screen reader say the same.
  chrome.permissions.contains = async () => true;
  globalThis.fetch = window.fetch = async (url) => {
    if (String(url).startsWith("http://riverside")) throw new TypeError("Failed to fetch");
    return { status: 200, url: "https://www.riverside-bikes.example/", body: { cancel: async () => {} } };
  };
  click("variants-check");
  await vi.waitFor(() => expect(said()).toMatch(/could not be checked/));
  expect(shown(variants())).toBe(said());

  // The sitemap check says whether the page is listed.
  click("sitemap-check");
  await vi.waitFor(() => expect(said()).toMatch(/sitemap/));
  expect(said()).toBe("This page is listed in the sitemap");
  expect(document.getElementById("sitemap-result").textContent).toMatch(/listed/);

  // Search Google without a DataForSEO login says what to add.
  click("tab-serp");
  document.getElementById("serp-keyword").value = "bike repair";
  click("run-serp");
  await vi.waitFor(() => expect(said()).toBe("Add your DataForSEO login first"));
  expect(shown(document.getElementById("serp-result"))).toBe(said());
});

it("says what happened to the versions, and claims nothing when no version answered with a page", async () => {
  chrome.permissions.contains = async () => true;
  click("tab-technical");
  await vi.waitFor(() => expect(document.getElementById("variants-check")).not.toBeNull(), { timeout: 3000 });
  const box = document.getElementById("variants-result");
  const answer = (status, url) => ({ status, url, body: { cancel: async () => {} } });
  const HOME = "https://www.riverside-bikes.example/";
  /** Run the check with these answers; return the headline, as shown and as said. */
  const run = async (fetchImpl) => {
    globalThis.fetch = window.fetch = fetchImpl;
    box.innerHTML = "";
    document.getElementById("sr-status").textContent = "";
    click("variants-check");
    await vi.waitFor(() => expect(box.querySelector("table")).not.toBeNull(), { timeout: 3000 });
    await vi.waitFor(() => expect(said()).not.toBe(""));
    expect(shown(box)).toBe(said());
    return said();
  };
  const hint = () => box.querySelector(".hint")?.textContent || "";
  const headlineKind = () => box.querySelector("p .tag").classList;

  // Offline: every request fails. Not "different URLs", and no redirect advice.
  const offline = await run(async () => { throw new TypeError("Failed to fetch"); });
  expect(offline).toBe("Needle could not check the versions: none of them answered");
  expect(offline).not.toMatch(/different URLs|0 versions/);
  expect(headlineKind().contains("neutral")).toBe(true);
  expect(hint()).not.toMatch(/Redirect/);

  // All four versions answer 403, as a site that blocks automated requests does.
  const blocked = await run(async (u) => answer(403, String(u)));
  expect(blocked).toBe("Needle could not check the versions: all answered with an error (HTTP 403)");
  expect(blocked).not.toMatch(/different URLs|0 versions/);
  expect(hint()).not.toMatch(/Redirect/);

  // No page at all: two don't answer, two answer 503.
  const mixed = await run(async (u) => { if (String(u).startsWith("http:")) throw new TypeError("Failed to fetch"); return answer(503, String(u)); });
  expect(mixed).toBe("Needle could not check the versions: 2 answered with an error (HTTP 503), 2 did not answer");
  expect(hint()).not.toMatch(/Redirect/);

  // http://www answers 404 and the others end on https://www: that version is the problem, not "0 versions".
  const one404 = await run(async (u) => (String(u) === "http://www.riverside-bikes.example/" ? answer(404, String(u)) : answer(200, HOME)));
  expect(one404).toBe(`1 version answers with an error (HTTP 404); the others end on ${HOME}`);
  expect(one404).not.toMatch(/0 versions|could not be checked/);
  expect(headlineKind().contains("bad")).toBe(true);
  expect(hint()).toMatch(/Redirect every version/);

  // Two versions answer with a page on different URLs: then they do end on different URLs.
  const split = await run(async (u) => (String(u).includes("www.") ? answer(200, HOME) : answer(200, "https://riverside-bikes.example/")));
  expect(split).toBe("Versions end on different URLs");

  // All four end on one URL.
  expect(await run(async () => answer(200, HOME))).toBe(`All versions end on ${HOME}`);
  expect(hint()).toBe("");
});

// Compare: two competitors, one of which can't be loaded, and a keyword for Google positions.
const page = (title) => `<!doctype html><html lang="en"><head><title>${title}</title><meta name="description" content="About ${title}"></head><body><h1>${title}</h1><p>Words about bikes.</p></body></html>`;
async function runCompare() {
  chrome.permissions.contains = async () => true;
  globalThis.fetch = window.fetch = async (url) => {
    if (String(url).includes("broken")) throw new TypeError("Failed to fetch");
    return { ok: true, status: 200, url: String(url), redirected: false, headers: new Headers({ "content-type": "text/html" }), text: async () => page(`Page ${url}`), body: null };
  };
  click("tab-compare");
  document.getElementById("compare-self").value = "https://me.example/page";
  const inputs = document.querySelectorAll(".competitor-url");
  inputs[0].value = "https://rival.example/a";
  inputs[1].value = "https://broken.example/b";
  document.getElementById("compare-keyword").value = "bike repairs riverside";
  const sr = document.getElementById("sr-status");
  sr.textContent = "";
  // Everything #sr-status says during the run: one sentence, not a notice and then "Comparison ready".
  const heard = [];
  const watch = new MutationObserver(() => { if (sr.textContent) heard.push(sr.textContent); });
  watch.observe(sr, { childList: true, characterData: true, subtree: true });
  click("run-compare");
  await vi.waitFor(() => expect(said()).toMatch(/^Comparison ready/), { timeout: 4000 });
  // Nothing may overwrite the sentence afterwards.
  await new Promise((r) => setTimeout(r, 150));
  watch.disconnect();
  expect(heard).toEqual([said()]);
  const result = document.getElementById("compare-result");
  const titles = [...result.querySelectorAll(".notice strong")].map((n) => n.textContent.trim());
  return { result, titles };
}

it("Compare without a DataForSEO login: a neutral notice with Open Settings, in its one announcement", async () => {
  runtime.FETCH_SERP = vi.fn(() => ({ error: "Add your DataForSEO login in Settings to search Google results." }));
  await chrome.storage.local.remove(["dfsLogin", "dfsPassword"]);
  const { result, titles } = await runCompare();

  expect(titles).toEqual(["1 page could not be loaded", "Add your DataForSEO login for Google positions"]);
  const login = [...result.querySelectorAll(".notice")].find((n) => /DataForSEO login/.test(n.textContent));
  expect(login.classList.contains("notice-bad")).toBe(false);
  expect(login.querySelector('[data-action="open-options"][data-section="h-dfs"]').textContent).toBe("Open Settings");
  // Nothing to ask DataForSEO without a login.
  expect(runtime.FETCH_SERP).not.toHaveBeenCalled();
  // The table still shows: the comparison doesn't need the login.
  expect(result.textContent).toMatch(/Title and meta/);

  expect(said()).toBe("Comparison ready. 1 page could not be loaded. Add your DataForSEO login for Google positions");
  for (const t of titles) expect(said()).toContain(t);
});

it("Compare with a login: each Google positions notice is in its one announcement", async () => {
  await chrome.storage.local.set({ dfsLogin: "me@example.com", dfsPassword: "secret" });

  // DataForSEO answers with an error.
  runtime.FETCH_SERP = () => ({ error: "DataForSEO: 40200 Payment required" });
  let { titles } = await runCompare();
  expect(titles).toEqual(["1 page could not be loaded", 'No Google positions for "bike repairs riverside"']);
  expect(said()).toBe('Comparison ready. 1 page could not be loaded. No Google positions for "bike repairs riverside"');

  // Needle may not contact DataForSEO yet.
  runtime.FETCH_SERP = () => ({ error: "needs-permission", origins: ["https://api.dataforseo.com/*"] });
  ({ titles } = await runCompare());
  expect(titles).toEqual(["1 page could not be loaded", "Allow Needle to contact DataForSEO"]);
  for (const t of titles) expect(said()).toContain(t);
  expect(said()).toMatch(/^Comparison ready\. /);
});
