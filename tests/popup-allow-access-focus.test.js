// @vitest-environment jsdom
// The real popup without access to websites: a check that needs it shows a notice with an Allow
// button in its place. Keyboard focus follows: onto that button, and once Chrome allows access, onto
// the button whose check now runs. The pressed button is gone each time, so focus must not drop to
// the page.
import { it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPopup } from "./helpers/popup-harness.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FX = JSON.parse(readFileSync(path.join(ROOT, "dev/preview/fixtures/riverside.json"), "utf8"));
const $ = (id) => document.getElementById(id);
const checks = [];
let granted = false;

beforeAll(async () => {
  await loadPopup({
    // One content image whose file size the browser didn't report.
    onpage: { images: [...FX.onpage.images, { ...FX.onpage.images[2], domIndex: 3, src: "https://www.riverside-bikes.example/img/team.jpg", bytes: 0 }] },
    runtime: { CHECK_LINKS: ({ urls }) => { checks.push(urls); return { data: urls.map((url) => ({ url, kind: "ok", status: 200 })) }; } }
  });
  // Chrome's answer: no access until the reader allows it.
  chrome.permissions.contains = async () => granted;
  chrome.permissions.request = async () => { granted = true; return true; };
});

it("Measure them without access: focus moves to the Allow button that took its place", async () => {
  $("measure-images").focus();
  $("measure-images").click();
  await vi.waitFor(() => expect(document.querySelector('[data-retry="measure-images"]')).not.toBeNull());
  expect($("measure-images")).toBeNull();
  expect(document.activeElement).toBe(document.querySelector('[data-retry="measure-images"]'));
});

it("Allow access: focus moves to the check it runs, and the check runs", async () => {
  $("check-broken").focus();
  $("check-broken").click();
  const allow = await vi.waitFor(() => {
    const b = $("link-check-status").querySelector('[data-grant="all-sites"]');
    if (!b) throw new Error("no Allow button");
    return b;
  });
  expect(checks).toHaveLength(0);

  allow.focus();
  allow.click();
  await vi.waitFor(() => expect(checks).toHaveLength(1));
  expect(allow.isConnected).toBe(false);
  expect(document.activeElement).toBe($("check-broken"));
  await vi.waitFor(() => expect($("check-broken").getAttribute("aria-disabled")).toBe("false"));
  expect(document.activeElement).toBe($("check-broken"));
});
