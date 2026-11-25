// @vitest-environment jsdom
// A page whose every link the link check leaves alone (a one-word address, a local-network address):
// a screen reader heard "0 links checked" while the screen said why the links weren't requested. Both
// say only that, and nothing is requested.
import { it, expect, vi, afterAll } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";
import { checkLinks } from "../lib/link-checker.js";

const $ = (id) => document.getElementById(id);
const link = (index, href, text) => ({ index, href, text, internal: false, external: true, nofollow: false, ugc: false, sponsored: false, broken: false, context: "main" });

afterAll(() => vi.unstubAllGlobals());

it("says why no link was requested, on screen and to a screen reader, without '0 links checked'", async () => {
  const requested = [];
  vi.stubGlobal("fetch", async (url) => { requested.push(url); return { status: 200, ok: true, url, redirected: false, type: "basic" }; });
  const details = [link(0, "http://yourwebsite/contact", "Contact"), link(1, "http://192.168.1.1/", "Router")];
  await loadPopup({
    allSites: true,
    onpage: { links: { internal: 0, external: 2, nofollow: 0, broken: 0, total: 2, byContext: { main: 2 }, details } },
    runtime: { CHECK_LINKS: async ({ urls, pageUrl }) => ({ data: await checkLinks(urls, undefined, pageUrl) }) }
  });
  $("check-broken").click();
  const summary = "Not requested: 1 link to an address without a dot, 1 link to a local-network address";
  await vi.waitFor(() => expect($("link-check-status").textContent.replace(/\s+/g, " ").trim()).toBe(summary), { timeout: 3000 });
  await vi.waitFor(() => expect($("sr-status").textContent).toBe(summary));
  expect(requested).toEqual([]);
});
