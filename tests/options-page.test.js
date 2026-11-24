// @vitest-environment jsdom
// The real Settings page (options.html + options.js): the test buttons, the changelog link and
// Clear history, through clicks and the stubbed chrome.storage instead of the source text.
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { loadOptions } from "./helpers/options-harness.js";
import { CHANGELOG_URL } from "../lib/whats-new.js";

const $ = (id) => document.getElementById(id);
let storage;

beforeAll(async () => {
  ({ storage } = await loadOptions({
    local: {
      dfsLogin: "me@example.com", dfsPassword: "secret", psiKey: "AIza-test",
      history: [{ id: "https://site.example/", title: "Home" }],
      snapshots: { "https://site.example/": { ts: 1 } },
      popupState: { activeTab: "ai", onboardingDismissed: true, marketByHost: { "site.example": { locationCode: 2056, languageCode: "nl" } }, serpMarketByHost: { "site.example": { locationCode: 2056, languageCode: "fr" } } }
    }
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A request that never answers; it ends only when its deadline aborts it. */
const hangingFetch = () => vi.fn((_url, { signal } = {}) => new Promise((_, reject) => {
  signal?.addEventListener("abort", () => reject(signal.reason));
}));

describe("the Settings page", () => {
  it("links 'What's new' to the changelog", () => {
    expect($("changelog-link").href).toBe(CHANGELOG_URL);
  });

  it("Test connection runs once at a time and gives up on a request that hangs after 30 seconds, not sooner", async () => {
    const fetch = hangingFetch();
    vi.stubGlobal("fetch", fetch);
    vi.useFakeTimers();
    const btn = $("test-dfs");
    btn.click();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls[0][0]).toMatch(/^https:\/\/api\.dataforseo\.com\//);
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect($("dfs-status").textContent).toBe("Testing…");

    btn.click(); // a second click while it runs does nothing
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect($("dfs-status").textContent).toBe("Testing…");
    expect(btn.getAttribute("aria-disabled")).toBe("true");

    await vi.advanceTimersByTimeAsync(10_000);
    expect($("dfs-status").textContent).toBe("It took too long. Try again.");
    expect(btn.hasAttribute("aria-disabled")).toBe(false);
  });

  it("Test key waits longer, as PageSpeed takes about 20 seconds: still waiting after a minute, given up after 90 seconds", async () => {
    const fetch = hangingFetch();
    vi.stubGlobal("fetch", fetch);
    vi.useFakeTimers();
    const btn = $("test-psi");
    btn.click();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls[0][0]).toMatch(/^https:\/\/www\.googleapis\.com\/pagespeedonline\//);
    btn.click();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect($("psi-status").textContent).toMatch(/^Testing/);

    await vi.advanceTimersByTimeAsync(30_000);
    expect($("psi-status").textContent).toBe("It took too long. Try again.");
    expect(btn.hasAttribute("aria-disabled")).toBe(false);
  });

  it("Clear history also forgets the country and language picked per website, and keeps the rest of the popup's state", async () => {
    const btn = $("clear-history");
    btn.click(); // arms: "Confirm"
    btn.click();
    await vi.waitFor(() => expect($("maint-status").textContent).toMatch(/cleared/));
    const { history, snapshots, popupState } = await storage.local.get(["history", "snapshots", "popupState"]);
    expect(history).toEqual([]);
    expect(snapshots).toEqual({});
    expect(popupState).toEqual({ activeTab: "ai", onboardingDismissed: true });
  });
});
