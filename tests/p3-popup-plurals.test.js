// @vitest-environment jsdom
// Full check of 25 November 2026, P3-11 (popup part): every count in the popup goes through
// plural(), so 1 reads "1 result" and 1200 reads "1,200 …". The real popup shows each case.
import { it, expect, vi, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPopup } from "./helpers/popup-harness.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FX = JSON.parse(readFileSync(path.join(ROOT, "dev/preview/fixtures/riverside.json"), "utf8"));
const SRC = readFileSync(path.join(ROOT, "popup.js"), "utf8");

// The server check reads the demo page, its robots.txt and its sitemap through the page.
const pageFetchAll = (requests) => (requests || []).map((r) => {
  const p = FX.pages[r.url];
  if (!p) return { ok: false, status: 404, url: r.url, redirected: false, headers: { "content-type": "text/html" }, text: "", truncated: false, ms: 20 };
  return { ok: p.status < 400, status: p.status, url: r.url, redirected: false, headers: p.headers, text: p.text, truncated: false, ms: 40 };
});

const runtime = {
  FETCH_SERP: () => ({ data: { keyword: "bike repair", locationCode: 2840, languageCode: "en", device: "desktop", features: {}, aiOverview: null,
    organic: [{ position: 1, domain: "rival.example", url: "https://rival.example/", title: "Rival bikes", snippet: "Repairs.", rating: { value: 4.5, count: 1 } }] }, age: 0 }),
  RUN_BING: () => ({ data: { site: "https://www.riverside-bikes.example/", crawl: null, clicks: 1, impressions: 1, queries: [] }, age: 0 })
};
const click = (id) => document.getElementById(id).click();
const text = (id) => document.getElementById(id).textContent.replace(/\s+/g, " ").trim();

beforeAll(async () => {
  vi.stubGlobal("fetch", async (url) => ({
    status: 200, ok: true, url, headers: new Headers({ "content-type": "text/html" }),
    text: async () => `<html><head><link rel="canonical" href="${url}"><link rel="alternate" hreflang="en-GB" href="${FX.url}"></head></html>`
  }));
  await loadPopup({
    allSites: true,
    runtime,
    local: { dfsLogin: "me@example.com", dfsPassword: "secret", bingKey: "key" },
    // One word in the main content; 1,200 files over http.
    onpage: { mainContentWordCount: 1, mixedContent: Array.from({ length: 1200 }, (_, i) => ({ url: `http://cdn.example/${i}.js` })) },
    // Sixty sentences of one word and two numbers: a sentence needs three tokens, and numbers are
    // not words, so the average sentence is 1 word.
    tabHandlers: { GET_MAIN_TEXT: () => ({ text: "Ride 1 2. ".repeat(60).trim(), lang: "en" }) },
    scripting: async ({ func, args, files }) => [{ result: files ? undefined : func?.name === "pageFetchAll" ? pageFetchAll(args?.[0]) : undefined }]
  });
});
afterAll(() => vi.unstubAllGlobals());

it("has no hand-made plurals left in popup.js", () => {
  expect(SRC).not.toMatch(/=== 1 \? '' : 's'/);
  expect(SRC).not.toMatch(/=== 1 \? one : many/);
  expect(SRC).not.toMatch(/Top \$\{d\.organic\.length\} results/);
  expect(SRC).not.toMatch(/\} words<\/span>/);
});

it("the content card says 1 word, and the average sentence 1 word", async () => {
  const summary = document.querySelector("#content-card summary .muted");
  expect(summary.textContent).toBe("1 word");
  document.getElementById("kw-input").value = "ride";
  click("kw-check");
  await vi.waitFor(() => expect(document.getElementById("text-analysis").textContent).toMatch(/Average sentence/));
  expect(text("text-analysis")).toMatch(/Average sentence\s*1 word(?!s)/);
});

it("Search Google says Top 1 result and 1 review", async () => {
  click("tab-serp");
  document.getElementById("serp-keyword").value = "bike repair";
  click("run-serp");
  await vi.waitFor(() => expect(document.querySelector("#serp-result .serp-list")).not.toBeNull());
  const heads = [...document.querySelectorAll("#serp-result h2")].map((h) => h.textContent.trim());
  expect(heads).toContain("Top 1 result");
  expect(text("serp-result")).toMatch(/Rating 4\.5 \(1 review\)/);
});

it("Bing says 1 click and 1 impression", async () => {
  click("run-bing");
  await vi.waitFor(() => expect(text("bing-result")).toMatch(/Clicks and impressions/));
  expect(text("bing-result")).toMatch(/1 click · 1 impression \(/);
});

it("the hreflang check of one alternate says the alternate links back", async () => {
  click("tab-onpage");
  click("hreflang-check");
  await vi.waitFor(() => expect(document.querySelector("#hreflang-cluster table")).not.toBeNull());
  expect(document.querySelector("#hreflang-cluster p .tag").textContent).toMatch(/The alternate links back$/);
  // announce() writes 30 ms later.
  await vi.waitFor(() => expect(document.getElementById("sr-status").textContent).toBe("The alternate links back"));
});

it("mixed content counts with a thousands separator", async () => {
  click("tab-technical");
  await vi.waitFor(() => expect(document.getElementById("panel-technical").textContent).toMatch(/Mixed content/), { timeout: 3000 });
  expect(text("panel-technical")).toMatch(/1,200 http: files/);
});
