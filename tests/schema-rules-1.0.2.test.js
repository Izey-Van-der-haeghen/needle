// Structured data rules checked against Google's documentation (22 November 2026), and JSON-LD
// shapes that are valid but were read as errors. Sources: Search Central documentation updates,
// the search gallery, and the Job posting, Site names, Product snippet, Article, Video, Breadcrumb,
// Organization and Q&A pages.
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { analyze, html } from "./helpers/content-harness.js";
import { validateSchema, suggestMissingSchemas, collectAllSchemaTypes, flattenJsonLd, isOrgType } from "../lib/schema-validator.js";
import { parseCompetitorHtml } from "../lib/parse-competitor.js";
import { analyzeEEAT, schemaAuthor } from "../lib/geo.js";
import { collectFindings } from "../lib/findings.js";
import { computeHealthScore } from "../lib/popup-compute.js";

const ctx = "https://schema.org";
const ld = (json) => `<script type="application/ld+json">${json}</script>`;
const issues = (raw) => validateSchema([{ raw: { "@context": ctx, ...raw } }])[0].issues;
const at = (level) => (raw) => issues(raw).filter((i) => i.level === level).map((i) => i.msg);
const errors = at("error");
const warns = at("warn");
const notes = at("note");
const infos = at("info");
const suggested = (onpage) => suggestMissingSchemas({ schema: [], ...onpage }).map((s) => s.type);
const { DOMParser } = new JSDOM("").window;
const page = { url: "https://www.example.be/nl-be/page/", title: "A page title that is long enough", description: "d".repeat(120), canonical: "https://www.example.be/nl-be/page/",
  headings: [{ level: 1, text: "H" }], images: [], links: { details: [] }, og: {}, schema: [] };
const tech = { status: 200, headers: {}, robotsTxt: { ok: true, pathAllowed: { allowed: true } } };
const schemaScore = (op) => computeHealthScore({ ...page, ...op }, tech).checks.find((c) => c.label === "Schema markup").score;
const schemaFindings = (schema) => collectFindings({ onpage: { ...page, schema }, tech }).filter((f) => f.area === "Structured data").map((f) => f.id);

describe("A1: no JobPosting suggestion from words on the page", () => {
  // Google: JobPosting "must only be used on pages that contain a single job posting", never on a list
  // or on a page without a job, at the risk of a manual action. Page text can't tell those apart.
  it("an everyday German phrase, a salary article or a careers page get no JobPosting suggestion", async () => {
    for (const body of ["<p>Wir möchten an dieser Stelle danken.</p>", "<p>The average salary of a nurse in 2026.</p>",
      "<h1>Werken bij ons</h1><p>Bekijk onze vacature voor fietsenmaker.</p><a href='/solliciteer'>Solliciteer spontaan</a>"]) {
      const d = await analyze(html(`<main>${body}</main>`));
      expect(suggested(d), body).not.toContain("JobPosting");
      expect(collectFindings({ onpage: d, tech }).find((f) => f.id === "schema-suggest")?.title || "", body).not.toMatch(/JobPosting/);
    }
  });
});

describe("A2: rich results Google no longer shows give notes, never errors", () => {
  it("an FAQPage without questions is a note, so no finding and no lower score", () => {
    const faq = { "@type": "FAQPage" };
    expect(errors(faq)).toEqual([]);
    expect(notes(faq)).toEqual(['FAQPage: missing "mainEntity". Google no longer shows this rich result.']);
    expect(schemaFindings([{ type: "FAQPage", raw: { "@context": ctx, ...faq } }])).toEqual([]);
    expect(schemaScore({ schema: [{ type: "FAQPage", raw: { "@context": ctx, ...faq } }] })).toBe(1);
  });

  it("an FAQ question without an answer is a note", () => {
    const faq = { "@type": "FAQPage", mainEntity: { "@type": "Question", name: "Why?" } };
    expect(errors(faq)).toEqual([]);
    expect(notes(faq)).toEqual(['mainEntity › Question: missing "acceptedAnswer" or "suggestedAnswer". Google no longer shows FAQ rich results.']);
  });

  it("a HowTo without steps is a note", () => {
    expect(errors({ "@type": "HowTo" })).toEqual([]);
    expect(notes({ "@type": "HowTo" })).toEqual([
      'HowTo: missing "name". Google no longer shows this rich result.',
      'HowTo: missing "step". Google no longer shows this rich result.'
    ]);
  });

  it("a SearchAction (the retired sitelinks search box) without a target is a note", () => {
    expect(errors({ "@type": "SearchAction" })).toEqual([]);
    expect(notes({ "@type": "SearchAction" })).toEqual(['SearchAction: missing "target". Google no longer shows this rich result.']);
  });

  it("a question on a Q&A page still needs an answer: Google still shows Q&A results", () => {
    expect(errors({ "@type": "QAPage", mainEntity: { "@type": "Question", name: "How?", answerCount: 0 } }))
      .toEqual(['mainEntity › Question: missing required "acceptedAnswer" or "suggestedAnswer"']);
  });

  it("a Question outside a QAPage gets a note that says where Google reads it", () => {
    expect(errors({ "@type": "Question", name: "How?" })).toEqual([]);
    expect(notes({ "@type": "Question", name: "How?" })).toEqual(['Question: missing "acceptedAnswer" or "suggestedAnswer". Google uses a Question for Q&A results only inside a QAPage.']);
  });

  it("a Course still needs a name and description: the Course list still uses them", () => {
    expect(errors({ "@type": "Course", name: "Bike repair" })).toEqual(['Course: missing required "description"']);
  });
});

describe("B9: no Article suggestion on a page that lists articles", () => {
  const signals = { hasArticleTag: true, hasPublishDate: true };
  it.each(["CollectionPage", "ItemList", "SearchResultsPage"])("%s", (type) => {
    expect(suggested({ schema: [{ type, raw: { "@context": ctx, "@type": type } }], schemaSignals: signals })).not.toContain("Article");
  });
  it("a page without such a type still gets the suggestion", () => {
    expect(suggested({ schemaSignals: signals })).toContain("Article");
  });
});

describe("C5: WebSite and site names", () => {
  it("WebSite needs a name as well as a url", () => {
    expect(errors({ "@type": "WebSite", url: "https://www.example.be/" })).toEqual(['WebSite: missing required "name"']);
    expect(errors({ "@type": "WebSite", url: "https://www.example.be/", name: "Example" })).toEqual([]);
  });

  it("WebSite is suggested only on the home page of a domain or subdomain", () => {
    expect(suggested({ url: "https://www.example.be/", schemaSignals: { isHomepage: true } })).toContain("WebSite");
    expect(suggested({ url: "https://blog.example.be/?ref=x", schemaSignals: { isHomepage: true } })).toContain("WebSite");
    for (const url of ["https://www.example.be/en/", "https://www.example.be/nl-be/"]) {
      const types = suggested({ url, schemaSignals: { isHomepage: true } });
      expect(types, url).not.toContain("WebSite");
      // Organization markup is still worth having on a language home page.
      expect(types, url).toContain("Organization or Person");
    }
  });

  it("on a real page at / and at /nl-be/", async () => {
    expect(suggested(await analyze(html("<h1>Home</h1>"), { url: "https://www.example.be/" }))).toContain("WebSite");
    expect(suggested(await analyze(html("<h1>Home</h1>"), { url: "https://www.example.be/nl-be/" }))).not.toContain("WebSite");
  });
});

describe("C6: JobPosting location", () => {
  const job = { "@type": "JobPosting", title: "Bike mechanic", description: "Repairs", datePosted: "2026-11-01", hiringOrganization: { "@type": "Organization", name: "Atelier" } };
  it("needs jobLocation, or applicantLocationRequirements for a remote job", () => {
    expect(errors(job)).toEqual(['JobPosting: missing required "jobLocation" or "applicantLocationRequirements"']);
    expect(errors({ ...job, jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Gent" } } })).toEqual([]);
    expect(errors({ ...job, jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: "BE" } })).toEqual([]);
  });
  it("doesn't also list jobLocation as recommended", () => {
    expect(infos(job).join(" ")).not.toMatch(/jobLocation/);
  });
});

describe("C7: Offer price and currency", () => {
  it("accepts the price in priceSpecification", () => {
    expect(errors({ "@type": "Offer", priceSpecification: { "@type": "UnitPriceSpecification", price: 5, priceCurrency: "EUR" } })).toEqual([]);
    expect(errors({ "@type": "Offer", priceSpecification: [{ "@type": "UnitPriceSpecification", price: 5, priceCurrency: "EUR" }] })).toEqual([]);
  });
  it("still needs a price somewhere", () => {
    expect(errors({ "@type": "Offer", priceCurrency: "EUR" })).toEqual(['Offer: missing required "price" or "priceSpecification.price"']);
    expect(errors({ "@type": "Offer", priceSpecification: { "@type": "UnitPriceSpecification", priceCurrency: "EUR" } })).toEqual(['Offer: missing required "price" or "priceSpecification.price"']);
  });
  it("a missing currency is a warning, not an error", () => {
    expect(errors({ "@type": "Offer", price: 5 })).toEqual([]);
    expect(warns({ "@type": "Offer", price: 5 })).toEqual(['Offer: missing "priceCurrency" or "priceSpecification.priceCurrency". Google recommends it for product snippets and requires it for merchant listings.']);
    expect(warns({ "@type": "Offer", priceSpecification: { price: 5, priceCurrency: "EUR" } })).toEqual([]);
  });
});

describe("C8: properties that are recommended, not required", () => {
  it("ContactPoint, PostalAddress, MediaObject, Brand and SiteNavigationElement have no required properties", () => {
    for (const type of ["ContactPoint", "PostalAddress", "MediaObject", "Brand", "SiteNavigationElement"]) {
      expect(errors({ "@type": type }), type).toEqual([]);
    }
  });
  it("a ContactPoint with only an email is fine; one with neither phone nor email gets a recommendation", () => {
    expect(issues({ "@type": "ContactPoint", email: "hello@example.be" })).toEqual([]);
    expect(infos({ "@type": "ContactPoint" })).toEqual(['ContactPoint: missing recommended "telephone" or "email"']);
  });
  it("a PostalAddress without a street is a recommendation", () => {
    expect(infos({ "@type": "PostalAddress", addressLocality: "Gent", addressCountry: "BE" })).toEqual(['PostalAddress: missing recommended "streetAddress"']);
  });
});

describe("C9: Article recommendations are Google's list", () => {
  it("doesn't recommend publisher or mainEntityOfPage", () => {
    for (const type of ["Article", "NewsArticle", "BlogPosting"]) {
      expect(infos({ "@type": type }).map((m) => m.match(/"(\w+)"/)[1]), type).toEqual(["headline", "author", "datePublished", "image", "dateModified"]);
    }
  });
});

describe("C10: no VideoObject suggestion for a background video", () => {
  const video = async (markup) => (await analyze(html(`<main><h1>Atelier</h1>${markup}</main>`))).schemaSignals.hasVideoEmbed;
  it("skips a muted autoplay video, a looping video without controls and Vimeo's background mode", async () => {
    expect(await video('<video autoplay muted loop playsinline src="/bg.mp4"></video>')).toBe(false);
    expect(await video('<video autoplay muted src="/bg.mp4"></video>')).toBe(false);
    expect(await video('<video loop src="/bg.mp4"></video>')).toBe(false);
    expect(await video('<iframe src="https://player.vimeo.com/video/1?background=1"></iframe>')).toBe(false);
  });
  it("still sees a video someone can watch", async () => {
    expect(await video('<video controls src="/film.mp4"></video>')).toBe(true);
    expect(await video('<video autoplay muted controls src="/film.mp4"></video>')).toBe(true);
    expect(await video('<video src="/film.mp4"></video>')).toBe(true); // a custom player draws its own controls
    expect(await video('<iframe src="https://www.youtube.com/embed/abc"></iframe>')).toBe(true);
  });
  it("says the markup is for a video that is the page's main content", () => {
    const s = suggestMissingSchemas({ schema: [], schemaSignals: { hasVideoEmbed: true } }).find((x) => x.type === "VideoObject");
    expect(s.reason).toMatch(/main content/);
    expect(s.reason).not.toMatch(/Discover/);
  });
});

describe("C11: breadcrumbs show in desktop results", () => {
  it("says so in the suggestion", () => {
    expect(suggestMissingSchemas({ schema: [], schemaSignals: { hasBreadcrumb: true } }).find((x) => x.type === "BreadcrumbList").reason).toMatch(/desktop results/);
  });
});

describe("C13: a page with only microdata or RDFa isn't scored 0 for structured data", () => {
  it("counts microdata as markup", () => {
    expect(schemaScore({ microdataTypes: ["Product", "Offer"] })).toBe(1);
    expect(schemaScore({ microdataTypes: [] })).toBe(0);
  });
  it("JSON-LD errors still count when the page also has microdata", () => {
    expect(schemaScore({ schema: [{ type: "Product", raw: { "@context": ctx, "@type": "Product" } }], microdataTypes: ["BreadcrumbList"] })).toBe(0);
  });
});

describe("edge 4: valid JSON-LD shapes are read as their nodes", () => {
  const types = (d) => d.schema.map((s) => s.type);
  const structured = (d) => collectFindings({ onpage: d, tech }).filter((f) => f.area === "Structured data").map((f) => f.id);

  it("@graph as one node object", async () => {
    const d = await analyze(html("<h1>x</h1>", ld('{"@context":"https://schema.org","@graph":{"@type":"Organization","name":"A","url":"https://a.com"}}')));
    expect(types(d)).toEqual(["Organization"]);
    expect(d.schema[0].raw["@context"]).toBe(ctx);
    expect(structured(d)).not.toContain("schema-invalid");
  });

  it("an array of @graph documents, each node with its document's @context", async () => {
    const d = await analyze(html("<h1>x</h1>", ld('[{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"A","url":"https://a.com/"},{"@type":"Organization","name":"A"}]}]')));
    expect(types(d)).toEqual(["WebSite", "Organization"]);
    expect(d.schema.map((s) => s.raw["@context"])).toEqual([ctx, ctx]);
    expect(structured(d)).not.toContain("schema-required");
  });

  it("null, an empty block and a block of only spaces give no structured data and no finding", async () => {
    const d = await analyze(html("<h1>x</h1>", ld("null") + ld("") + ld("  \n  ") + ld("{}") + ld("[null]")));
    expect(d.schema).toEqual([]);
    expect(structured(d)).toEqual([]);
  });

  it("broken JSON is still reported", async () => {
    const d = await analyze(html("<h1>x</h1>", ld('{"@type": "Organization",}')));
    expect(types(d)).toEqual(["Invalid JSON"]);
  });

  it("the competitor table reads the same shapes", () => {
    const parse = (json) => parseCompetitorHtml(`<html><head>${ld(json)}</head><body></body></html>`, "https://c.example/", DOMParser).schemaTypes.sort();
    expect(parse('{"@context":"https://schema.org","@graph":{"@type":"Organization"}}')).toEqual(["Organization"]);
    expect(parse('[{"@context":"https://schema.org","@graph":[{"@type":"Product"},{"@type":"BreadcrumbList"}]}]')).toEqual(["BreadcrumbList", "Product"]);
    expect(parse("null")).toEqual([]);
  });

  it("flattenJsonLd keeps an inner document's own @context", () => {
    expect(flattenJsonLd([{ "@context": "https://a.example/", "@graph": [{ "@type": "A" }] }, { "@type": "B" }], ctx))
      .toEqual([{ "@context": "https://a.example/", "@type": "A" }, { "@context": ctx, "@type": "B" }]);
  });
});

describe("edge 11: an author given as an @id reference", () => {
  const graph = [
    { "@type": "Article", "@id": "https://a.example/p#article", author: { "@id": "https://a.example/#/schema/person/1" }, datePublished: "2026-11-01T10:00:00+01:00" },
    { "@type": "Person", "@id": "https://a.example/#/schema/person/1", name: "Jan Peeters" }
  ].map((n) => ({ type: n["@type"], raw: { "@context": ctx, ...n } }));

  it("resolves to the Person's name in the E-E-A-T signals", () => {
    expect(analyzeEEAT({ schema: graph }).find((s) => s.label === "Author byline")).toMatchObject({ ok: true, value: "Jan Peeters" });
  });

  it("resolves each author in a list, inline or by reference", () => {
    const schema = [{ raw: { "@type": "Article", author: [{ "@id": "#p1" }, { "@type": "Person", name: "An" }, "Piet"] } }, { raw: { "@type": "Person", "@id": "#p1", name: "Jan" } }];
    expect(schemaAuthor(schema)).toBe("Jan, An, Piet");
  });

  it("doesn't take the author of something the page reviews or mentions", () => {
    const review = { "@type": "Review", itemReviewed: { "@type": "Book", name: "A book", author: { "@type": "Person", name: "Someone else" } } };
    expect(schemaAuthor([{ raw: review }])).toBe("");
    expect(schemaAuthor([{ raw: { ...review, author: { "@type": "Person", name: "Reviewer" } } }])).toBe("Reviewer");
  });

  it("finds dates on the main entity below the top level", () => {
    const s = analyzeEEAT({ schema: [{ raw: { "@type": "WebPage", mainEntity: { "@type": "Article", datePublished: "2026-11-01", dateModified: { "@value": "2026-11-02" } } } }] });
    expect(s.find((x) => x.label === "Published date").value).toBe("2026-11-01");
    expect(s.find((x) => x.label === "Modified date").value).toBe("2026-11-02");
  });
});

describe("edge 27: a full-IRI or prefixed @type", () => {
  it("counts https://schema.org/WebSite as WebSite for suggestions", () => {
    expect(suggested({ url: "https://a.example/", schema: [{ raw: { "@context": ctx, "@type": "https://schema.org/WebSite", name: "A", url: "https://a.example/" } }], schemaSignals: { isHomepage: true } })).not.toContain("WebSite");
  });

  it("checks schema:Product for its required properties", () => {
    const [v] = validateSchema([{ raw: { "@context": { schema: "https://schema.org/" }, "@type": "schema:Product" } }]);
    expect(v.types).toEqual(["Product"]);
    expect(v.issues.filter((i) => i.level === "error").map((i) => i.msg)).toContain('Product: missing required "name"');
  });

  it("lists bare type names, also in the competitor table", () => {
    expect(collectAllSchemaTypes([{ raw: { "@type": ["http://schema.org/Product", "schema:Thing"], offers: { "@type": "https://schema.org/Offer" } } }])).toEqual(["Offer", "Product", "Thing"]);
    expect(parseCompetitorHtml(`<html><head>${ld('{"@context":"https://schema.org","@type":"https://schema.org/Product"}')}</head><body></body></html>`, "https://c.example/", DOMParser).schemaTypes).toEqual(["Product"]);
    expect(isOrgType("schema:LocalBusiness")).toBe(true);
  });

  it("finds a Person entity typed by its full IRI", () => {
    const s = analyzeEEAT({ schema: [{ raw: { "@type": "https://schema.org/ProfilePage", mainEntity: { "@type": "https://schema.org/Person", name: "Someone", sameAs: ["https://github.com/someone"] } } }] });
    expect(s.find((x) => x.label === "Person entity")).toMatchObject({ ok: true });
  });
});
