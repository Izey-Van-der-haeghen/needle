// @vitest-environment jsdom
// The final check before 1.0.3: the Bing permission notice is announced (it was a live region in
// 1.0.2), and Fix this first's buttons are named after their finding, so a screen reader's list of
// buttons (names only) tells them apart.
import { it, expect, vi } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

const said = () => document.getElementById("sr-status").textContent;

it("names Fix this first's crosshairs and 'Why and how' after their finding", async () => {
  await loadPopup();
  await vi.waitFor(() => expect(document.querySelectorAll("[id^='loc-']").length).toBeGreaterThan(1), { timeout: 3000 });
  const names = [...document.querySelectorAll("[id^='loc-']")].map((b) => b.getAttribute("aria-label"));
  for (const n of names) expect(n).toMatch(/^Show on the page: \S/);
  expect(new Set(names).size).toBe(names.length);
  const whys = [...document.querySelectorAll("summary[id^='why-']")].map((s) => s.textContent);
  for (const w of whys) expect(w).toMatch(/^Why and how · [^:]+: \S/);
  expect(new Set(whys).size).toBe(whys.length);
});

it("announces the 'Allow Needle to contact Bing Webmaster Tools' notice", async () => {
  // A second popup in this file would need a fresh module: the same popup, now asked for Bing data.
  await chrome.storage.local.set({ bingKey: "test-key" });
  chrome.runtime.sendMessage = async (m) => (m?.type === "RUN_BING" ? { error: "needs-permission" } : { error: `test: ${m?.type}` });
  document.getElementById("tab-offpage").click();
  document.getElementById("run-bing").click();
  await vi.waitFor(() => expect(document.querySelector("#bing-result .notice strong")?.textContent).toBe("Allow Needle to contact Bing Webmaster Tools"), { timeout: 3000 });
  await vi.waitFor(() => expect(said()).toBe("Allow Needle to contact Bing Webmaster Tools"));
});
