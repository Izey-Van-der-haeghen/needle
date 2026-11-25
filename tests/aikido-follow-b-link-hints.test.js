// @vitest-environment jsdom
// The link check's words for the two kinds of link it doesn't follow to the user's own network
// (lib/link-checker.js), in the real popup with the real link check:
// - a public link that redirects to a local-network address said "Link straight to the final URL:
//   http://192.168.…", advice to link to the reader's router. It says the address is local and not checked;
// - a link to a one-word address (http://yourwebsite/) is reported broken without a request, but its hint
//   said "No answer", and the summary counted it as checked. Its hint says why it wasn't requested, and
//   the summary counts it apart.
import { it, expect, vi, afterAll } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";
import { checkLinks } from "../lib/link-checker.js";

const SITE = "https://www.riverside-bikes.example";
const TO_LAN = "https://partner.example/r";
const LAN = "http://192.168.1.1/admin";
const ONE_WORD = "http://yourwebsite/contact";
const $ = (id) => document.getElementById(id);
const itemFor = (href) => [...document.querySelectorAll("#link-list .item")].find((li) => li.querySelector(".item-body > .item-url")?.textContent === href);
const link = (index, href, text) => ({ index, href, text, internal: false, external: true, nofollow: false, ugc: false, sponsored: false, broken: false, context: "main" });

afterAll(() => vi.unstubAllGlobals());

it("says a redirect to the local network isn't checked, and a one-word address isn't requested or counted as checked", async () => {
  const requested = [];
  vi.stubGlobal("fetch", async (url) => {
    requested.push(url);
    // The partner's link redirects to the user's router; every other link works.
    return url === TO_LAN ? { status: 200, ok: true, url: LAN, redirected: true, type: "basic" } : { status: 200, ok: true, url, redirected: false, type: "basic" };
  });
  const { tab } = await loadPopup({
    allSites: true,
    onpage: { links: { internal: 1, external: 2, nofollow: 0, broken: 0, total: 3, byContext: { main: 3 },
      details: [link(0, `${SITE}/bikes/`, "Bikes"), link(1, TO_LAN, "Our partner"), link(2, ONE_WORD, "Contact")] } },
    runtime: { CHECK_LINKS: async ({ urls, pageUrl }) => ({ data: await checkLinks(urls, undefined, pageUrl) }) }
  });
  expect(tab.url.startsWith(SITE)).toBe(true);
  $("check-broken").click();
  await vi.waitFor(() => expect($("link-check-status").textContent).toMatch(/checked/), { timeout: 3000 });
  // The one-word address was never requested.
  expect(requested.sort()).toEqual([`${SITE}/bikes/`, TO_LAN].sort());

  // Redirect to the local network: no advice to link straight there.
  const lan = itemFor(TO_LAN).querySelector(".hint");
  expect(lan.firstChild.textContent).toBe("Redirects to a local-network address, which Needle doesn't check:");
  expect(lan.querySelector(".item-url").textContent).toBe(LAN);
  expect(lan.textContent).not.toMatch(/Link straight/);

  // One-word address: why it wasn't requested, not "No answer".
  expect(itemFor(ONE_WORD).querySelector(".hint").textContent).toBe("Not requested: an address without a dot only works on the reader's own network.");
  expect(itemFor(`${SITE}/bikes/`).querySelector(".hint")).toBeNull();

  // The summary counts the two links that were requested as checked, and the third apart.
  expect($("link-check-status").textContent.replace(/\s+/g, " ").trim()).toBe("2 links checked: 1 works, 1 redirects. 1 link not requested (address without a dot)");
  await vi.waitFor(() => expect($("sr-status").textContent).toBe("2 links checked"));
});
