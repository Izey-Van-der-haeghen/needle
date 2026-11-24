// @vitest-environment jsdom
// "Check again" under the lazy-image note reads the images again and keeps every other result.
import { it, expect, vi } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

it("re-reads only the images", async () => {
  await loadPopup({ onpage: { images: [
    { src: "https://www.riverside-bikes.example/img/a.jpg", alt: "a", lazy: true, loaded: false, displayedWidth: 0, displayedHeight: 0, naturalWidth: 0, naturalHeight: 0, context: "main" }
  ] } });
  const btn = await vi.waitFor(() => { const b = document.getElementById("recheck-images"); if (!b) throw new Error("no Check again"); return b; });
  const sent = [];
  const orig = chrome.tabs.sendMessage;
  chrome.tabs.sendMessage = (id, m) => { sent.push(m?.type); return orig(id, m); };
  await vi.waitFor(() => expect(document.querySelector("#panel-technical .loading")).toBeNull()); // the server check has answered
  const technicalBefore = document.getElementById("panel-technical").innerHTML;
  btn.click();
  await vi.waitFor(() => expect(sent).toContain("ANALYZE_ONPAGE"));
  await new Promise((r) => setTimeout(r, 50));
  expect(document.getElementById("panel-technical").innerHTML).toBe(technicalBefore); // no full refresh
  expect(document.querySelector("#panel-onpage > .loading")).toBeNull(); // no "Reading the page…"
});
