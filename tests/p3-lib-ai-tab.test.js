// Full check of 25 November 2026: the AI tab.
// P3-25: "External citations" says "missing" for 0 links and "too few" for 1 or 2.
// The robots.txt index.html rule holds for every AI bot (Izey's decision, 25 November 2026).
import { describe, it, expect } from "vitest";
import { analyzeEEAT, analyzeAIAccess } from "../lib/geo.js";

const citations = (n) => analyzeEEAT({ schema: [], externalLinkCount: n }).find((s) => s.label === "External citations");

describe("External citations (P3-25)", () => {
  it("is missing with 0 links", () => {
    expect(citations(0)).toMatchObject({ ok: false, failText: "missing", value: "0 external links" });
  });

  it("is too few with 1 or 2 links", () => {
    expect(citations(1)).toMatchObject({ ok: false, failText: "too few", value: "1 external link" });
    expect(citations(2)).toMatchObject({ ok: false, failText: "too few", value: "2 external links" });
  });

  it("is ok with 3 links, with no word of its own", () => {
    expect(citations(3).ok).toBe(true);
    expect(citations(3).failText).toBeUndefined();
  });
});

describe("AI crawlers and the robots.txt index.html rule", () => {
  it("allows the directory for every AI bot when its index.html is allowed", () => {
    const text = "User-agent: *\nDisallow: /blog/\nAllow: /blog/index.html\n";
    const { bots, blockedCount } = analyzeAIAccess({ text }, "/blog/");
    expect(blockedCount).toBe(0);
    for (const b of bots) expect(b).toMatchObject({ allowed: true, rule: "Allow: /blog/index.html" });
  });
});
