// @vitest-environment jsdom
// The real popup: "Check the alternates" is busy while it runs, so a second click or Enter doesn't
// load every alternate again; it is free again once the answers are in.
import { it, expect, vi, afterEach } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

afterEach(() => vi.unstubAllGlobals());

it("loads the alternates once, however often it is pressed while it runs", async () => {
  const pending = [];
  const fetch = vi.fn((url) => new Promise((resolve) => pending.push(() => resolve({
    status: 200, ok: true, url, headers: new Headers({ "content-type": "text/html" }),
    text: async () => `<html><head><link rel="canonical" href="${url}"><link rel="alternate" hreflang="en-GB" href="https://www.riverside-bikes.example/repairs/"></head></html>`
  }))));
  vi.stubGlobal("fetch", fetch);
  await loadPopup({ allSites: true });
  const btn = () => document.getElementById("hreflang-check");

  btn().click();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(fetch.mock.calls[0][0]).toBe("https://www.riverside-bikes.example/nl/herstellingen/");
  expect(btn().getAttribute("aria-disabled")).toBe("true");
  btn().click();
  btn().click();
  await new Promise((r) => setTimeout(r, 0));
  expect(fetch).toHaveBeenCalledTimes(1);

  pending.splice(0).forEach((answer) => answer());
  await vi.waitFor(() => expect(document.querySelector("#hreflang-cluster table")).not.toBeNull());
  expect(btn().getAttribute("aria-disabled")).not.toBe("true");
  expect(fetch).toHaveBeenCalledTimes(1);
});
