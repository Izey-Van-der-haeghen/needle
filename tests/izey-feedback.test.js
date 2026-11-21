import { describe, it, expect } from "vitest";
import { analyzeAIAccess, analyzeEEAT, aiReadinessScore } from "../lib/geo.js";
import { collectFindings } from "../lib/findings.js";
import { leadImageCheck } from "../lib/image-rules.js";

const page = { url: "https://izey.example/", title: "A personal site title", description: "x".repeat(100), canonical: "https://izey.example/", headings: [{ level: 1, text: "Hi" }], images: [], schema: [], links: { details: [] }, og: {} };
const tech = { status: 200, headers: {}, robotsTxt: { ok: true, pathAllowed: { allowed: true } } };

describe("Google-Extended", () => {
  const access = analyzeAIAccess({ text: "User-agent: Google-Extended\nDisallow: /\n" });
  it("is not an AI search bot and doesn't lower the score", () => {
    expect(access.blockedSearchCount).toBe(0);
    expect(access.bots.find((b) => b.ua === "Google-Extended").kind).toBe("control");
  });
  it("gets its own low note that Google Search and AI Overviews are not affected", () => {
    const geo = { aiAccess: access, eeat: [], citability: [] };
    const f = collectFindings({ onpage: page, tech, geo });
    expect(f.find((x) => x.id === "ai-blocked")).toBeUndefined();
    const g = f.find((x) => x.id === "ai-google-extended");
    expect(g.severity).toBe("low");
    expect(g.why).toMatch(/AI Overviews, is not affected/);
  });
});

describe("Cloudflare-managed robots.txt", () => {
  it("is recognised and explained", () => {
    const access = analyzeAIAccess({ text: "# BEGIN Cloudflare Managed content\nUser-agent: GPTBot\nDisallow: /\n# END Cloudflare Managed Content\n" });
    expect(access.cloudflareManaged).toBe(true);
    const f = collectFindings({ onpage: page, tech, geo: { aiAccess: access, eeat: [], citability: [] } });
    expect(f.find((x) => x.id === "ai-cloudflare")?.fix).toMatch(/AI Crawl Control/);
  });
  it("is not claimed for a robots.txt without the marker", () => {
    expect(analyzeAIAccess({ text: "User-agent: *\nAllow: /\n" }).cloudflareManaged).toBe(false);
  });
});

describe("a personal site", () => {
  it("is judged on its Person entity, not on a missing Organization", () => {
    const d = { ...page, schema: [{ raw: { "@type": "ProfilePage", mainEntity: { "@type": "Person", name: "Izey", sameAs: ["https://github.com/x"] } } }] };
    const signals = analyzeEEAT(d);
    expect(signals.find((s) => s.label === "Organization entity")).toBeUndefined();
    expect(signals.find((s) => s.label === "Person entity")).toMatchObject({ ok: true });
  });
});

describe("main image", () => {
  const portrait = { naturalWidth: 640, naturalHeight: 800, aboveFold: true };
  it("a 1200 px share image counts for the large preview", () => {
    expect(leadImageCheck([portrait], { image: "https://e/og.png", imageWidth: 1200 })).toMatchObject({ wideEnough: true, shareWidth: 1200 });
  });
  it("without one, a 640 px main image is still too small", () => {
    expect(leadImageCheck([portrait], { image: "https://e/og.png", imageWidth: 0 }).wideEnough).toBe(false);
  });
});
