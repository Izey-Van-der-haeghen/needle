import { describe, it, expect } from "vitest";
import { cacheKey, formatAge, isExpired, pageId, shareInflight, cachedCall } from "../lib/cache.js";
import { vi, beforeEach } from "vitest";

describe("cacheKey", () => {
  it("joins type and url with ::", () => {
    expect(cacheKey("onpage", "https://example.com")).toBe("onpage::https://example.com");
  });
  it("type is parseable from key", () => {
    const k = cacheKey("serp", "kw|2056|nl|mobile");
    expect(k.split("::")[0]).toBe("serp");
  });
});

describe("formatAge", () => {
  it("formats seconds", () => {
    expect(formatAge(5_000)).toBe("5s ago");
  });
  it("formats minutes", () => {
    expect(formatAge(120_000)).toBe("2 min ago");
  });
  it("formats hours", () => {
    expect(formatAge(7_200_000)).toBe("2 h ago");
  });
});

describe("pageId", () => {
  it("drops the #fragment but keeps the query", () => {
    expect(pageId("https://e.com/a?x=1#top")).toBe("https://e.com/a?x=1");
  });
});

describe("isExpired", () => {
  it("uses the TTL of the key's type", () => {
    const now = 1_000_000_000;
    expect(isExpired("psi::x", now - 59 * 60_000, now)).toBe(false);
    expect(isExpired("psi::x", now - 61 * 60_000, now)).toBe(true);
    expect(isExpired("onpage::x", now - 6 * 60_000, now)).toBe(true);
  });
});

describe("shareInflight and cachedCall", () => {
  let store;
  beforeEach(() => {
    store = {};
    globalThis.chrome = { storage: { local: {
      get: vi.fn(async (k) => ({ [k]: store[k] })),
      set: vi.fn(async (obj) => Object.assign(store, obj))
    } } };
  });

  it("runs a paid call once when it is asked for twice at the same time", async () => {
    const run = vi.fn(async () => ({ v: 1 }));
    const [a, b] = await Promise.all([shareInflight("dfs::x", run), shareInflight("dfs::x", run)]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("serves the second call from the cache and never caches an error", async () => {
    const run = vi.fn(async () => ({ v: 2 }));
    expect(await cachedCall("serp::kw", run)).toEqual({ data: { v: 2 }, age: 0 });
    const again = await cachedCall("serp::kw", run);
    expect(again.data).toEqual({ v: 2 });
    expect(run).toHaveBeenCalledTimes(1);

    const failing = vi.fn(async () => { throw new Error("no funds"); });
    await expect(cachedCall("dfs::y", failing)).rejects.toThrow("no funds");
    expect(store._cache["dfs::y"]).toBeUndefined();
  });
});
