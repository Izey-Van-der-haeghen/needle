// @vitest-environment jsdom
// Result areas are not live regions (a whole result read out is too much): each result says one
// short sentence in #sr-status instead, and it must be the headline the screen shows. Removing an
// announce() call, or announcing other words than the screen, fails this test.
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

it("announces each result's headline, as the screen shows it", async () => {
  const { chrome } = await loadPopup({
    scripting: async ({ func, args, files }) => [{ result: files ? undefined : func?.name === "pageFetchAll" ? pageFetchAll(args?.[0]) : undefined }]
  });
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
