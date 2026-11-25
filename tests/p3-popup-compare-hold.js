// For the tests/p3-popup-compare-restore-*.test.js files: the popup as it was left, with one
// competitor in the cache and "Your page" empty, so Compare's "You" is read from the tab itself.
// Every read of the tab's own HTML for Compare (5 MB at most) waits until the test lets it go.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPopup } from "./helpers/popup-harness.js";
import { parseCompetitorHtml } from "../lib/parse-competitor.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FX = JSON.parse(readFileSync(path.join(ROOT, "dev/preview/fixtures/riverside.json"), "utf8"));
const RIVAL = "https://rival.example/repairs";
const TAB_READ_BYTES = 5 * 1024 * 1024;

// The page fetches its own address through chrome.scripting (the server check and Compare's "You").
const pageFetchAll = (requests) => (requests || []).map((r) => {
  const p = FX.pages[r.url];
  if (!p) return { ok: false, status: 404, url: r.url, redirected: false, headers: { "content-type": "text/html" }, text: "", truncated: false, ms: 20 };
  return { ok: p.status < 400, status: p.status, url: r.url, redirected: false, headers: p.headers, text: p.text, truncated: false, ms: 40 };
});

/**
 * @param {Object} [opts] - more loadPopup options (allSites, tabHandlers …)
 * @returns {{tabReads: Array<() => void>, opened: Promise<Object>}} one function per held read of the
 *   tab, in order: call it to let that read answer; and loadPopup's promise
 */
export function openWithHeldTabReads(opts = {}) {
  const tabReads = [];
  const rival = parseCompetitorHtml("<!doctype html><html lang=\"en\"><head><title>Rival repairs</title></head><body><h1>Rival repairs</h1><p>Words about bikes.</p></body></html>", RIVAL);
  const opened = loadPopup({
    ...opts,
    local: {
      popupState: { onboardingDismissed: true, compare: { visibleComps: 1, competitorUrls: [RIVAL, "", ""], selfUrl: "", keyword: "" } },
      _cache: { [`compare::${RIVAL}`]: { data: rival, ts: Date.now() - 2 * 60 * 1000 } }
    },
    scripting: async ({ func, args, files }) => {
      if (files || func?.name !== "pageFetchAll") return [{ result: undefined }];
      const requests = args?.[0] || [];
      // The sitemap is read with the same limit: only the tab's own address is held.
      if (requests.length === 1 && requests[0].maxBytes === TAB_READ_BYTES && requests[0].url === FX.url) await new Promise((go) => tabReads.push(go));
      return [{ result: pageFetchAll(requests) }];
    }
  });
  return { tabReads, opened };
}

/** Time for a restore that was let go to finish (it renders well within this). */
export const settle = () => new Promise((r) => setTimeout(r, 300));
