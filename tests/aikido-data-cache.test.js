// Aikido round of 25 November 2026, finding 14: the entry just written always stayed, however
// large. A page with megabytes of JSON-LD then pushed every other result out of the cache, paid
// DataForSEO results too. Now a result larger than the whole budget is not cached at all.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setCache, getCache, storedBytes } from "../lib/cache.js";
import { CACHE_MAX_BYTES } from "../lib/constants.js";

let store;
beforeEach(() => {
  store = {};
  vi.stubGlobal("chrome", { storage: { local: {
    get: vi.fn(async (k) => ({ [k]: store[k] })),
    set: vi.fn(async (o) => { Object.assign(store, JSON.parse(JSON.stringify(o))); })
  } } });
});
afterEach(() => vi.unstubAllGlobals());

const PAID = "dfs::https://e.com/";
const PAGE = "onpage::https://evil.example/";

describe("a result larger than the cache budget", () => {
  it("is not cached, and the paid result stays", async () => {
    await setCache(PAID, { backlinks: 1234 });
    await setCache(PAGE, { schema: [{ raw: { text: "x".repeat(CACHE_MAX_BYTES) } }] });
    expect(Object.keys(store._cache)).toEqual([PAID]);
    expect((await getCache(PAID)).data).toEqual({ backlinks: 1234 });
    expect(await getCache(PAGE)).toBeNull();
  });

  it("is measured as Chrome counts it: a \"<\" takes six bytes", async () => {
    await setCache(PAID, { backlinks: 1234 });
    // 1 MB of "<" is 1 MB to JSON.stringify, and 6 MB to Chrome's quota.
    await setCache(PAGE, { html: "<".repeat(1024 * 1024) });
    expect(Object.keys(store._cache)).toEqual([PAID]);
  });

  it("drops an older result for the same key, so a reopen doesn't show it as the latest", async () => {
    await setCache(PAID, { backlinks: 1234 });
    await setCache(PAGE, { title: "small" });
    await setCache(PAGE, { title: "x".repeat(CACHE_MAX_BYTES) });
    expect(Object.keys(store._cache)).toEqual([PAID]);
  });

  it("writes nothing when there is nothing to drop", async () => {
    await setCache(PAGE, { title: "x".repeat(CACHE_MAX_BYTES) });
    expect(globalThis.chrome.storage.local.set).not.toHaveBeenCalled();
  });
});

describe("a result that fits", () => {
  it("is cached beside the others", async () => {
    await setCache(PAID, { backlinks: 1234 });
    await setCache(PAGE, { title: "x".repeat(1000) });
    expect(Object.keys(store._cache).sort()).toEqual([PAID, PAGE].sort());
  });
});

describe("storedBytes", () => {
  it("counts like Chrome: the key and the JSON in UTF-8, with \"<\", U+2028 and U+2029 as \\uXXXX", () => {
    expect(storedBytes("k", "a")).toBe(4); // k"a"
    expect(storedBytes("k", "é")).toBe(5); // two bytes in UTF-8
    expect(storedBytes("k", "<")).toBe(9); // k"\u003C"
    expect(storedBytes("k", "\u2028")).toBe(9); // k"\u2028"
    expect(storedBytes("k", "\u{1F6B2}")).toBe(7); // four bytes in UTF-8
  });
});
