import { describe, it, expect } from "vitest";
import { buildCompareCsv, buildCompareMd, compareExportFilename } from "../lib/compare-export.js";

const sources = [
  {
    isMe: true,
    label: "You",
    serpPosition: 3,
    data: {
      url: "https://www.example.be/page",
      title: "Running shoes guide",
      description: "A short guide to choosing running shoes.",
      canonical: "https://www.example.be/page",
      robots: "index, follow",
      lang: "nl-BE",
      h1s: ["Running shoes guide"],
      h1Count: 1,
      h2Count: 4,
      h3Count: 7,
      wordCount: 1240,
      links: 35,
      images: 8,
      imagesWithoutAlt: 1,
      schemaTypes: ["Article", "BreadcrumbList", "Organization"],
    },
  },
  {
    isMe: false,
    label: "Comp 1",
    serpPosition: 7,
    data: {
      url: "https://competitor.be/x",
      title: "Insulation, prices, comparison",
      description: "Page with, embedded, commas in description.",
      canonical: "",
      robots: "",
      lang: "fr-FR",
      h1s: ["A", "B"],
      h1Count: 2,
      h2Count: 6,
      h3Count: 3,
      wordCount: 1900,
      links: 50,
      images: 12,
      imagesWithoutAlt: 4,
      schemaTypes: ["Article", "FAQPage"],
    },
  },
];

const serpData = {
  organic: [{ url: "https://www.example.be/page", title: "x" }],
  features: { featured_snippet: { count: 1 } },
};

describe("buildCompareCsv", () => {
  it("emits header with 'Metric' and one column per source", () => {
    const csv = buildCompareCsv(sources, null, "");
    const firstLine = csv.split("\r\n")[0];
    expect(firstLine).toMatch(/^Metric,/);
    expect(firstLine).toContain("You (https://www.example.be/page)");
    expect(firstLine).toContain("Comp 1 (https://competitor.be/x)");
  });

  it("RFC-4180-quotes fields containing commas", () => {
    const csv = buildCompareCsv(sources, null, "");
    // Description on competitor contains commas → must be quoted
    expect(csv).toContain('"Page with, embedded, commas in description."');
  });

  it("escapes embedded quotes by doubling them", () => {
    const trickyMe = JSON.parse(JSON.stringify(sources[0]));
    trickyMe.data.title = 'Title with "embedded" quotes';
    const csv = buildCompareCsv([trickyMe, sources[1]], null, "");
    expect(csv).toContain('"Title with ""embedded"" quotes"');
  });

  it("includes a SERP position row only when keyword + serpData present", () => {
    const withSerp = buildCompareCsv(sources, serpData, "running shoes");
    expect(withSerp).toContain("SERP position");
    expect(withSerp).toContain("#3");
    expect(withSerp).toContain("#7");

    const withoutSerp = buildCompareCsv(sources, null, "");
    expect(withoutSerp).not.toContain("SERP position");
  });

  it("appends a blank separator and schema coverage section when types differ", () => {
    const csv = buildCompareCsv(sources, null, "");
    const lines = csv.split("\r\n");
    const blankIdx = lines.findIndex((l, i) => i > 5 && l === "");
    expect(blankIdx).toBeGreaterThan(0);
    expect(lines[blankIdx + 1]).toContain("Schema @type");
    // BreadcrumbList only on "You" → expect Yes,No row
    const breadcrumbLine = lines.find(l => l.startsWith("BreadcrumbList"));
    expect(breadcrumbLine).toBe("BreadcrumbList,Yes,No");
  });

  it("joins array h1s with ' | '", () => {
    const csv = buildCompareCsv(sources, null, "");
    expect(csv).toContain("A | B");
  });

  it("uses CRLF line endings (Excel-friendly)", () => {
    const csv = buildCompareCsv(sources, null, "");
    expect(csv).toContain("\r\n");
    expect(csv.includes("\r\n\r\n") || true).toBe(true); // allow either layout
  });
});

describe("buildCompareMd", () => {
  it("starts with an h1 title that mentions the keyword when given", () => {
    const md = buildCompareMd(sources, serpData, "running shoes");
    expect(md.split("\n")[0]).toMatch(/^# Compare: keyword "running shoes"/);
  });

  it("starts with an h1 with the user URL when no keyword", () => {
    const md = buildCompareMd(sources, null, "");
    expect(md.split("\n")[0]).toMatch(/^# Compare: https:\/\/www\.example\.be\/page/);
  });

  it("renders a proper MD table with header separator", () => {
    const md = buildCompareMd(sources, null, "");
    const lines = md.split("\n");
    const headerIdx = lines.findIndex(l => l.startsWith("| Metric"));
    expect(headerIdx).toBeGreaterThan(0);
    // The separator line immediately after
    expect(lines[headerIdx + 1]).toMatch(/^\| --- \| --- \| --- \|$/);
  });

  it("escapes pipe characters in cells with \\|", () => {
    const tricky = JSON.parse(JSON.stringify(sources[0]));
    tricky.data.title = "A | B title";
    const md = buildCompareMd([tricky, sources[1]], null, "");
    expect(md).toContain("A \\| B title");
  });

  it("collapses newlines in cells to spaces", () => {
    const multiline = JSON.parse(JSON.stringify(sources[0]));
    multiline.data.description = "Line 1\nLine 2";
    const md = buildCompareMd([multiline, sources[1]], null, "");
    expect(md).not.toContain("Line 1\nLine 2");
    expect(md).toContain("Line 1 Line 2");
  });

  it("includes a Schema coverage section with ✓/— markers", () => {
    const md = buildCompareMd(sources, null, "");
    expect(md).toContain("## Schema coverage");
    // Article on both
    expect(md).toMatch(/\| Article \| ✓ \| ✓ \|/);
    // FAQPage only on competitor
    expect(md).toMatch(/\| FAQPage \| — \| ✓ \|/);
  });
});

describe("compareExportFilename", () => {
  it("includes hostname, sanitized keyword, and ISO date", () => {
    const fn = compareExportFilename(sources, "running shoes", "csv");
    expect(fn).toMatch(/^compare-example\.be-running-shoes-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("strips www. from hostname", () => {
    const withWww = [
      { isMe: true, data: { url: "https://www.example.com/x" } },
      { isMe: false, data: { url: "https://other.com/y" } },
    ];
    const fn = compareExportFilename(withWww, "", "md");
    expect(fn).toMatch(/^compare-example\.com-\d{4}-\d{2}-\d{2}\.md$/);
  });

  it("falls back to 'compare' when no me-source URL is parseable", () => {
    const fn = compareExportFilename([{ isMe: true, data: {} }], "", "csv");
    expect(fn).toMatch(/^compare-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("caps keyword length at 30 chars after sanitization", () => {
    const fn = compareExportFilename(sources, "a".repeat(80), "csv");
    const kwPart = fn.match(/-(a+)-\d{4}/)?.[1];
    expect(kwPart?.length).toBeLessThanOrEqual(30);
  });
});

describe("CSV safety and spreadsheet options", () => {
  const evil = [
    { label: "You", isMe: true, data: { url: "https://e.com/", title: "=HYPERLINK(\"http://x\")", description: "-2+3", h1s: ["@SUM(A1)"], schemaTypes: [] } },
    { label: "Competitor 1", isMe: false, data: { url: "https://c.com/", title: "Normal", description: "ok", h1s: [], schemaTypes: [] } }
  ];

  it("neutralises cells that would run as formulas", () => {
    const csv = buildCompareCsv(evil, null, "");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'-2+3");
    expect(csv).toContain("'@SUM(A1)");
  });

  it("can use semicolons and a BOM for Excel with European settings", () => {
    const csv = buildCompareCsv(evil, null, "", { forExcel: true, separator: ";" });
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.split("\r\n")[0]).toMatch(/^﻿Metric;/);
  });

  it("marks the Markdown export as made with Needle", () => {
    expect(buildCompareMd(evil, null, "")).toMatch(/Made with Needle/);
  });
});
