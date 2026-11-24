// @vitest-environment jsdom
// Scrollable code blocks are named regions, so keyboard and screen-reader users can find them. Two
// regions with the same name can't be told apart (IBM Equal Access, aria_region_label_unique): the
// demo page has three JSON-LD blocks, which were all called "JSON-LD".
import { it, expect, vi } from "vitest";
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

it("gives every named region in the popup its own name", async () => {
  await loadPopup({ scripting: async ({ func, args, files }) => [{ result: files ? undefined : func?.name === "pageFetchAll" ? pageFetchAll(args?.[0]) : undefined }] });
  await vi.waitFor(() => expect(document.querySelector("#schema-card")).not.toBeNull(), { timeout: 3000 });
  document.getElementById("tab-technical").click();
  await vi.waitFor(() => expect(document.querySelector('#panel-technical [role="region"]')).not.toBeNull(), { timeout: 3000 });

  const names = [...document.querySelectorAll('[role="region"]')].map((el) => el.getAttribute("aria-label") || "");
  expect(names.filter((n) => n.startsWith("JSON-LD")).length).toBeGreaterThan(1);
  expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
});
