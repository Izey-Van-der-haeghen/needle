import { describe, it, expect } from "vitest";
import { computeIndexability } from "../lib/popup-compute.js";
import { countPhrase } from "../lib/terms.js";
import { buildHtmlReport } from "../lib/export.js";
import { collectFindings } from "../lib/findings.js";

const page = { url: "https://e.com/a", title: "A title long enough", description: "x".repeat(100), canonical: "https://e.com/a", headings: [], images: [], schema: [], links: { details: [] }, robots: "" };

describe("verdict while the server check runs", () => {
  it("says it is still checking, not that the check failed", () => {
    const v = computeIndexability(page, { pending: true });
    expect(v.level).toBe("pending");
    expect(v.verdict).toBe("Checking the server…");
    expect(v.issues.map((i) => i.msg).join(" ")).not.toMatch(/failed/);
  });
  it("still shows what the page itself says", () => {
    const v = computeIndexability({ ...page, robots: "noindex" }, { pending: true });
    expect(v.level).toBe("bad");
    expect(v.issues.some((i) => /Meta robots/.test(i.msg))).toBe(true);
  });
});

describe("plural forms in the keyword check", () => {
  it.each([
    ["Bike maintenance classes in Ghent", "bike maintenance class"],
    ["Glasses and business addresses", "glass"],
    ["Our courses", "course"],
    ["Bike Repairs", "bike repair"],
    ["Wij herstellen fietsen", "fiets"],
    ["Réparation de vélos", "vélo"]
  ])("%s contains %s", (text, phrase) => {
    expect(countPhrase(text, phrase)).toBe(1);
  });
  it("doesn't match a different phrase", () => {
    expect(countPhrase("Bike rental", "bike repair")).toBe(0);
  });
});

describe("the report", () => {
  const onpage = { ...page, twitter: {}, og: {}, hreflang: [] };
  it("shows AI bots as unknown when robots.txt couldn't be read", () => {
    const geo = { aiAccess: { bots: [{ ua: "GPTBot", vendor: "OpenAI", kind: "training", allowed: true }] }, score: { score: 80 }, eeat: [], citability: [], robotsKnown: false };
    const html = buildHtmlReport({ url: page.url, onpage, technical: null, offpage: null, geo, health: null, verdict: null, theme: "light" });
    expect(html).toContain("unknown");
    expect(html).not.toMatch(/allowed<\/span> <strong>GPTBot/);
  });
  it("lets the fix list break across printed pages", () => {
    const html = buildHtmlReport({ url: page.url, onpage, technical: null, offpage: null, geo: null, health: null, verdict: null, theme: "light", findings: [] });
    expect(html).toMatch(/#fix-first \{ break-inside: auto; \}/);
  });
});

describe("big counts", () => {
  it("use thousands separators in findings", () => {
    const links = { details: Array.from({ length: 1280 }, (_, i) => ({ href: `https://e.com/${i}`, checkedStatus: { kind: "broken", status: 404 } })) };
    const f = collectFindings({ onpage: { ...page, links }, tech: { status: 200, headers: {}, robotsTxt: { ok: true, pathAllowed: { allowed: true } } } });
    const broken = f.find((x) => /broken/i.test(x.title));
    if (broken) expect(broken.title).toMatch(/1,280/);
  });
});
