// @vitest-environment jsdom
// The link check's words for the links it doesn't follow to the user's own network (lib/link-checker.js),
// in the real popup with the real link check:
// - a public link that redirects to a local-network address said "Link straight to the final URL:
//   http://192.168.…", advice to link to the reader's router. It says the address is local and not checked;
// - a link to a one-word address (http://yourwebsite/) is reported broken without a request, but its hint
//   said "No answer", and the summary counted it as checked. Its hint says why it wasn't requested;
// - the summary counted every link as "checked", also those never requested: a one-word address, a
//   local-network address (http://192.168.1.1/, nas.local) and a link to a website that already gave no
//   answer. "Checked" counts only the links requested; the others are counted apart, with why, and a
//   screen reader hears the same summary.
import { it, expect, vi, afterAll } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";
import { checkLinks } from "../lib/link-checker.js";

const SITE = "https://www.riverside-bikes.example";
const TO_LAN = "https://partner.example/r";
const LAN = "http://192.168.1.1/admin";
const ONE_WORD = "http://yourwebsite/contact";
const ROUTER = "http://192.168.1.1/";
const NAS = "http://nas.local/";
// A website that never answers: three links run at once there (PER_HOST), the fourth isn't requested.
const SLOW = [1, 2, 3, 4].map((n) => `https://slow.example/${n}`);
const $ = (id) => document.getElementById(id);
const itemFor = (href) => [...document.querySelectorAll("#link-list .item")].find((li) => li.querySelector(".item-body > .item-url")?.textContent === href);
const link = (index, href, text) => ({ index, href, text, internal: false, external: true, nofollow: false, ugc: false, sponsored: false, broken: false, context: "main" });

afterAll(() => vi.unstubAllGlobals());

it("says which links weren't requested and why, and counts only the requested links as checked", async () => {
  const requested = [];
  vi.stubGlobal("fetch", async (url) => {
    requested.push(url);
    // The slow website gives no answer before the check's own deadline.
    if (url.startsWith("https://slow.example/")) throw new DOMException("Timed out", "TimeoutError");
    // The partner's link redirects to the user's router; every other link works.
    return url === TO_LAN ? { status: 200, ok: true, url: LAN, redirected: true, type: "basic" } : { status: 200, ok: true, url, redirected: false, type: "basic" };
  });
  const details = [link(0, `${SITE}/bikes/`, "Bikes"), link(1, TO_LAN, "Our partner"), link(2, ONE_WORD, "Contact"), link(3, ROUTER, "Router"), link(4, NAS, "Files"),
    ...SLOW.map((u, i) => link(5 + i, u, `Slow ${i + 1}`))];
  const { tab } = await loadPopup({
    allSites: true,
    onpage: { links: { internal: 1, external: details.length - 1, nofollow: 0, broken: 0, total: details.length, byContext: { main: details.length }, details } },
    runtime: { CHECK_LINKS: async ({ urls, pageUrl }) => ({ data: await checkLinks(urls, undefined, pageUrl) }) }
  });
  expect(tab.url.startsWith(SITE)).toBe(true);
  $("check-broken").click();
  await vi.waitFor(() => expect($("link-check-status").textContent).toMatch(/checked/), { timeout: 3000 });
  // The one-word address, the router, the NAS and the fourth slow link were never requested.
  expect([...new Set(requested)].sort()).toEqual([`${SITE}/bikes/`, TO_LAN, ...SLOW.slice(0, 3)].sort());

  // Redirect to the local network: no advice to link straight there.
  const lan = itemFor(TO_LAN).querySelector(".hint");
  expect(lan.firstChild.textContent).toBe("Redirects to a local-network address, which Needle doesn't check:");
  expect(lan.querySelector(".item-url").textContent).toBe(LAN);
  expect(lan.textContent).not.toMatch(/Link straight/);

  // One-word address: why it wasn't requested, not "No answer".
  expect(itemFor(ONE_WORD).querySelector(".hint").textContent).toBe("Not requested: an address without a dot only works on the reader's own network.");
  expect(itemFor(`${SITE}/bikes/`).querySelector(".hint")).toBeNull();

  // The summary counts the five links that were requested as checked, and the other four apart, with why.
  const summary = "5 links checked: 1 works, 1 redirects, 3 timed out. Not requested: 1 link to an address without a dot, 2 links to local-network addresses, 1 link to a website that already gave no answer";
  expect($("link-check-status").textContent.replace(/\s+/g, " ").trim()).toBe(summary);
  // A screen reader hears the same, the links not requested included.
  await vi.waitFor(() => expect($("sr-status").textContent).toBe(summary));
});
