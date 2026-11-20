import { describe, it, expect, beforeAll } from "vitest";
import { JSDOM } from "jsdom";
import { parseCompetitorHtml } from "../lib/parse-competitor.js";

let DOMParserImpl;
beforeAll(() => {
  // jsdom doesn't expose DOMParser globally — pull it out of a window.
  DOMParserImpl = new JSDOM("").window.DOMParser;
});

const parse = (html, url = "https://example.com/") =>
  parseCompetitorHtml(html, url, DOMParserImpl);

describe("parseCompetitorHtml", () => {
  it("extracts title", () => {
    const r = parse("<html><head><title>Hello world</title></head><body></body></html>");
    expect(r.title).toBe("Hello world");
    expect(r.titleLen).toBe(11);
  });

  it("extracts description from meta name=description (double quotes)", () => {
    const r = parse('<html><head><meta name="description" content="A short blurb"></head><body></body></html>');
    expect(r.description).toBe("A short blurb");
    expect(r.descLen).toBe(13);
  });

  it("extracts description from single-quoted attribute (regex would break)", () => {
    const r = parse("<html><head><meta name='description' content='Single-quoted desc'></head><body></body></html>");
    expect(r.description).toBe("Single-quoted desc");
  });

  it("extracts description split across multiple lines (regex would break)", () => {
    const html = `<html><head><meta
      name="description"
      content="Multi-line attribute"
    ></head><body></body></html>`;
    const r = parse(html);
    expect(r.description).toBe("Multi-line attribute");
  });

  it("ignores attribute order (name after content)", () => {
    const r = parse('<html><head><meta content="Out of order" name="description"></head><body></body></html>');
    expect(r.description).toBe("Out of order");
  });

  it("extracts canonical, robots, lang, og:title", () => {
    const html = `<html lang="nl-BE"><head>
      <link rel="canonical" href="https://example.com/x">
      <meta name="robots" content="index,follow">
      <meta property="og:title" content="OG headline">
    </head><body></body></html>`;
    const r = parse(html);
    expect(r.canonical).toBe("https://example.com/x");
    expect(r.robots).toBe("index,follow");
    expect(r.lang).toBe("nl-BE");
    expect(r.ogTitle).toBe("OG headline");
  });

  it("counts H1/H2/H3", () => {
    const html = "<html><body><h1>One</h1><h2>A</h2><h2>B</h2><h3>x</h3><h3>y</h3><h3>z</h3></body></html>";
    const r = parse(html);
    expect(r.h1s).toEqual(["One"]);
    expect(r.h1Count).toBe(1);
    expect(r.h2Count).toBe(2);
    expect(r.h3Count).toBe(3);
  });

  it("counts links and images, images-with-alt", () => {
    const html = `<html><body>
      <a href="/x">a</a><a href="/y">b</a><a>no-href</a>
      <img src="/a.jpg" alt="ok">
      <img src="/b.jpg">
    </body></html>`;
    const r = parse(html);
    expect(r.links).toBe(2);
    expect(r.images).toBe(2);
    expect(r.imagesWithAlt).toBe(1);
    expect(r.imagesWithoutAlt).toBe(1);
  });

  it("extracts schema @type from JSON-LD (single object)", () => {
    const html = `<html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Article","headline":"x"}
    </script></head><body></body></html>`;
    const r = parse(html);
    expect(r.schemaTypes).toContain("Article");
  });

  it("extracts schema @type from JSON-LD @graph", () => {
    const html = `<html><head><script type="application/ld+json">
      {"@graph":[{"@type":"Organization"},{"@type":"WebSite"}]}
    </script></head><body></body></html>`;
    const r = parse(html);
    expect(r.schemaTypes.sort()).toEqual(["Organization", "WebSite"]);
  });

  it("extracts schema @type when @type is array", () => {
    const html = `<html><head><script type="application/ld+json">
      {"@type":["Article","BlogPosting"]}
    </script></head><body></body></html>`;
    const r = parse(html);
    expect(r.schemaTypes.sort()).toEqual(["Article", "BlogPosting"]);
  });

  it("ignores invalid JSON-LD gracefully", () => {
    const html = `<html><head><script type="application/ld+json">{not-valid}</script></head><body></body></html>`;
    const r = parse(html);
    expect(r.schemaTypes).toEqual([]);
  });

  it("word count excludes script/style", () => {
    const html = `<html><body>
      <script>var hidden = "this should not count";</script>
      <style>.x { color: red; }</style>
      <p>Visible words here only.</p>
    </body></html>`;
    const r = parse(html);
    expect(r.wordCount).toBe(4); // "Visible words here only"
  });

  it("returns 0 word count for empty body", () => {
    const r = parse("<html><body></body></html>");
    expect(r.wordCount).toBe(0);
  });

  it("decodes HTML entities natively (regex would emit &amp;)", () => {
    const r = parse("<html><head><title>Tom &amp; Jerry</title></head><body></body></html>");
    expect(r.title).toBe("Tom & Jerry");
  });

  it("base URL is echoed back", () => {
    const r = parse("<html></html>", "https://comp.example/foo");
    expect(r.url).toBe("https://comp.example/foo");
  });
});
