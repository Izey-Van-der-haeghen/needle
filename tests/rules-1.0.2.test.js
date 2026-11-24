// Full check of 1.0.2, rules against official sources and edge cases: robots meta, AI crawlers,
// hreflang, headings, the score, text in any language, links and the local-network guard.
import { describe, it, expect } from "vitest";
import { robotsRules } from "../lib/robots-meta.js";
import { robotsBlocksIndexing, unavailableAfter, snippetDirectives, copilotLimit, computeIndexability, computeHealthScore, canonicalFromLinkHeader } from "../lib/popup-compute.js";
import { collectFindings } from "../lib/findings.js";
import { analyzeAIAccess, isQuestion } from "../lib/geo.js";
import { botStatus } from "../lib/labels.js";
import { countWords } from "../lib/words.js";
import { tokenize, countPhrase, keywordPlacement } from "../lib/terms.js";
import { readability } from "../lib/readability.js";
import { charCount } from "../lib/snippet.js";
import { isLocalUrl } from "../lib/url-safety.js";
import { recordSnapshot } from "../lib/changes.js";
import { analyze, html } from "./helpers/content-harness.js";

const NOW = Date.parse("2026-11-22T12:00:00Z");
const page = (over = {}) => ({
  url: "https://e.com/page", title: "A good title for this page, about forty chars", description: "A description long enough to pass the length check without any trouble at all here.",
  canonical: "https://e.com/page", robots: "", lang: "en", viewport: "width=device-width",
  headings: [{ level: 1, text: "Main" }, { level: 2, text: "Sub" }], images: [], schema: [], hreflang: [],
  links: { details: [] }, mainContentWordCount: 600, og: { title: "T", image: "https://e.com/og.jpg" }, ...over
});
const tech = (over = {}) => ({ status: 200, finalUrl: "https://e.com/page", headers: {}, robotsTxt: { ok: true, pathAllowed: { allowed: true, rule: null } }, sitemap: { ok: true }, ...over });
const ids = (f) => f.map((x) => x.id);

describe("robots meta and X-Robots-Tag", () => {
  it("a passed unavailable_after date keeps the page out of Google; a later one doesn't", () => {
    expect(robotsBlocksIndexing("unavailable_after: 2001-01-01", NOW)).toBe(true);
    expect(robotsBlocksIndexing("unavailable_after: 25 Jun 2010 15:00:00 PST", NOW)).toBe(true);
    expect(robotsBlocksIndexing("index, unavailable_after: Saturday, 21-Nov-26 00:00:00 GMT", NOW)).toBe(true); // RFC 850, with a comma
    expect(robotsBlocksIndexing("unavailable_after: 2030-01-01", NOW)).toBe(false);
    expect(robotsBlocksIndexing("unavailable_after: soon", NOW)).toBe(false); // Google ignores a date it can't read
    expect(robotsBlocksIndexing("bingbot: unavailable_after: 2001-01-01", NOW)).toBe(false);
    expect(unavailableAfter("noarchive, unavailable_after: Sat, 21 Nov 2026 00:30:00 GMT", NOW)).toEqual({ when: "Sat, 21 Nov 2026 00:30:00 GMT", passed: true });
  });

  it("says why the page is out: the date, not a noindex that isn't there", () => {
    const f = collectFindings({ onpage: page({ robots: "unavailable_after: 2001-01-01" }), tech: tech() });
    const noindex = f.find((x) => x.id === "noindex-meta");
    expect(noindex.title).toBe("The page's unavailable_after date has passed (meta robots)");
    expect(noindex.fix).toMatch(/remove unavailable_after/);
  });

  it("a rule for another crawler doesn't limit Google's snippets", () => {
    expect(snippetDirectives("", "bingbot: nosnippet")).toEqual([]);
    expect(snippetDirectives("index, otherbot: nosnippet", "")).toEqual([]);
    expect(snippetDirectives("", "googlebot: nosnippet")).toEqual(["nosnippet"]);
    expect(ids(collectFindings({ onpage: page(), tech: tech({ headers: { "x-robots-tag": "bingbot: nosnippet" } }) }))).not.toContain("nosnippet");
  });

  it("quotes only the rules that limit snippets", () => {
    const f = collectFindings({ onpage: page({ robots: "max-snippet:50, max-image-preview:large" }), tech: tech() }).find((x) => x.id === "nosnippet");
    expect(f.why).toBe('"max-snippet:50" also limits what AI Overviews may quote.');
  });

  it("keeps a scope for the rules after it, as Google reads 'googlebot: noindex, nofollow'", () => {
    expect(robotsRules("googlebot: noindex, nofollow")).toEqual([{ scope: "googlebot", rule: "noindex" }, { scope: "googlebot", rule: "nofollow" }]);
    expect(robotsBlocksIndexing("googlebot-news: noindex")).toBe(false);
  });

  it("Bing's noarchive and nocache limit Copilot answers (Bing, 22 Sep 2023)", () => {
    expect(copilotLimit("noarchive", "")).toBe("noarchive");
    expect(copilotLimit("noarchive", "nocache")).toBe("nocache"); // both: Bing treats it as nocache
    expect(copilotLimit("googlebot: noarchive", "")).toBe(null);
    const f = collectFindings({ onpage: page({ robots: "noarchive" }), tech: tech() });
    expect(f.find((x) => x.id === "copilot-noarchive")).toMatchObject({ severity: "low", title: "Kept out of Microsoft Copilot answers" });
  });

  it("data-nosnippet counts on span, div and section only", async () => {
    const d = await analyze(html('<div data-nosnippet>a</div><p data-nosnippet>b</p><section data-nosnippet>c</section>'));
    expect(d.dataNosnippetCount).toBe(2);
    expect(d.dataNosnippetIgnored).toBe(1);
  });
});

describe("AI crawlers", () => {
  const robots = (t) => ({ ok: true, text: t });
  it("Anthropic says its bots follow robots.txt: a blocked Claude-User keeps the site out of Claude's answers", () => {
    const ai = analyzeAIAccess(robots("User-agent: Claude-User\nDisallow: /\n"), "/");
    const bot = ai.bots.find((b) => b.ua === "Claude-User");
    expect(ai.blockedSearchCount).toBe(1);
    expect(botStatus(bot, true)).toEqual(["blocked", "bad"]);
    expect(collectFindings({ onpage: page(), tech: tech(), geo: { aiAccess: ai } }).find((x) => x.id === "ai-blocked").why).toMatch(/^robots.txt stops Claude-User from reading this page/);
  });

  it("ChatGPT-User and Perplexity-User may ignore robots.txt (their vendors say so): a block there is a plain fact", () => {
    const ai = analyzeAIAccess(robots("User-agent: ChatGPT-User\nUser-agent: Perplexity-User\nDisallow: /\n"), "/");
    expect(ai.blockedSearchCount).toBe(0);
  });

  it("checks DuckAssistBot and Applebot too", () => {
    const ai = analyzeAIAccess(robots("User-agent: DuckAssistBot\nUser-agent: Applebot\nDisallow: /\n"), "/");
    expect(ai.bots.filter((b) => !b.allowed).map((b) => b.ua).sort()).toEqual(["Applebot", "DuckAssistBot"]);
    expect(ai.blockedSearchCount).toBe(2);
  });

  it("recognises question headings in Needle's languages and in other scripts", () => {
    for (const q of ["Wat kost een fietsherstelling", "Comment réparer un vélo", "Wie lange dauert die Reparatur", "東京の天気は？", "كم التكلفة؟", "Τι είναι;", "How much is it"]) expect(isQuestion(q), q).toBe(true);
    for (const q of ["Our prices", "Onze prijzen", "Come visit us", "Notes; more notes"]) expect(isQuestion(q), q).toBe(false);
  });
});

describe("canonical", () => {
  it("a missing canonical is listed but doesn't make the verdict amber (Google: not required)", () => {
    const v = computeIndexability(page({ canonical: "" }), tech());
    expect(v.level).toBe("good");
    expect(v.issues.map((i) => i.msg)).toContain("No canonical declared");
  });

  it("two head canonicals that differ only by #fragment are one; a body one isn't counted", async () => {
    const d = await analyze(html('<p>x</p><link rel="canonical" href="https://www.example.be/a">', '<link rel="canonical" href="https://www.example.be/x#top"><link rel="canonical" href="https://www.example.be/x">'));
    expect(d.canonicalDistinct).toBe(1);
    expect(d.canonicalOutsideHead).toBe(true);
  });

  it("reads a canonical from a Link header whose rel is a list", () => {
    expect(canonicalFromLinkHeader('<https://e.com/a.css>; rel=preload, <https://e.com/page>; rel="preload canonical"')).toBe("https://e.com/page");
    expect(canonicalFromLinkHeader('<https://e.com/page>; rel=canonical')).toBe("https://e.com/page");
  });
});

describe("headings", () => {
  it("an H1 with aria-hidden is still the page's H1 (it is on screen and indexed)", async () => {
    const d = await analyze(html('<div aria-hidden="true"><h1>Fietsherstel in Gent</h1></div><p>text</p>'));
    expect(d.headings[0].hidden).toBe(false);
    expect(ids(collectFindings({ onpage: { ...page(), headings: d.headings } }))).not.toContain("h1-missing");
  });

  it("several H1s are low, a missing description medium, and the lang text doesn't say Google uses it", () => {
    const f = collectFindings({ onpage: page({ description: "", lang: "", headings: [{ level: 1, text: "A" }, { level: 1, text: "B" }] }), tech: tech() });
    const by = Object.fromEntries(f.map((x) => [x.id, x]));
    expect(by["h1-multiple"].severity).toBe("low");
    expect(by["desc-missing"].severity).toBe("medium");
    expect(by.lang.why).toMatch(/Google detects the language itself/);
  });
});

describe("the checklist score", () => {
  const score = (over, t = tech()) => computeHealthScore(page(over), t).checks;
  const check = (checks, label) => checks.find((c) => c.label === label).score;

  it("counts the technical basics Fix this first rates high", () => {
    expect(check(score({}), "Technical basics")).toBe(1);
    expect(check(score({ viewport: "" }), "Technical basics")).toBe(0.5);
    expect(check(score({ url: "http://e.com/page" }, tech({ finalUrl: "http://e.com/page" })), "Technical basics")).toBe(0.5);
    expect(check(score({ mixedContent: [{ url: "http://x/a.js" }] }), "Technical basics")).toBe(0.7);
  });

  it("ignores hidden headings for the hierarchy, as Fix this first does", () => {
    expect(check(score({ headings: [{ level: 1, text: "A" }, { level: 4, text: "menu", hidden: true }, { level: 2, text: "B" }] }), "Heading hierarchy")).toBe(1);
  });

  it("asks for more than a thin page, not for 600 words (Google: length alone doesn't matter)", () => {
    expect(check(score({ mainContentWordCount: 160 }), "Content depth")).toBe(1);
    expect(check(score({ mainContentWordCount: 80 }), "Content depth")).toBe(0.5);
  });

  it("scores hreflang on correctness: none is fine, a broken set isn't", () => {
    expect(check(score({ hreflang: [] }), "Hreflang")).toBe(1);
    expect(check(score({ hreflang: [{ lang: "en-UK", href: "/en/" }] }), "Hreflang")).toBe(0);
  });

  it("a broken image costs points", () => {
    const img = { src: "https://e.com/a.jpg", alt: "a", width: 400, height: 300, naturalWidth: 0 };
    expect(check(score({ images: [{ ...img, brokenLoad: true }] }), "Images")).toBeLessThan(check(score({ images: [img] }), "Images"));
  });
});

describe("text in any language", () => {
  it("counts words in Japanese and Thai, and keeps Latin counts as they were", () => {
    expect(countWords("東京都は日本の首都であり、")).toBeGreaterThan(3);
    expect(countWords("กรุงเทพมหานครเป็นเมืองหลวงของประเทศไทย")).toBeGreaterThan(3);
    expect(countWords("  Fietsherstel in  Gent ")).toBe(3);
  });

  it("a Japanese article isn't 'thin content'", async () => {
    const d = await analyze(html(`<main><h1>東京</h1><p>${"東京都は日本の首都であり、多くの人が住んでいます。".repeat(24)}</p></main>`, '<html lang="ja">'));
    expect(d.mainContentWordCount).toBeGreaterThan(150);
    expect(ids(collectFindings({ onpage: { ...page(), mainContentWordCount: d.mainContentWordCount } }))).not.toContain("thin");
  });

  it("thin content is low and doesn't ask for a word count", () => {
    const thin = collectFindings({ onpage: page({ mainContentWordCount: 90 }), tech: tech() }).find((x) => x.id === "thin");
    expect(thin.severity).toBe("low");
    expect(thin.why).toMatch(/length alone doesn't matter/);
  });

  it("soft hyphens, joiners and combining marks stay inside their word", () => {
    expect(tokenize("Fiets­herstel")).toEqual(["fietsherstel"]);
    expect(tokenize("हिन्दी भाषा")).toEqual(["हिन्दी", "भाषा"]);
    expect(tokenize("Le café")).toEqual(["le", "café"]);
    expect(countPhrase("STRASSE", "straße")).toBe(1);
  });

  it("finds a keyword in a URL with an odd escape elsewhere, and skips hidden subheadings", () => {
    const at = (p, place) => keywordPlacement("fiets herstel", p, "tekst").find((x) => x.place === place);
    expect(at({ url: "https://e.com/caf%E9/fiets-herstel", headings: [] }, "URL").found).toBe(true);
    expect(at({ url: "https://e.com/", headings: [{ level: 2, text: "Fiets herstel", hidden: true }] }, "Subheadings").detail).toBe("0 of 0");
  });

  it("readability: abbreviations don't end sentences, the lang tag is trimmed, NFD reads as NFC", () => {
    const de = "Wir reparieren z. B. Fahrräder, Roller u. a. Fahrzeuge in unserer Werkstatt in der Stadt. ".repeat(8);
    expect(readability(de, "de").sentences).toBe(8);
    const en = "The quick brown fox jumps over the lazy dog near the river bank today. ".repeat(8);
    expect(readability(en, " EN ").supported).toBe(true);
    const fr = "Le château est très beau et la forêt est très grande aujourd'hui. Nous mangeons des crêpes à la crème. Il fait très froid en hiver dans la région. ".repeat(5);
    expect(readability(fr.normalize("NFD"), "fr")).toEqual(readability(fr, "fr"));
  });

  it("counts an emoji or a flag as one character", () => {
    expect(charCount("🚲 Fietsherstel in Gent")).toBe(22);
    expect(charCount("🇧🇪")).toBe(1);
    expect(collectFindings({ onpage: page({ title: "🚲 Fietsherstel in Gent" }) }).find((x) => x.id === "title-short").title).toBe("Title is only 22 characters");
  });

  it("meta values lose the template's newlines and indents", async () => {
    const d = await analyze(html("<p>x</p>", '<meta name="description" content="\n        Fietsherstel in Gent\n      ">'));
    expect(d.description).toBe("Fietsherstel in Gent");
  });
});

describe("links", () => {
  it("www and the bare domain are one site; a footer link isn't a cited source", async () => {
    const d = await analyze(html('<main><p><a href="https://example.be/x">a</a> <a href="https://WWW.EXAMPLE.BE./y">b</a> <a href="https://bron.example.org/">c</a></p></main><footer><a href="https://social.example.com/">d</a></footer>'), { url: "https://www.example.be/" });
    expect(d.links.details.map((l) => l.internal)).toEqual([true, true, false, false]);
    expect(d.externalLinkCount).toBe(1);
  });

  it("the local-network guard catches IPv4 written as IPv6 and a trailing dot", () => {
    for (const u of ["http://[::ffff:192.168.1.1]/", "http://[::ffff:127.0.0.1]/", "http://localhost./"]) expect(isLocalUrl(u), u).toBe(true);
    expect(isLocalUrl("http://[::ffff:8.8.8.8]/")).toBe(false);
  });

  it("a long heading is cut without leaving half an emoji", async () => {
    const d = await analyze(html(`<h1>${"a".repeat(199)}🚲 more</h1>`));
    expect(d.headings[0].text.endsWith("🚲")).toBe(true);
  });
});

describe("changes since the last audit", () => {
  it("small steps add up: the baseline stays until the drift is a change", () => {
    let store = {};
    let r;
    for (let i = 0, wc = 1000; i < 10; i++, wc -= 19) {
      r = recordSnapshot(store, "u", { wordCount: wc }, i * 1000);
      store = r.store;
    }
    expect(r.changes.map((c) => [c.before, c.after])).toEqual([[1000, 886]]);
  });
});

describe("noindex removed by JavaScript", () => {
  it("makes the verdict 'Not indexable', as Fix this first does", () => {
    const t = tech({ raw: { robots: "noindex", canonical: "https://e.com/page" } });
    expect(computeIndexability(page(), t).level).toBe("bad");
    expect(collectFindings({ onpage: page(), tech: t }).map((x) => x.id)).toContain("noindex-js");
    // A redirect means the server sent another document: no verdict from it.
    expect(computeIndexability(page(), { ...t, redirected: true, finalUrl: "https://e.com/other" }).issues.some((i) => /JavaScript removes it/.test(i.msg))).toBe(false);
  });
});

describe("a bot wall instead of the page", () => {
  it("its noindex isn't the page's: no noindex-js, no Not indexable", async () => {
    const { rawSnapshot } = await import("../lib/technical.js");
    const wall = rawSnapshot('<html><head><title>Just a moment...</title><meta name="robots" content="noindex,nofollow"></head><body><script>window._cf_chl_opt = {};</script></body></html>', "https://e.com/page");
    expect(wall.challenge).toBe(true);
    const t = tech({ raw: wall });
    expect(collectFindings({ onpage: page(), tech: t }).map((x) => x.id)).not.toContain("noindex-js");
    expect(computeIndexability(page(), t).level).toBe("good");
    // An ordinary page with Cloudflare's or DataDome's scripts on it is not a wall.
    expect(rawSnapshot('<html><head><title>Shop</title><meta name="robots" content="noindex"><script src="https://js.datadome.co/tags.js"></script></head><body><div id="app"></div><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></body></html>', "https://e.com/page").challenge).toBe(false);
  });
});

describe("ground truth on public pages (22 November 2026)", () => {
  it("reads Bing's own meta tag (nos.nl: bingbot nocache) for Copilot, not for Google", async () => {
    const d = await analyze(html("<p>x</p>", '<meta name="robots" content="max-image-preview:large"><meta content="nocache" name="bingbot">'));
    expect(d.robots).toBe("max-image-preview:large, bingbot: nocache");
    expect(copilotLimit(d.robots, "")).toBe("nocache");
    expect(snippetDirectives(d.robots, "")).toEqual(["max-image-preview:large"]);
  });

  it("names a logo heading by its text alternative (BBC: an SVG titled News)", async () => {
    const d = await analyze(html('<h1><svg aria-label="News" role="img"><title>News</title><path d="M0 0"/></svg></h1>'));
    expect(d.headings[0].text).toBe("News");
  });

  it("leaves hidden text out of a heading (web.dev: a hidden tooltip inside the H1)", async () => {
    const d = await analyze(html("<h1>Web Vitals<span hidden>Stay organized with collections</span></h1>"));
    expect(d.headings[0].text).toBe("Web Vitals");
  });

  it("an H1 that is only hidden gets one finding, not also 'No H1 heading' (Le Monde)", () => {
    const ids = collectFindings({ onpage: page({ headings: [{ level: 1, text: "Actualités", hidden: true }, { level: 2, text: "A" }] }), tech: tech() }).map((x) => x.id);
    expect(ids).toContain("h1-hidden");
    expect(ids).not.toContain("h1-missing");
  });

  it("an empty breadcrumb container isn't a breadcrumb trail (IKEA's home page)", async () => {
    const d = await analyze(html('<div class="hnf-pageheader__breadcrumbs hnf-pageheader__breadcrumbs--empty"></div><p>x</p>'));
    expect(d.schemaSignals.hasBreadcrumb).toBe(false);
  });
});

describe("trust signals by kind of page", () => {
  it("a byline and dates are information on a home or category page, and scored on an article", async () => {
    const { analyzeEEAT, aiReadinessScore } = await import("../lib/geo.js");
    const shop = analyzeEEAT({ schema: [], og: { type: "website" }, externalLinkCount: 0 });
    expect(shop.filter((s) => s.info).map((s) => s.label)).toEqual(["Author byline", "Published date", "Modified date"]);
    expect(collectFindings({ onpage: page(), tech: tech(), geo: { eeat: shop } }).map((x) => x.id)).not.toContain("eeat");
    const article = analyzeEEAT({ schema: [{ type: "Article", raw: { "@type": "Article", headline: "x" } }], og: {}, externalLinkCount: 0 });
    expect(article.filter((s) => s.info)).toEqual([]);
    expect(aiReadinessScore({ blockedSearchCount: 0 }, shop, []).score).toBeGreaterThan(aiReadinessScore({ blockedSearchCount: 0 }, article, []).score);
  });

  it("a sitemap that refuses Needle (HTTP 403, as Wikipedia's did) is not checked, not missing", async () => {
    const { analyzeTechnical } = await import("../lib/technical.js");
    const fetcher = async (reqs) => reqs.map((r) => (r.url.endsWith("/robots.txt")
      ? { ok: true, status: 200, text: "User-agent: *\nAllow: /\nSitemap: https://e.com/sitemap.xml\n", headers: {} }
      : r.url.endsWith("sitemap.xml") ? { ok: false, status: 403, text: "", headers: {} }
      : { ok: true, status: 200, text: "<html><body><p>x</p></body></html>", headers: { "content-type": "text/html" } }));
    const t = await analyzeTechnical("https://e.com/page", fetcher);
    expect(t.sitemap).toMatchObject({ unchecked: true, reason: "refused the check (HTTP 403)" });
    expect(collectFindings({ onpage: page(), tech: { ...tech(), sitemap: t.sitemap } }).map((x) => x.id)).not.toContain("sitemap");
  });
});

describe("heading text as the page shows it", () => {
  it("leaves out a custom element's text that has no box (web.dev's tooltip), keeps display:contents text", async () => {
    // jsdom has no layout: stub checkVisibility as Chrome answers it for these elements.
    const setup = (window) => {
      window.Element.prototype.checkVisibility = function () { return !this.hasAttribute("data-no-box"); };
    };
    const d = await analyze(html('<h1>Web Vitals<devsite-actions data-no-box>Stay organized with collections</devsite-actions></h1><h2><span data-no-box style="display: contents">Prijzen</span> 2026</h2><h3 style="text-transform: uppercase">Afspraak maken</h3>'), { setup });
    expect(d.headings.map((h) => h.text)).toEqual(["Web Vitals", "Prijzen 2026", "Afspraak maken"]);
  });
});

describe("Applebot follows Googlebot's rules when robots.txt doesn't name it (support.apple.com/en-us/119829)", () => {
  it("uses the Googlebot group before the * group, and its own group when there is one", () => {
    const ai = (t) => analyzeAIAccess({ ok: true, text: t }, "/").bots.find((b) => b.ua === "Applebot").allowed;
    expect(ai("User-agent: Googlebot\nAllow: /\n\nUser-agent: *\nDisallow: /\n")).toBe(true);
    expect(ai("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nAllow: /\n")).toBe(false);
    expect(ai("User-agent: Applebot\nAllow: /\n\nUser-agent: Googlebot\nDisallow: /\n")).toBe(true);
    expect(ai("User-agent: *\nDisallow: /\n")).toBe(false);
    // Other bots keep the plain fallback to *.
    expect(analyzeAIAccess({ ok: true, text: "User-agent: Googlebot\nAllow: /\n\nUser-agent: *\nDisallow: /\n" }, "/").bots.find((b) => b.ua === "GPTBot").allowed).toBe(false);
  });
});
