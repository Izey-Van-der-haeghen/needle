// Paths into the popup's saved state (lib/state-paths.js): a view writes only the paths it changed.
import { describe, it, expect } from "vitest";
import { setIn, withPaths } from "../lib/state-paths.js";

describe("setIn", () => {
  it("sets a nested value, creating the objects on the way, and keeps the rest", () => {
    const s = { activeTab: "ai", marketByHost: { "a.example": { locationCode: 2056 } } };
    setIn(s, ["marketByHost", "www.b.example"], { locationCode: 2528 });
    setIn(s, ["serp", "serp-keyword"], "bike repair");
    expect(s).toEqual({ activeTab: "ai", marketByHost: { "a.example": { locationCode: 2056 }, "www.b.example": { locationCode: 2528 } }, serp: { "serp-keyword": "bike repair" } });
  });

  it("removes the key for undefined, and only that key", () => {
    const s = { activeTab: "ai", marketByHost: { "a.example": { locationCode: 2056 } }, serpMarketByHost: { "a.example": {} } };
    setIn(s, ["marketByHost"], undefined);
    expect(s).toEqual({ activeTab: "ai", serpMarketByHost: { "a.example": {} } });
    expect("marketByHost" in s).toBe(false);
    setIn(s, ["serpMarketByHost", "a.example"], undefined);
    expect(s).toEqual({ activeTab: "ai", serpMarketByHost: {} });
  });
});

describe("withPaths", () => {
  const stored = {
    activeTab: "technical",
    compare: { competitorUrls: ["https://rival.example/a"], keyword: "bike repair" },
    marketByHost: { "www.other.example": { locationCode: 2056, languageCode: "fr" } }
  };

  it("takes only the given paths from this view; the other paths of the stored copy survive", () => {
    const mine = { activeTab: "ai", compare: { keyword: "old keyword" }, serp: { "serp-keyword": "bike shop" } };
    const out = withPaths(stored, mine, [["activeTab"], ["serp", "serp-keyword"]]);
    expect(out).toEqual({ ...stored, activeTab: "ai", serp: { "serp-keyword": "bike shop" } });
  });

  it("removes a path this view removed (Clear history), and keeps its siblings", () => {
    const out = withPaths({ ...stored, serpMarketByHost: { "x.example": {} } }, { activeTab: "ai" }, [["marketByHost"], ["serpMarketByHost"]]);
    expect(out).toEqual({ activeTab: "technical", compare: stored.compare });
  });

  it("copies: neither input changes, and the result shares no objects with them", () => {
    const before = JSON.stringify(stored);
    const mine = { compare: { competitorUrls: ["https://mine.example/"] } };
    const out = withPaths(stored, mine, [["compare", "competitorUrls"]]);
    out.compare.competitorUrls.push("https://x.example/");
    out.marketByHost["www.other.example"].languageCode = "nl";
    expect(JSON.stringify(stored)).toBe(before);
    expect(mine.compare.competitorUrls).toEqual(["https://mine.example/"]);
    expect(withPaths(undefined, { a: 1 }, [["a"]])).toEqual({ a: 1 });
  });
});
