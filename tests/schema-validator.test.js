import { describe, it, expect } from "vitest";
import { validateSchema, detectFaqDuplicates, suggestMissingSchemas, collectAllSchemaTypes } from "../lib/schema-validator.js";

describe("validateSchema", () => {
  it("flags missing @context", () => {
    const result = validateSchema([{ type: "Article", raw: { "@type": "Article", headline: "x", author: "x", datePublished: "2024" } }]);
    expect(result[0].issues.some(i => i.msg === "Missing @context")).toBe(true);
  });

  it("does not flag missing @context when present", () => {
    const result = validateSchema([{
      type: "Article",
      raw: { "@context": "https://schema.org", "@type": "Article", headline: "x", author: "x", datePublished: "2024-01-01" }
    }]);
    expect(result[0].issues.some(i => i.msg === "Missing @context")).toBe(false);
  });

  it("treats Article author and datePublished as recommended, as Google's docs do", () => {
    const result = validateSchema([{
      type: "Article",
      raw: { "@context": "https://schema.org", "@type": "Article", headline: "x" }
    }]);
    expect(result[0].issues.filter(i => i.level === "error")).toEqual([]);
    const info = result[0].issues.filter(i => i.level === "info").map(i => i.msg);
    expect(info).toContain('Article: missing recommended "author"');
    expect(info).toContain('Article: missing recommended "datePublished"');
  });

  it("accepts any one of offers, review or aggregateRating for Product", () => {
    const withReview = validateSchema([{ type: "Product", raw: { "@context": "https://schema.org", "@type": "Product", name: "x", review: { "@type": "Review" } } }]);
    expect(withReview[0].issues.filter(i => i.level === "error")).toEqual([]);
  });

  it("has no required properties for Organization", () => {
    const r = validateSchema([{ type: "Organization", raw: { "@context": "https://schema.org", "@type": "Organization" } }]);
    expect(r[0].issues.filter(i => i.level === "error")).toEqual([]);
  });

  it("recognizes @type as array", () => {
    const result = validateSchema([{
      type: "Article",
      raw: { "@context": "https://schema.org", "@type": ["Article", "BlogPosting"], headline: "x", author: "y", datePublished: "2024-01-01" }
    }]);
    expect(result[0].types).toEqual(["Article", "BlogPosting"]);
  });

  it("flags Product without offers", () => {
    const result = validateSchema([{
      type: "Product",
      raw: { "@context": "https://schema.org", "@type": "Product", name: "x" }
    }]);
    const errs = result[0].issues.filter(i => i.level === "error").map(i => i.msg);
    expect(errs).toContain('Product: missing required "offers" or "review" or "aggregateRating"');
  });

  it("warns about non-schema.org @context", () => {
    const result = validateSchema([{
      type: "Article",
      raw: { "@context": "https://other.org", "@type": "Article", headline: "x", author: "y", datePublished: "2024" }
    }]);
    expect(result[0].issues.some(i => i.level === "warn" && i.msg.includes("@context"))).toBe(true);
  });
});

describe("detectFaqDuplicates", () => {
  const faqWith = (questions) => ({
    type: "FAQPage",
    raw: {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: questions.map(q => ({ "@type": "Question", name: q, acceptedAnswer: { text: "..." } }))
    }
  });

  it("returns empty when no FAQPage present", () => {
    const result = detectFaqDuplicates([
      { type: "Article", raw: { "@type": "Article", headline: "x" } }
    ]);
    expect(result).toEqual([]);
  });

  it("returns empty for FAQPage with unique questions", () => {
    const result = detectFaqDuplicates([faqWith(["How to X?", "Why Y?", "What is Z?"])]);
    expect(result).toEqual([]);
  });

  it("flags duplicate within a single FAQPage", () => {
    const result = detectFaqDuplicates([faqWith(["How to X?", "How to X?"])]);
    expect(result).toHaveLength(1);
    expect(result[0].question).toBe("How to X?");
    expect(result[0].count).toBe(2);
  });

  it("is case-insensitive and whitespace-tolerant", () => {
    const result = detectFaqDuplicates([faqWith(["How To X?", "how  to x?"])]);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(2);
  });

  it("detects duplicates across multiple FAQPage blocks", () => {
    const result = detectFaqDuplicates([
      faqWith(["Same question?", "Unique A"]),
      faqWith(["Same question?", "Unique B"])
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(2);
    expect(result[0].schemaIndexes).toEqual([0, 1]);
  });

  it("ignores empty question names", () => {
    const result = detectFaqDuplicates([faqWith(["", "", "Real?"])]);
    expect(result).toEqual([]);
  });

  it("handles non-array mainEntity (single Question)", () => {
    const result = detectFaqDuplicates([
      { type: "FAQPage", raw: { "@type": "FAQPage", mainEntity: { "@type": "Question", name: "Solo?" } } }
    ]);
    expect(result).toEqual([]);
  });
});

describe("suggestMissingSchemas", () => {
  const base = { schema: [], schemaSignals: {} };

  it("returns empty when no signals + no schema", () => {
    expect(suggestMissingSchemas(base)).toEqual([]);
  });

  it("suggests WebSite + Organization or Person on homepage with nothing", () => {
    const r = suggestMissingSchemas({ url: "https://www.example.be/", schema: [], schemaSignals: { isHomepage: true } });
    const types = r.map(s => s.type);
    expect(types).toContain("WebSite");
    expect(types).toContain("Organization or Person");
  });

  it("does not suggest Organization if already present", () => {
    const r = suggestMissingSchemas({
      schema: [{ type: "Organization", raw: { "@type": "Organization", name: "X" } }],
      schemaSignals: { isHomepage: true }
    });
    expect(r.find(s => s.type === "Organization")).toBeUndefined();
  });

  it("suggests BreadcrumbList when nav present but schema missing", () => {
    const r = suggestMissingSchemas({ schema: [], schemaSignals: { hasBreadcrumb: true } });
    expect(r.find(s => s.type === "BreadcrumbList")).toBeDefined();
  });

  it("suggests Article when <article> + date/author present and no Article schema", () => {
    const r = suggestMissingSchemas({
      schema: [],
      schemaSignals: { hasArticleTag: true, hasPublishDate: true, hasAuthorByline: true }
    });
    expect(r.find(s => s.type === "Article")).toBeDefined();
  });

  it("does not suggest Article if BlogPosting already exists", () => {
    const r = suggestMissingSchemas({
      schema: [{ type: "BlogPosting", raw: { "@type": "BlogPosting" } }],
      schemaSignals: { hasArticleTag: true, hasPublishDate: true, hasAuthorByline: true }
    });
    expect(r.find(s => s.type === "Article")).toBeUndefined();
  });

  it("does not suggest FAQPage or HowTo, whose rich results Google retired", () => {
    const r = suggestMissingSchemas({ schema: [], schemaSignals: { faqQuestionCount: 3, stepsListed: true } });
    expect(r.find(s => s.type === "FAQPage")).toBeUndefined();
    expect(r.find(s => s.type === "HowTo")).toBeUndefined();
  });

  it("does not suggest Organization when an Organization subtype is present", () => {
    const r = suggestMissingSchemas({ schema: [{ raw: { "@type": "RoofingContractor" } }], schemaSignals: { isHomepage: true, hasAddress: true, hasPhone: true } });
    expect(r.find(s => s.type === "Organization")).toBeUndefined();
    expect(r.find(s => s.type === "LocalBusiness")).toBeUndefined();
  });

  it("suggests LocalBusiness when address + phone detected", () => {
    const r = suggestMissingSchemas({
      schema: [],
      schemaSignals: { hasAddress: true, hasPhone: true }
    });
    expect(r.find(s => s.type === "LocalBusiness")).toBeDefined();
  });

  it("suggests VideoObject when video embed detected", () => {
    const r = suggestMissingSchemas({ schema: [], schemaSignals: { hasVideoEmbed: true } });
    expect(r.find(s => s.type === "VideoObject")).toBeDefined();
  });

  // Google allows JobPosting only on a page with a single job posting (never a list or careers page).
  it("never suggests JobPosting from words on the page", () => {
    const r = suggestMissingSchemas({ schema: [], schemaSignals: { jobSignals: true } });
    expect(r.find(s => s.type === "JobPosting")).toBeUndefined();
  });

  it("respects priority levels", () => {
    const r = suggestMissingSchemas({
      schema: [],
      schemaSignals: { isHomepage: true, hasBreadcrumb: true, hasVideoEmbed: true }
    });
    const high = r.filter(s => s.priority === "high");
    const med = r.filter(s => s.priority === "medium");
    expect(high.length).toBeGreaterThan(0);
    expect(med.length).toBeGreaterThan(0);
  });
});

describe("collectAllSchemaTypes recursion", () => {
  it("collects nested types inside object properties", () => {
    const result = collectAllSchemaTypes([
      {
        type: "Article",
        raw: {
          "@type": "Article",
          author: { "@type": "Person", name: "X" },
          publisher: { "@type": "Organization", name: "Y", logo: { "@type": "ImageObject", url: "z" } },
          image: { "@type": "ImageObject", url: "i" }
        }
      }
    ]);
    expect(result).toContain("Article");
    expect(result).toContain("Person");
    expect(result).toContain("Organization");
    expect(result).toContain("ImageObject");
  });

  it("handles @graph array of items", () => {
    const result = collectAllSchemaTypes([
      { type: "WebPage", raw: { "@type": "WebPage" } },
      { type: "BreadcrumbList", raw: { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1 }] } }
    ]);
    expect(result).toContain("WebPage");
    expect(result).toContain("BreadcrumbList");
    expect(result).toContain("ListItem");
  });

  it("handles @type as array (multiple)", () => {
    const result = collectAllSchemaTypes([
      { type: "Article", raw: { "@type": ["Article", "BlogPosting", "NewsArticle"] } }
    ]);
    expect(result).toEqual(["Article", "BlogPosting", "NewsArticle"]);
  });

  it("dedupes types across multiple blocks", () => {
    const result = collectAllSchemaTypes([
      { type: "Person", raw: { "@type": "Person", name: "A" } },
      { type: "Person", raw: { "@type": "Person", name: "B" } }
    ]);
    expect(result).toEqual(["Person"]);
  });

  it("handles deeply nested objects", () => {
    const result = collectAllSchemaTypes([
      {
        type: "Article",
        raw: {
          "@type": "Article",
          author: {
            "@type": "Person",
            affiliation: {
              "@type": "Organization",
              address: { "@type": "PostalAddress", streetAddress: "x" }
            }
          }
        }
      }
    ]);
    expect(result).toContain("Article");
    expect(result).toContain("Person");
    expect(result).toContain("Organization");
    expect(result).toContain("PostalAddress");
  });

  it("ignores invalid JSON entries (no @type, error object)", () => {
    const result = collectAllSchemaTypes([
      { type: "Invalid JSON", raw: { error: "...", text: "..." } },
      { type: "Article", raw: { "@type": "Article" } }
    ]);
    expect(result).toEqual(["Article"]);
  });
});

describe("suggestMissingSchemas with microdata", () => {
  it("does not suggest BreadcrumbList when only microdata has it", () => {
    const r = suggestMissingSchemas({
      schema: [],
      microdataTypes: ["BreadcrumbList", "ListItem"],
      schemaSignals: { hasBreadcrumb: true }
    });
    expect(r.find(s => s.type === "BreadcrumbList")).toBeUndefined();
  });

  it("does not suggest Article when microdata has BlogPosting", () => {
    const r = suggestMissingSchemas({
      schema: [],
      microdataTypes: ["BlogPosting"],
      schemaSignals: { hasArticleTag: true, hasPublishDate: true, hasAuthorByline: true }
    });
    expect(r.find(s => s.type === "Article")).toBeUndefined();
  });

  it("does not suggest Organization when microdata has it on homepage", () => {
    const r = suggestMissingSchemas({
      schema: [],
      microdataTypes: ["Organization"],
      schemaSignals: { isHomepage: true }
    });
    expect(r.find(s => s.type === "Organization")).toBeUndefined();
  });

  it("does not suggest FAQPage when microdata FAQPage present", () => {
    const r = suggestMissingSchemas({
      schema: [],
      microdataTypes: ["FAQPage"],
      schemaSignals: { faqQuestionCount: 5 }
    });
    expect(r.find(s => s.type === "FAQPage")).toBeUndefined();
  });

  it("suggests when neither JSON-LD nor microdata has the type", () => {
    const r = suggestMissingSchemas({
      schema: [],
      microdataTypes: ["WebPage"],
      schemaSignals: { hasBreadcrumb: true }
    });
    expect(r.find(s => s.type === "BreadcrumbList")).toBeDefined();
  });

  it("combines JSON-LD nested + microdata for existence check", () => {
    const r = suggestMissingSchemas({
      schema: [{ type: "Article", raw: { "@type": "Article", publisher: { "@type": "Organization", name: "X" } } }],
      microdataTypes: ["BreadcrumbList"],
      schemaSignals: { isHomepage: true, hasBreadcrumb: true }
    });
    // Organization is nested in JSON-LD → no Organization suggestion
    expect(r.find(s => s.type === "Organization")).toBeUndefined();
    // BreadcrumbList is in microdata → no BreadcrumbList suggestion
    expect(r.find(s => s.type === "BreadcrumbList")).toBeUndefined();
  });
});
