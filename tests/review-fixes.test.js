import { describe, it, expect, vi, beforeEach } from "vitest";
import { pruneCache, setCache } from "../lib/cache.js";
import { detectMarketFromUrl } from "../lib/popup-compute.js";
import { collectFindings } from "../lib/findings.js";
import { sheetCell, tsv } from "../lib/popup-helpers.js";
import { withStoreLock } from "../lib/store-lock.js";
import { fetchCompetitor } from "../lib/compare.js";

describe("cache size", () => {
  const now = Date.now();
  it("keeps the newest entries within the byte budget, and always the entry just written", () => {
    const big = "x".repeat(600);
    const cache = {
      "onpage::a": { data: big, ts: now - 3 },
      "onpage::b": { data: big, ts: now - 2 },
      "onpage::c": { data: big, ts: now - 1 }
    };
    expect(Object.keys(pruneCache(cache, 1400))).toEqual(["onpage::c", "onpage::b"]);
    expect(Object.keys(pruneCache(cache, 10))).toEqual(["onpage::c"]);
    const withPaid = { ...cache, "serp::big": { data: "x".repeat(2000), ts: now - 5 } };
    expect(Object.keys(pruneCache(withPaid, 10, "onpage::c"))).toEqual(["onpage::c"]);
  });

  it("drops expired entries", () => {
    const cache = { "onpage::old": { data: 1, ts: now - 60 * 60 * 1000 }, "crux::new": { data: 1, ts: now } };
    expect(Object.keys(pruneCache(cache))).toEqual(["crux::new"]);
  });
});

describe("shared storage lock", () => {
  it("runs the work under a lock shared by every Needle page when Web Locks exist", async () => {
    const request = vi.fn((name, fn) => fn());
    vi.stubGlobal("navigator", { locks: { request } });
    try {
      expect(await withStoreLock("cache", async () => 42)).toBe(42);
      expect(request).toHaveBeenCalledWith("needle:cache", expect.any(Function));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("setCache writes under the cache lock", async () => {
    const store = {};
    globalThis.chrome = { storage: { local: {
      get: vi.fn(async (k) => ({ [k]: store[k] })),
      set: vi.fn(async (o) => Object.assign(store, o))
    } } };
    const request = vi.fn((name, fn) => fn());
    vi.stubGlobal("navigator", { locks: { request } });
    try {
      await setCache("onpage::https://e.com/", { title: "x" });
      expect(request).toHaveBeenCalledWith("needle:cache", expect.any(Function));
      expect(store._cache["onpage::https://e.com/"].data).toEqual({ title: "x" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("market from the page language on generic domains", () => {
  it("uses an explicit region in <html lang> on .com", () => {
    expect(detectMarketFromUrl("https://www.example.com/", "en-GB")).toEqual({ code: 2826, lang: "en" });
    expect(detectMarketFromUrl("https://shop.example.com/", "fr-BE")).toEqual({ code: 2056, lang: "fr" });
  });

  it("does not guess a country from a bare language", () => {
    expect(detectMarketFromUrl("https://www.example.com/", "de")).toBeNull();
  });

  it("the domain still wins over the page language", () => {
    expect(detectMarketFromUrl("https://www.example.nl/", "en-GB")).toEqual({ code: 2528, lang: "nl" });
  });
});

describe("robots.txt that can't be read", () => {
  const onpage = { url: "https://e.com/", title: "T", description: "", headings: [], links: { details: [] }, images: [], schema: [] };
  const ids = (tech) => collectFindings({ onpage, tech }).map((f) => f.id);

  it("a server error is a high-severity indexing problem", () => {
    const tech = { status: 200, robotsTxt: { ok: false, status: 503, pathAllowed: null } };
    expect(ids(tech)).toContain("robots-unreachable");
  });

  it("a failed request (often a redirect to another domain) is only a low note", () => {
    const tech = { status: 200, robotsTxt: { ok: false, status: 0, error: "Failed to fetch", pathAllowed: null } };
    const list = collectFindings({ onpage, tech });
    expect(list.map((f) => f.id)).not.toContain("robots-unreachable");
    expect(list.find((f) => f.id === "robots-unchecked")?.severity).toBe("low");
  });
});

describe("copied tables", () => {
  it("neutralises page text that would run as a spreadsheet formula", () => {
    expect(sheetCell("=HYPERLINK(\"https://evil.example\")")).toBe("'=HYPERLINK(\"https://evil.example\")");
    expect(sheetCell("+1")).toBe("'+1");
    expect(sheetCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(sheetCell("Bike repair")).toBe("Bike repair");
    expect(tsv(["a", "b"], [["x\ty", "-2"]])).toBe("a\tb\nx y\t'-2");
  });
});

describe("competitor pages", () => {
  beforeEach(() => vi.unstubAllGlobals());
  it("does not read a page that redirects to a local-network address", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, url: "http://192.168.1.1/", headers: new Headers({ "content-type": "text/html" }), body: { cancel: async () => {} } })));
    await expect(fetchCompetitor("https://rival.example/")).rejects.toThrow(/local or private-network/);
    vi.unstubAllGlobals();
  });
});
