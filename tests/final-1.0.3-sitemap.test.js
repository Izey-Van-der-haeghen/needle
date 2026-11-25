// @vitest-environment jsdom
// The sitemap check shows the sitemap's address as people read it (région, not r%C3%A9gion).
import { it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPopup } from "./helpers/popup-harness.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FX = JSON.parse(readFileSync(path.join(ROOT, "dev/preview/fixtures/riverside.json"), "utf8"));
const SITEMAP = "https://www.riverside-bikes.example/sitemap-r%C3%A9gion.xml";
const pages = { ...FX.pages };
const robotsUrl = Object.keys(pages).find((u) => u.endsWith("robots.txt"));
const sitemapUrl = Object.keys(pages).find((u) => u.endsWith("sitemap.xml"));
pages[robotsUrl] = { ...pages[robotsUrl], text: `User-agent: *\nAllow: /\n\nSitemap: ${SITEMAP}\n` };
pages[SITEMAP] = pages[sitemapUrl];
const pageFetchAll = (requests) => (requests || []).map((r) => {
  const p = pages[r.url];
  if (!p) return { ok: false, status: 404, url: r.url, redirected: false, headers: { "content-type": "text/html" }, text: "", truncated: false, ms: 20 };
  return { ok: p.status < 400, status: p.status, url: r.url, redirected: false, headers: p.headers, text: p.text, truncated: false, ms: 40 };
});

it("shows the sitemap the page is listed in with its letters", async () => {
  await loadPopup({ scripting: async ({ func, args, files }) => [{ result: files ? undefined : func?.name === "pageFetchAll" ? pageFetchAll(args?.[0]) : undefined }] });
  document.getElementById("tab-technical").click();
  await vi.waitFor(() => expect(document.getElementById("sitemap-check")).not.toBeNull(), { timeout: 3000 });
  document.getElementById("sitemap-check").click();
  await vi.waitFor(() => expect(document.getElementById("sitemap-result").textContent).toMatch(/listed/), { timeout: 3000 });
  expect(document.getElementById("sitemap-result").textContent).toContain("https://www.riverside-bikes.example/sitemap-région.xml");
});
