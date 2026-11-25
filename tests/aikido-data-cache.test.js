// Aikido round of 25 November 2026, finding 14: the entry just written always stayed, however
// large. A page with megabytes of JSON-LD then pushed every other result out of the cache, paid
// DataForSEO results too. Now a result larger than the whole budget is not cached at all, and a free
// result gets only the room the paid results leave.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setCache, getCache, storedBytes } from "../lib/cache.js";
import { CACHE_MAX_BYTES, CACHE_MAX_ENTRIES } from "../lib/constants.js";

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

describe("a free result just under the budget", () => {
  const SERP = "serp::fietsen|be|nl|desktop";

  it("is not cached when it would push a paid result out", async () => {
    await setCache(PAID, { backlinks: 1234 });
    await setCache(SERP, { items: [1, 2, 3] });
    // 4 MB as Chrome counts it, from 0.7 MB of "<" in the page's JSON-LD.
    const n = Math.floor((CACHE_MAX_BYTES - 200) / 6);
    await setCache(PAGE, { schema: [{ raw: { t: "<".repeat(n) } }] });
    expect(Object.keys(store._cache).sort()).toEqual([PAID, SERP].sort());
    expect((await getCache(PAID)).data).toEqual({ backlinks: 1234 });
  });

  it("is not cached when paid results already fill every place", async () => {
    store._cache = {};
    for (let i = 0; i < CACHE_MAX_ENTRIES; i++) store._cache[`dfs::https://e.com/${i}`] = { data: i, ts: Date.now() };
    await setCache(PAGE, { title: "small" });
    expect(Object.keys(store._cache)).toHaveLength(CACHE_MAX_ENTRIES);
    expect(store._cache[PAGE]).toBeUndefined();
  });

  it("is cached when the paid result it would push out has expired", async () => {
    store._cache = { [PAID]: { data: "x".repeat(3 * 1024 * 1024), ts: Date.now() - 2 * 60 * 60 * 1000 } };
    await setCache(PAGE, { title: "x".repeat(2 * 1024 * 1024) });
    expect(Object.keys(store._cache)).toEqual([PAGE]);
  });

  it("doesn't limit a paid result: older free results make way for it", async () => {
    await setCache(PAGE, { title: "x".repeat(3 * 1024 * 1024) });
    await setCache(PAID, { items: "x".repeat(2 * 1024 * 1024) });
    expect(Object.keys(store._cache)).toEqual([PAID]);
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

  it("counts a number outside 32 bits as Chrome's double: with \".0\" when it has no \".\" or \"e\"", () => {
    expect(storedBytes("k", 2147483647)).toBe(11); // an int in Chrome
    expect(storedBytes("k", -2147483648)).toBe(12);
    expect(storedBytes("k", 2147483648)).toBe(13); // 2147483648.0
    expect(storedBytes("k", -2147483649)).toBe(14);
    expect(storedBytes("k", 1764000000000)).toBe(16); // Date.now(): 1764000000000.0
    expect(storedBytes("k", 1.5)).toBe(4);
    expect(storedBytes("k", 1e21)).toBe(6); // 1e+21
    // {"ts":1764000000000,"n":[3000000000,1]} is 39 bytes, and both large numbers get ".0".
    expect(storedBytes("k", { ts: 1764000000000, n: [3000000000, 1] })).toBe(1 + 39 + 4);
  });

  it("leaves digits inside strings alone, after an escaped quote too", () => {
    expect(storedBytes("k", "2147483648")).toBe(13);
    expect(storedBytes("k", 'say "2147483648"')).toBe(1 + 20); // "say \"2147483648\""
    expect(storedBytes("k", ['a"b', 2147483648])).toBe(1 + 19 + 2); // ["a\"b",2147483648]
  });
});
