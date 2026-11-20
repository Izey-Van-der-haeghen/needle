import { describe, it, expect } from "vitest";
import { analyzeAIAccess, analyzeEEAT, analyzeCitability, aiReadinessScore, fetchLlmsTxt, AI_BOTS } from "../lib/geo.js";

describe("analyzeAIAccess", () => {
  it("returns all-allowed when robots.txt is empty", () => {
    const r = analyzeAIAccess({ text: "" });
    expect(r.blockedCount).toBe(0);
    expect(r.bots.every(b => b.allowed)).toBe(true);
    expect(r.totalCount).toBe(AI_BOTS.length);
  });

  it("returns all-allowed when robotsTxt is null", () => {
    const r = analyzeAIAccess(null);
    expect(r.blockedCount).toBe(0);
  });

  it("blocks GPTBot when robots.txt disallows it", () => {
    const txt = "User-agent: GPTBot\nDisallow: /\n";
    const r = analyzeAIAccess({ text: txt });
    const gpt = r.bots.find(b => b.ua === "GPTBot");
    expect(gpt.allowed).toBe(false);
    expect(r.blockedCount).toBeGreaterThanOrEqual(1);
  });

  it("blocks all bots when wildcard disallow", () => {
    const txt = "User-agent: *\nDisallow: /\n";
    const r = analyzeAIAccess({ text: txt });
    expect(r.blockedCount).toBe(AI_BOTS.length);
  });

  it("specific allow overrides wildcard disallow", () => {
    const txt = "User-agent: *\nDisallow: /\n\nUser-agent: ClaudeBot\nAllow: /\n";
    const r = analyzeAIAccess({ text: txt });
    const claude = r.bots.find(b => b.ua === "ClaudeBot");
    expect(claude.allowed).toBe(true);
  });
});

describe("analyzeEEAT", () => {
  it("flags missing author when no signals present", () => {
    const r = analyzeEEAT({ schema: [], externalLinkCount: 0 });
    const author = r.find(s => s.label === "Author byline");
    expect(author.ok).toBe(false);
    expect(author.hint).toBeTruthy();
  });

  it("detects author from schema Article.author string", () => {
    const r = analyzeEEAT({
      schema: [{ raw: { "@type": "Article", author: "Jane Doe" } }],
      externalLinkCount: 0
    });
    const author = r.find(s => s.label === "Author byline");
    expect(author.ok).toBe(true);
    expect(author.value).toBe("Jane Doe");
  });

  it("detects author from schema Article.author object.name", () => {
    const r = analyzeEEAT({
      schema: [{ raw: { "@type": "Article", author: { name: "Jane Doe" } } }],
      externalLinkCount: 0
    });
    const author = r.find(s => s.label === "Author byline");
    expect(author.ok).toBe(true);
    expect(author.value).toBe("Jane Doe");
  });

  it("falls back to authorMeta when schema lacks author", () => {
    const r = analyzeEEAT({
      schema: [],
      authorMeta: "From meta",
      externalLinkCount: 0
    });
    const author = r.find(s => s.label === "Author byline");
    expect(author.ok).toBe(true);
    expect(author.value).toBe("From meta");
  });

  it("flags low external citations", () => {
    const r = analyzeEEAT({ schema: [], externalLinkCount: 1 });
    const cites = r.find(s => s.label === "External citations");
    expect(cites.ok).toBe(false);
  });

  it("passes external citations when >= 3", () => {
    const r = analyzeEEAT({ schema: [], externalLinkCount: 5 });
    const cites = r.find(s => s.label === "External citations");
    expect(cites.ok).toBe(true);
  });

  it("detects Organization with logo + sameAs as OK", () => {
    const r = analyzeEEAT({
      schema: [{
        raw: {
          "@type": "Organization",
          logo: "https://x.com/logo.png",
          sameAs: ["https://twitter.com/x", "https://linkedin.com/company/x"]
        }
      }],
      externalLinkCount: 0
    });
    const org = r.find(s => s.label === "Organization entity");
    expect(org.ok).toBe(true);
  });

  it("flags Organization without sameAs", () => {
    const r = analyzeEEAT({
      schema: [{
        raw: { "@type": "Organization", logo: "https://x.com/logo.png" }
      }],
      externalLinkCount: 0
    });
    const org = r.find(s => s.label === "Organization entity");
    expect(org.ok).toBe(false);
    expect(org.hint).toMatch(/sameAs/i);
  });
});

describe("analyzeCitability", () => {
  it("flags low question-headings count", () => {
    const r = analyzeCitability({ headings: [{ text: "Intro" }], listCount: 0, tableCount: 0 });
    const q = r.find(c => c.label === "Question-based headings");
    expect(q.ok).toBe(false);
  });

  it("counts ? headings as question-based", () => {
    const r = analyzeCitability({
      headings: [{ text: "What is X?" }, { text: "How does Y work?" }, { text: "Intro" }],
      listCount: 0, tableCount: 0
    });
    const q = r.find(c => c.label === "Question-based headings");
    expect(q.ok).toBe(true);
    expect(q.value).toMatch(/2 of 3/);
  });

  it("counts headings starting with question words", () => {
    const r = analyzeCitability({
      headings: [{ text: "What we do" }, { text: "Why us" }, { text: "Random" }],
      listCount: 0, tableCount: 0
    });
    const q = r.find(c => c.label === "Question-based headings");
    expect(q.ok).toBe(true);
  });

  it("passes lists check when >= 1", () => {
    const r = analyzeCitability({ headings: [], listCount: 3, tableCount: 0 });
    const lists = r.find(c => c.label === "Lists in the content");
    expect(lists.ok).toBe(true);
  });
});

describe("aiReadinessScore", () => {
  const all = (n, ok) => Array.from({ length: n }, () => ({ ok }));

  it("returns 100 when everything passes", () => {
    const r = aiReadinessScore({ blockedSearchCount: 0 }, all(5, true), all(3, true));
    expect(r).toEqual({ score: 100, level: "good" });
  });

  it("subtracts 10 per blocked AI search bot", () => {
    expect(aiReadinessScore({ blockedSearchCount: 2 }, all(5, true), all(3, true)).score).toBe(80);
  });

  it("ignores blocked training-only bots", () => {
    const access = analyzeAIAccess({ text: "User-agent: GPTBot\nDisallow: /\n\nUser-agent: CCBot\nDisallow: /\n" });
    expect(access.blockedCount).toBe(2);
    expect(access.blockedSearchCount).toBe(0);
    expect(aiReadinessScore(access, all(5, true), all(3, true)).score).toBe(100);
  });

  it("counts a blocked AI search bot", () => {
    const access = analyzeAIAccess({ text: "User-agent: OAI-SearchBot\nDisallow: /\n" });
    expect(access.blockedSearchCount).toBe(1);
  });

  it("subtracts 5 per failed E-E-A-T signal", () => {
    expect(aiReadinessScore({ blockedSearchCount: 0 }, [...all(3, true), ...all(2, false)], all(3, true)).score).toBe(90);
  });

  it("subtracts 4 per failed citability check", () => {
    expect(aiReadinessScore({ blockedSearchCount: 0 }, all(5, true), [...all(1, true), ...all(2, false)]).score).toBe(92);
  });

  it("clamps at 0", () => {
    expect(aiReadinessScore({ blockedSearchCount: 50 }, all(5, false), all(3, false))).toEqual({ score: 0, level: "bad" });
  });

  it("returns warn for mid-range scores", () => {
    expect(aiReadinessScore({ blockedSearchCount: 2 }, [...all(2, true), ...all(3, false)], all(3, false)).level).toBe("warn");
  });
});

describe("analyzeEEAT organisation", () => {
  it("accepts Organization subtypes and nested organisations", () => {
    const r = analyzeEEAT({
      schema: [{ raw: { "@type": "WebPage", publisher: { "@type": "RoofingContractor", logo: "https://x.test/l.png", sameAs: "https://www.linkedin.com/company/x" } } }],
      externalLinkCount: 0
    });
    const org = r.find(s => s.label === "Organization entity");
    expect(org.ok).toBe(true);
    expect(org.value).toMatch(/1 sameAs link/);
  });
});

describe("fetchLlmsTxt", () => {
  const fetcher = (answers) => async (reqs) => reqs.map(r => answers[r.url.split("/").pop()]);

  it("finds a real llms.txt", async () => {
    const r = await fetchLlmsTxt("https://x.test", fetcher({
      "llms.txt": { ok: true, status: 200, headers: { "content-type": "text/plain" }, text: "# Site\n> About" },
      "llms-full.txt": { ok: false, status: 404 }
    }));
    expect(r.summary).toMatchObject({ ok: true, size: 14 });
    expect(r.full).toEqual({ ok: false, status: 404 });
  });

  it("does not count an HTML page served at /llms.txt (soft 404)", async () => {
    const r = await fetchLlmsTxt("https://x.test", fetcher({
      "llms.txt": { ok: true, status: 200, headers: { "content-type": "text/html" }, text: "<!doctype html><title>Not found</title>" },
      "llms-full.txt": { ok: true, status: 200, headers: {}, text: "<html></html>" }
    }));
    expect(r.summary.ok).toBe(false);
    expect(r.full.ok).toBe(false);
  });
});
