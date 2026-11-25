// @vitest-environment jsdom
// Full check of 25 November 2026, open item L3: with "Your page" empty, Compare compares the current
// tab. Reopened while the competitor is still in the cache, it shows that comparison again, with
// the current tab as "You", read the way "Compare" reads it.
import { it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPopup } from "./helpers/popup-harness.js";
import { parseCompetitorHtml } from "../lib/parse-competitor.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FX = JSON.parse(readFileSync(path.join(ROOT, "dev/preview/fixtures/riverside.json"), "utf8"));
const RIVAL = "https://rival.example/repairs";

// The page fetches its own address through chrome.scripting (the server check and Compare's "You").
const pageFetchAll = (requests) => (requests || []).map((r) => {
  const p = FX.pages[r.url];
  if (!p) return { ok: false, status: 404, url: r.url, redirected: false, headers: { "content-type": "text/html" }, text: "", truncated: false, ms: 20 };
  return { ok: p.status < 400, status: p.status, url: r.url, redirected: false, headers: p.headers, text: p.text, truncated: false, ms: 40 };
});

beforeAll(async () => {
  const rival = parseCompetitorHtml("<!doctype html><html lang=\"en\"><head><title>Rival repairs</title></head><body><h1>Rival repairs</h1><p>Words about bikes.</p></body></html>", RIVAL);
  await loadPopup({
    local: {
      // An earlier visit compared this tab ("Your page" empty) with one competitor, 2 minutes ago.
      popupState: { onboardingDismissed: true, compare: { visibleComps: 1, competitorUrls: [RIVAL, "", ""], selfUrl: "", keyword: "" } },
      _cache: { [`compare::${RIVAL}`]: { data: rival, ts: Date.now() - 2 * 60 * 1000 } }
    },
    scripting: async ({ func, args, files }) => [{ result: files ? undefined : func?.name === "pageFetchAll" ? pageFetchAll(args?.[0]) : undefined }]
  });
});

it("shows the comparison again, with the current tab as You", async () => {
  const result = document.getElementById("compare-result");
  await vi.waitFor(() => expect(result.querySelector(".compare-table")).not.toBeNull(), { timeout: 3000 });
  const heads = [...result.querySelector(".compare-table").querySelectorAll("thead th:not(:first-child)")].map((th) => th.textContent.trim());
  expect(heads).toEqual(["Youriverside-bikes.example", "Competitor 1rival.example"]);
  expect(result.textContent).toMatch(/Rival repairs/);
  // Only the competitor was in the cache: "You" is the tab's own HTML, fetched from the page.
  expect(result.textContent).toContain(FX.onpage.title);
});
