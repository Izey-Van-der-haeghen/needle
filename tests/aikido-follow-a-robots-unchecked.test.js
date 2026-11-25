// Aikido follow-up of 25 November 2026 (finding 13): when matching a hostile robots.txt runs out of
// time, lib/robots.js gives no verdict ({allowed: null, rule: null, unchecked: true}). Every reader
// of that verdict must treat it as "not checked": never as blocked, never as allowed.
import { describe, it, expect, vi, afterEach } from "vitest";
import { analyzeAIAccess, aiReadinessScore, AI_BOTS } from "../lib/geo.js";
import { botStatus } from "../lib/labels.js";
import { collectFindings } from "../lib/findings.js";
import { buildHtmlReport } from "../lib/export.js";

const UNCHECKED = { allowed: null, rule: null, unchecked: true };

let cases = 0;
/** A robots.txt no earlier call has seen: lib/robots.js remembers its answers for the last file and path. */
const fresh = (rules) => ({ ok: true, text: `# case ${++cases}\n${rules}` });

/** fn with a clock that jumps a minute at every look, so every search robots.js starts is out of time. */
function outOfTime(fn) {
  let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => (clock += 60000));
  try { return fn(); } finally { vi.restoreAllMocks(); }
}

// One wildcard rule that blocks /a/secret, and takes a search to match.
const WILDCARD = "User-agent: *\nDisallow: /*secret\n";
const PATH = "/a/secret";

const page = { url: "https://e.com/a/secret", title: "A good title for this page, about forty chars", description: "A description long enough to pass the length check without any trouble at all here.",
  canonical: "https://e.com/a/secret", robots: "", lang: "en", headings: [{ level: 1, text: "Main" }], images: [], schema: [], hreflang: [],
  links: { details: [] }, mainContentWordCount: 600, og: { title: "T", image: "https://e.com/og.jpg" } };
const tech = (pathAllowed) => ({ status: 200, finalUrl: page.url, headers: {}, robotsTxt: { ok: true, status: 200, pathAllowed }, sitemap: { ok: true } });
const ids = (list) => list.map((f) => f.id);

afterEach(() => vi.restoreAllMocks());

describe("lib/geo.js analyzeAIAccess", () => {
  it("blocks every bot with the rule when there is time (the verdict the time limit withholds)", () => {
    const ai = analyzeAIAccess(fresh(WILDCARD), PATH);
    for (const b of ai.bots) expect(b, b.ua).toMatchObject({ allowed: false, rule: "Disallow: /*secret" });
    expect(ai.blockedCount).toBe(AI_BOTS.length);
  });

  it("passes 'unchecked' through and counts no bot as blocked when the time runs out", () => {
    const ai = outOfTime(() => analyzeAIAccess(fresh(WILDCARD), PATH));
    for (const b of ai.bots) expect(b, b.ua).toMatchObject(UNCHECKED);
    expect(ai.blockedCount).toBe(0);
    expect(ai.blockedSearchCount).toBe(0);
    expect(aiReadinessScore(ai, [], []).score).toBe(100);
  });

  it("keeps the verdicts that were certain next to the ones that weren't", () => {
    // GPTBot's "Disallow: /" needs no search, so it is decided before any time runs out.
    const ai = outOfTime(() => analyzeAIAccess(fresh(`User-agent: GPTBot\nDisallow: /\n\n${WILDCARD}`), PATH));
    const gpt = ai.bots.find((b) => b.ua === "GPTBot");
    expect(gpt).toMatchObject({ allowed: false, rule: "Disallow: /" });
    expect(gpt.unchecked).toBeUndefined();
    for (const b of ai.bots.filter((x) => x.ua !== "GPTBot")) expect(b, b.ua).toMatchObject(UNCHECKED);
    expect(ai.blockedCount).toBe(1);
    expect(ai.blockedSearchCount).toBe(0); // GPTBot is a training bot
  });
});

describe("lib/labels.js botStatus", () => {
  it("says 'not checked', in a neutral tag, for a bot without a verdict", () => {
    expect(botStatus({ ua: "OAI-SearchBot", kind: "search", ...UNCHECKED }, true)).toEqual(["not checked", "neutral"]);
    expect(botStatus({ ua: "GPTBot", kind: "training", ...UNCHECKED }, true)).toEqual(["not checked", "neutral"]);
  });

  it("keeps the other states", () => {
    expect(botStatus({ kind: "search", ...UNCHECKED }, false)).toEqual(["unknown", "neutral"]);
    expect(botStatus({ kind: "search", allowed: true, rule: null }, true)).toEqual(["allowed", "good"]);
    expect(botStatus({ kind: "search", allowed: false, rule: "Disallow: /" }, true)).toEqual(["blocked", "bad"]);
    expect(botStatus({ kind: "training", allowed: false, rule: "Disallow: /" }, true)).toEqual(["blocked", "info"]);
  });

  it("puts 'not checked', not 'blocked', in the downloaded report", () => {
    const aiAccess = outOfTime(() => analyzeAIAccess(fresh(WILDCARD), PATH));
    const geo = { aiAccess, eeat: [], citability: [], robotsKnown: true, llmsTxt: { summary: { ok: false }, full: { ok: false } }, score: aiReadinessScore(aiAccess, [], []) };
    const html = buildHtmlReport({ url: page.url, onpage: page, technical: null, geo, health: null, verdict: null, theme: "light", version: "1.0.3" });
    const ai = html.slice(html.indexOf('<section id="ai">'), html.indexOf("</section>", html.indexOf('<section id="ai">')));
    expect(ai.split('<span class="tag neutral">not checked</span>').length - 1).toBe(AI_BOTS.length);
    expect(ai).not.toMatch(/blocked<\/span>/);
  });
});

describe("lib/findings.js", () => {
  it("reports no block and adds a low note when robots.txt is too complex for Googlebot and the AI bots", () => {
    const aiAccess = outOfTime(() => analyzeAIAccess(fresh(WILDCARD), PATH));
    const list = collectFindings({ onpage: page, tech: tech({ ...UNCHECKED }), geo: { aiAccess, eeat: [] } });
    expect(ids(list)).not.toContain("robots-blocked");
    expect(ids(list)).not.toContain("ai-blocked");
    expect(ids(list)).not.toContain("ai-google-extended");
    const note = list.find((f) => f.id === "robots-too-complex");
    expect(note).toMatchObject({ severity: "low", area: "Indexing", title: "robots.txt is too complex to check fully" });
    expect(note.examples).toEqual(["Googlebot", ...AI_BOTS.map((b) => b.ua)]);
    expect(note.why).toContain(`doesn't know whether these ${AI_BOTS.length + 1} crawlers may read this page`);
  });

  it("files the note under AI search when only AI bots are unchecked, and names a single crawler", () => {
    const aiAccess = { bots: [{ ua: "Google-Extended", kind: "control", ...UNCHECKED }, { ua: "OAI-SearchBot", kind: "search", allowed: true, rule: null }] };
    const ai = collectFindings({ onpage: page, tech: tech({ allowed: true, rule: null }), geo: { aiAccess, eeat: [] } });
    expect(ids(ai)).not.toContain("ai-google-extended");
    expect(ai.find((f) => f.id === "robots-too-complex")).toMatchObject({ area: "AI search", examples: ["Google-Extended"] });
    expect(ai.find((f) => f.id === "robots-too-complex").why).toContain("doesn't know whether Google-Extended may read this page");

    const google = collectFindings({ onpage: page, tech: tech({ ...UNCHECKED }) });
    expect(google.find((f) => f.id === "robots-too-complex")).toMatchObject({ area: "Indexing", examples: ["Googlebot"] });
  });

  it("still reports real blocks, and adds no note, when every verdict is certain", () => {
    const aiAccess = analyzeAIAccess(fresh("User-agent: OAI-SearchBot\nUser-agent: Google-Extended\nDisallow: /\n"), PATH);
    const list = collectFindings({ onpage: page, tech: tech({ allowed: false, rule: "Disallow: /a/" }), geo: { aiAccess, eeat: [] } });
    expect(ids(list)).toEqual(expect.arrayContaining(["robots-blocked", "ai-blocked", "ai-google-extended"]));
    expect(ids(list)).not.toContain("robots-too-complex");
  });
});
