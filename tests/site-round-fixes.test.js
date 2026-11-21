// Fixes from a Needle run over a real trilingual personal site (21 November 2026).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeEEAT, analyzeCitability, aiReadinessScore, AI_SCORE_NOTE } from "../lib/geo.js";
import { validateSchema, suggestMissingSchemas } from "../lib/schema-validator.js";
import { collectFindings } from "../lib/findings.js";
import { isLanguageChooser } from "../lib/hreflang.js";
import { isHtmlDocument, notHtmlNotice, pixelTag } from "../lib/popup-helpers.js";
import { loadContentScript } from "./helpers/content-harness.js";

const page = { url: "https://person.example/en/", title: "A personal site title", description: "x".repeat(100), canonical: "https://person.example/en/", headings: [{ level: 1, text: "Hi" }], images: [], schema: [], links: { details: [] }, og: {} };
const tech = { status: 200, headers: {}, robotsTxt: { ok: true, pathAllowed: { allowed: true } } };
const person = { "@type": "Person", name: "Someone", sameAs: ["https://github.com/someone", "https://www.linkedin.com/in/someone"] };
const employer = { "@type": "Organization", name: "Employer", url: "https://employer.example/" };
const entity = (signals) => ({ org: signals.find((s) => s.label === "Organization entity"), person: signals.find((s) => s.label === "Person entity") });

describe("the site's own entity", () => {
  it("is the Person, not the employer named in worksFor", () => {
    const { org, person: p } = entity(analyzeEEAT({ schema: [{ raw: { "@type": "ProfilePage", mainEntity: { ...person, worksFor: employer, alumniOf: { "@type": "CollegeOrUniversity", name: "School" } } } }] }));
    expect(org).toBeUndefined();
    expect(p).toMatchObject({ ok: true, value: "2 sameAs links" });
  });

  it("is the Person, not the client of a case study (sourceOrganization, about)", () => {
    const raw = { "@type": "WebPage", mainEntity: { "@type": "CreativeWork", creator: person, sourceOrganization: employer, about: { "@type": "Organization", name: "Client" } } };
    const { org, person: p } = entity(analyzeEEAT({ schema: [{ raw }] }));
    expect(org).toBeUndefined();
    expect(p.ok).toBe(true);
  });

  it("is still the publisher Organization on a company site, even when the author works for it", () => {
    const company = { "@type": "Organization", name: "Company", logo: "https://company.example/logo.png", sameAs: ["https://www.linkedin.com/company/company"] };
    const raw = { "@type": "Article", author: { ...person, worksFor: employer }, publisher: company };
    const { org, person: p } = entity(analyzeEEAT({ schema: [{ raw }] }));
    expect(p).toBeUndefined();
    expect(org).toMatchObject({ ok: true });
  });

  it("is not a brand of a product the page sells", () => {
    const raw = { "@type": "Product", name: "Shoe", brand: { "@type": "Organization", name: "Brand" } };
    expect(entity(analyzeEEAT({ schema: [{ raw }] })).org.value).toBe("no Organization schema");
  });
});

describe("software without ratings", () => {
  const app = { "@context": "https://schema.org", "@type": "WebApplication", name: "Check", applicationCategory: "SEO", operatingSystem: "Any", offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" } };

  it("is valid markup: a note about the rich result, no error", () => {
    const [v] = validateSchema([{ raw: app }]);
    expect(v.issues.filter((i) => i.level === "error")).toEqual([]);
    const note = v.issues.find((i) => i.level === "note");
    expect(note.msg).toMatch(/real ratings or reviews/);
    expect(note.msg).toMatch(/never add made-up ones/);
  });

  it("gives no 'required property missing' finding", () => {
    const f = collectFindings({ onpage: { ...page, schema: [{ type: "WebApplication", raw: app }] }, tech });
    expect(f.find((x) => x.id === "schema-required")).toBeUndefined();
  });

  it("has no note once it has real ratings", () => {
    const [v] = validateSchema([{ raw: { ...app, "@type": "SoftwareApplication", aggregateRating: { "@type": "AggregateRating", ratingValue: 4.6, ratingCount: 120 } } }]);
    expect(v.issues.find((i) => i.level === "note")).toBeUndefined();
  });

  it("still needs name and offers", () => {
    const [v] = validateSchema([{ raw: { "@context": "https://schema.org", "@type": "SoftwareApplication" } }]);
    expect(v.issues.filter((i) => i.level === "error").map((i) => i.msg)).toEqual([
      'SoftwareApplication: missing required "name"',
      'SoftwareApplication: missing required "offers"'
    ]);
  });
});

describe("a tab that is not an HTML page", () => {
  it("is recognised from its content type", () => {
    expect(isHtmlDocument("text/html")).toBe(true);
    expect(isHtmlDocument("application/xhtml+xml")).toBe(true);
    expect(isHtmlDocument("")).toBe(true); // cached by an older version
    expect(isHtmlDocument(undefined)).toBe(true);
    expect(isHtmlDocument("text/plain")).toBe(false);
    expect(isHtmlDocument("application/xml")).toBe(false);
    expect(isHtmlDocument("image/png")).toBe(false);
  });

  it("gets a notice instead of an audit, with a pointer for llms.txt", () => {
    const llms = notHtmlNotice("text/plain", "https://site.example/llms.txt");
    expect(llms).toMatch(/This isn't an HTML page/);
    expect(llms).toMatch(/text\/plain/);
    expect(llms).toMatch(/the AI tab lists \/llms\.txt/);
    expect(notHtmlNotice("application/xml", "https://site.example/sitemap.xml")).not.toMatch(/llms/);
    expect(notHtmlNotice("<b>", "https://site.example/x")).toMatch(/&lt;b&gt;/);
  });

  it("is told apart by content.js, which reports the document's content type", async () => {
    const tab = await loadContentScript("<!doctype html><html lang=\"en\"><head><title>Page</title></head><body><h1>Hi</h1></body></html>", { url: "https://site.example/" });
    const d = await tab.send({ type: "ANALYZE_ONPAGE" });
    tab.window.close();
    expect(d.contentType).toBe("text/html");
  });
});

describe("the AI score explanation", () => {
  const access = (n) => ({ blockedSearchCount: n });
  const ok = { ok: true };
  const miss = { ok: false };

  it("names what the score really subtracts", () => {
    expect(aiReadinessScore(access(1), [], []).score).toBe(90);
    expect(aiReadinessScore(access(0), [miss, ok], []).score).toBe(95);
    expect(aiReadinessScore(access(0), [], [miss]).score).toBe(96);
    expect(AI_SCORE_NOTE).toMatch(/blocked AI search bot costs 10 points/);
    expect(AI_SCORE_NOTE).toMatch(/trust signal 5/);
    expect(AI_SCORE_NOTE).toMatch(/quotable structure 4/);
  });

  it("no longer claims that only bot blocks lower the score", () => {
    for (const file of ["../popup.js", "../lib/export.js"]) {
      expect(readFileSync(new URL(file, import.meta.url), "utf8")).not.toMatch(/Only blocks of AI search bots/);
    }
  });
});

describe("structured data nested as the page's mainEntity", () => {
  const ctx = "https://schema.org";
  const app = { "@type": "WebApplication", name: "Check", offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" } };

  it("gets the same checks as a top-level block", () => {
    const [nested] = validateSchema([{ raw: { "@context": ctx, "@type": "WebPage", mainEntity: { ...app, name: undefined } } }]);
    expect(nested.issues.filter((i) => i.level === "error").map((i) => i.msg)).toEqual(['mainEntity › WebApplication: missing required "name"']);
    expect(nested.issues.find((i) => i.level === "note")?.msg).toMatch(/^mainEntity › WebApplication: no star-rating rich result/);
  });

  it("checks FAQ questions under FAQPage", () => {
    const [faq] = validateSchema([{ raw: { "@context": ctx, "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Why?" }] } }]);
    expect(faq.issues.map((i) => i.msg)).toContain('mainEntity › Question: missing required "acceptedAnswer"');
  });

  it("doesn't check other nested things, like a Person's address", () => {
    const person = { "@type": "Person", name: "Someone", address: { "@type": "PostalAddress", addressLocality: "Ghent", addressCountry: "BE" } };
    const [v] = validateSchema([{ raw: { "@context": ctx, "@type": "ProfilePage", mainEntity: person } }]);
    expect(v.issues.filter((i) => i.level === "error")).toEqual([]);
  });
});

describe("data tables", () => {
  it("are information only: not amber, not in the score", () => {
    const checks = analyzeCitability({ headings: [{ text: "What is it?" }, { text: "How does it work?" }], listCount: 2, tableCount: 0 });
    const tables = checks.find((c) => c.label === "Data tables");
    expect(tables).toMatchObject({ ok: false, info: true });
    expect(aiReadinessScore({ blockedSearchCount: 0 }, [], checks).score).toBe(100);
  });
});

describe("schema suggestions", () => {
  it("don't suggest Article on a CV page (ProfilePage with <article> and <time>)", () => {
    const r = suggestMissingSchemas({ schema: [{ type: "ProfilePage", raw: { "@type": "ProfilePage", mainEntity: { "@type": "Person", name: "Someone" } } }], schemaSignals: { hasArticleTag: true, hasPublishDate: true } });
    expect(r.map((x) => x.type)).not.toContain("Article");
  });

  it("still suggest Article on a blog post without it", () => {
    const r = suggestMissingSchemas({ schema: [], schemaSignals: { hasArticleTag: true, hasPublishDate: true } });
    expect(r.map((x) => x.type)).toContain("Article");
  });

  it("accept a Person as who runs a personal home page", () => {
    const r = suggestMissingSchemas({ schema: [{ type: "WebSite", raw: { "@type": "WebSite", url: "https://person.example/", publisher: { "@type": "Person", name: "Someone" } } }], schemaSignals: { isHomepage: true } });
    expect(r.map((x) => x.type)).not.toContain("Organization or Person");
  });
});

describe("title and description width", () => {
  it("is neutral near the limit and only a problem when cut off", () => {
    expect(pixelTag(930, 920, 990)).toMatch(/class="tag neutral".*930 px, near the limit/);
    expect(pixelTag(993, 920, 990)).toMatch(/class="tag bad".*993 px, cut off/);
    expect(pixelTag(800, 920, 990)).toMatch(/class="tag good"/);
  });
});

describe("hreflang alternates after 'Check the alternates'", () => {
  const cluster = [
    { lang: "fr", href: "https://person.example/fr/case/", problems: [] },
    { lang: "x-default", href: "https://person.example/", problems: ["no hreflang link back to this page"] }
  ];

  it("reach Fix this first", () => {
    const f = collectFindings({ onpage: page, tech, hreflangCluster: cluster }).find((x) => x.id === "hreflang-alternates");
    expect(f).toMatchObject({ severity: "medium", title: "1 hreflang alternate with problems" });
    expect(f.examples).toEqual(["x-default https://person.example/: no hreflang link back to this page"]);
  });

  it("give no finding before the check or when all link back", () => {
    expect(collectFindings({ onpage: page, tech }).find((x) => x.id === "hreflang-alternates")).toBeUndefined();
    expect(collectFindings({ onpage: page, tech, hreflangCluster: [cluster[0]] }).find((x) => x.id === "hreflang-alternates")).toBeUndefined();
  });
});

describe("a language chooser", () => {
  const chooser = [
    { lang: "nl", href: "https://person.example/nl/" },
    { lang: "fr", href: "https://person.example/fr/" },
    { lang: "en", href: "https://person.example/en/" },
    { lang: "x-default", href: "https://person.example/" }
  ];

  it("is recognised: its own x-default, other pages for each language", () => {
    expect(isLanguageChooser(chooser, "https://person.example/")).toBe(true);
    expect(isLanguageChooser(chooser, "https://person.example/nl/")).toBe(false);
  });

  it("is not an English home page that is also the x-default", () => {
    const home = [{ lang: "en", href: "https://site.example/" }, { lang: "fr", href: "https://site.example/fr/" }, { lang: "x-default", href: "https://site.example/" }];
    expect(isLanguageChooser(home, "https://site.example/")).toBe(false);
  });

  it("gets no 'only N words' finding, while a short normal page still does", () => {
    const thin = { ...page, mainContentWordCount: 27 };
    expect(collectFindings({ onpage: { ...thin, url: "https://person.example/", hreflang: chooser }, tech }).find((x) => x.id === "thin")).toBeUndefined();
    expect(collectFindings({ onpage: thin, tech }).find((x) => x.id === "thin")).toBeDefined();
  });
});
