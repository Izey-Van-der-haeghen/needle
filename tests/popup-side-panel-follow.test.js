// @vitest-environment jsdom
// The real side panel follows the active tab: a #fragment is the same page (no new audit), and the
// next tab gets its own audit, with its own "left out while the page is noindex" announcement.
import { it, expect, vi, afterEach } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

const PAGE = "https://www.riverside-bikes.example/repairs/";
const $ = (id) => document.getElementById(id);

afterEach(() => vi.useRealTimers());

it("keeps the audit on an anchor link, and audits and announces the next noindex tab", async () => {
  const { chrome, tab, tabMessages } = await loadPopup({ panel: true, onpage: { robots: "noindex", description: "" } });
  const said = [];
  const leftOut = () => said.filter((t) => /^\d+ findings? left out while the page is noindex$/.test(t));
  new MutationObserver(() => { if ($("sr-status").textContent) said.push($("sr-status").textContent); })
    .observe($("sr-status"), { childList: true, characterData: true, subtree: true });
  // The first tab's announcement comes 1.5 s after its list.
  await vi.waitFor(() => expect(leftOut()).toHaveLength(1), { timeout: 3000 });
  const first = leftOut()[0];

  vi.useFakeTimers();
  // A scroll-spy menu or an anchor link changes only the #fragment.
  tab.url = `${PAGE}#prices`;
  chrome.tabs.onUpdated._all.forEach((f) => f(tab.id, { url: tab.url }, { ...tab }));
  await vi.advanceTimersByTimeAsync(3000);
  expect($("current-url").textContent).toBe(PAGE);
  expect($("panel-onpage").querySelector(":scope > .loading")).toBeNull();

  // Another tab with another noindex page: a new audit, and the same number left out is announced again.
  said.length = 0;
  const analysed = tabMessages.filter((m) => m.msg.type === "ANALYZE_ONPAGE").length;
  Object.assign(tab, { id: 2, url: `${PAGE}brakes/` });
  chrome.tabs.onActivated._all.forEach((f) => f({ tabId: 2, windowId: 1 }));
  await vi.advanceTimersByTimeAsync(3000);
  expect($("current-url").textContent).toBe(`${PAGE}brakes/`);
  expect(tabMessages.filter((m) => m.msg.type === "ANALYZE_ONPAGE" && m.tabId === 2)).toHaveLength(1);
  expect(tabMessages.filter((m) => m.msg.type === "ANALYZE_ONPAGE")).toHaveLength(analysed + 1);
  expect(leftOut()).toEqual([first]);
});
