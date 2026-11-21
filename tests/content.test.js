// Tests for content.js, the script the popup injects into the audited page.
// They run the real file in jsdom (tests/helpers/content-harness.js). Known gaps
// that are not fixed yet stay as it.todo (none at the moment).
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { loadContentScript, analyze, html } from "./helpers/content-harness.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/pages/${name}`, import.meta.url), "utf8");
// The edge-case page has a <base href> and a relative canonical, so its URL matters.
const EDGE_URL = "https://www.example.be/fr-be/atelier/velo/";

// Every page is closed after the test that opened it, so jsdom timers don't linger.
const opened = [];
async function load(page, options) {
  const loaded = await loadContentScript(page, options);
  opened.push(loaded);
  return loaded;
}
afterEach(() => {
  vi.useRealTimers();
  while (opened.length) opened.pop().window.close();
});

describe("message contract", () => {
  // Only fields something reads. Left out on purpose, because popup.js and lib/ read
  // none of them: imagesByContext, images[].lazy and .aboveFold, and
  // schemaSignals.hasPricing and .hasCartButton.
  it("ANALYZE_ONPAGE keeps every field the popup reads", async () => {
    const res = await analyze(fixture("landing-nl-be.html"));
    const has = (obj, keys) => expect(Object.keys(obj)).toEqual(expect.arrayContaining(keys));

    has(res, [
      "url", "title", "description", "keywords", "canonical", "robots", "lang", "viewport",
      "publisherMeta", "og", "twitter", "headings", "links", "images", "schema",
      "microdataTypes", "hreflang", "wordCount", "mainContentWordCount", "mainContentSelector", "textRatio",
      "authorMeta", "authorByline", "publishedMeta", "modifiedMeta", "externalLinkCount", "listCount",
      "tableCount", "schemaSignals", "canonicalOutsideHead", "canonicalDistinct", "hreflangOutsideHead"
    ]);
    has(res.og, ["title", "description", "image", "imageWidth", "imageHeight", "type", "url", "siteName"]);
    has(res.twitter, ["card", "title", "description", "image", "site"]);
    has(res.links, ["internal", "external", "nofollow", "broken", "total", "byContext", "details"]);
    has(res.links.details[0], ["index", "href", "text", "internal", "external", "nofollow", "ugc", "sponsored", "broken", "context"]);
    has(res.images[0], [
      "domIndex", "src", "alt", "naturalWidth", "naturalHeight", "displayedWidth", "displayedHeight",
      "format", "bytes", "altMissing", "oversized", "downscaled", "lazyAboveFold", "brokenLoad", "context",
      "isBackground"
    ]);
    has(res.schema[0], ["type", "raw"]);
    has(res.hreflang[0], ["lang", "href"]);
    has(res.headings[0], ["level", "text"]);
    has(res.schemaSignals, [
      "hasBreadcrumb", "hasVideoEmbed", "hasArticleTag", "faqQuestionCount", "hasRating", "hasAddress",
      "hasPhone", "hasOpeningHours", "hasAuthorByline", "hasPublishDate", "isHomepage", "ingredientHints",
      "stepsListed", "jobSignals"
    ]);
    expect(Object.keys(res.links.byContext)).toEqual(["header", "nav", "breadcrumb", "main", "sidebar", "footer", "other"]);
    expect(res).not.toHaveProperty("techSignals");
  });

  it("GET_RENDERED returns the counts the raw-vs-rendered comparison uses", async () => {
    const page = await load(fixture("landing-nl-be.html"));
    const rendered = await page.send({ type: "GET_RENDERED" });
    const analysed = await page.send({ type: "ANALYZE_ONPAGE" });

    expect(Object.keys(rendered)).toEqual(expect.arrayContaining(["htmlLen", "wordCount", "headings", "links", "schema"]));
    expect(rendered.htmlLen).toBe(page.document.documentElement.outerHTML.length);
    // Every a[href] counts, '#faq' included, like the raw-HTML count in lib/technical.js.
    expect(rendered).toMatchObject({ headings: 8, links: 15, schema: 1 });
    // Words are counted in the HTML the same way lib/technical.js counts the server HTML,
    // so the two columns of the rendering card compare like with like.
    const { extractWordCount } = await import("../lib/technical.js");
    expect(rendered.wordCount).toBe(extractWordCount(page.document.documentElement.outerHTML));
    expect(analysed.wordCount).toBeGreaterThan(0);
  });

  it("does not answer messages meant for the background", async () => {
    const page = await load(fixture("nearly-empty.html"));
    await expect(page.send({ type: "FETCH_RAW", url: "https://www.example.be/" })).resolves.toBeUndefined();
  });

  it("survives a second injection into the same page and still answers", async () => {
    const page = await load(fixture("nearly-empty.html"));
    const src = readFileSync(new URL("../content.js", import.meta.url), "utf8");
    expect(() => page.window.eval(src)).not.toThrow();
    await expect(page.send({ type: "UNHIGHLIGHT_ISSUES" })).resolves.toEqual({ ok: true });
  });
});

describe("ANALYZE_ONPAGE on the well-formed nl-BE landing page", () => {
  let res;
  beforeAll(async () => {
    res = await analyze(fixture("landing-nl-be.html"));
  });

  it("reads the head metadata", () => {
    expect(res).toMatchObject({
      url: "https://www.example.be/nl-be/page/",
      title: "Fietsherstel: prijzen van fietsenmakers vergelijken | Example",
      description: "Vergelijk prijzen van fietsenmakers uit je regio en kies zelf met wie je verdergaat.",
      canonical: "https://www.example.be/nl-be/page/",
      robots: "index, follow",
      lang: "nl-BE",
      viewport: "width=device-width, initial-scale=1",
      keywords: ""
    });
  });

  // toMatchObject, so collecting more tags (see the todo below) does not break this.
  it("reads Open Graph and Twitter tags", () => {
    expect(res.og).toMatchObject({
      title: "Fietsherstel: prijzen vergelijken",
      description: "Vergelijk prijzen van fietsenmakers uit je regio.",
      image: "https://www.example.be/img/og-fietsherstel.jpg",
      imageWidth: 1200,
      imageHeight: 630,
      type: "website",
      url: "https://www.example.be/nl-be/page/",
      siteName: "Example"
    });
    expect(res.twitter).toMatchObject({
      card: "summary_large_image",
      title: "Fietsherstel: prijzen vergelijken",
      image: "https://www.example.be/img/og-fietsherstel.jpg"
    });
  });

  it("reads twitter:description and twitter:site when present", async () => {
    const r = await analyze(html("", '<meta name="twitter:description" content="Korte tekst"><meta name="twitter:site" content="@example">'));
    expect(r.twitter).toMatchObject({ description: "Korte tekst", site: "@example" });
  });

  it("lists headings in document order with their levels", () => {
    expect(res.headings.map(({ level, text }) => ({ level, text }))).toEqual([
      { level: 1, text: "Fietsherstel: prijzen vergelijken" },
      { level: 2, text: "Hoe werkt het?" },
      { level: 3, text: "Stap 1: beschrijf je project" },
      { level: 3, text: "Stap 2: vergelijk de prijzen" },
      { level: 2, text: "Veelgestelde vragen" },
      { level: 3, text: "Wat kost een nieuwe ketting?" },
      { level: 3, text: "Hoe snel krijg ik een afspraak?" },
      { level: 2, text: "Ook interessant" }
    ]);
  });

  it("lists the hreflang alternates", () => {
    expect(res.hreflang).toEqual([
      { lang: "nl-BE", href: "https://www.example.be/nl-be/page/" },
      { lang: "fr-BE", href: "https://www.example.be/fr-be/page/" },
      { lang: "nl-NL", href: "https://www.example.nl/page/" },
      { lang: "x-default", href: "https://www.example.be/" }
    ]);
  });

  it("parses each JSON-LD @graph item and gives it the graph's @context", () => {
    expect(res.schema.map((s) => s.type)).toEqual(["BreadcrumbList", "FAQPage"]);
    for (const { raw } of res.schema) expect(raw["@context"]).toBe("https://schema.org");
    expect(res.schema[0].raw.itemListElement).toHaveLength(3);
    expect(res.schema[1].raw.mainEntity.map((q) => q.name)).toEqual(["Wat kost een nieuwe ketting?", "Hoe snel krijg ik een afspraak?"]);
    expect(res.microdataTypes).toEqual([]);
  });

  it("counts internal and external links and skips links to a fragment of the page itself", () => {
    expect(res.links).toMatchObject({ internal: 9, external: 5, nofollow: 2, total: 14 });
    expect(res.externalLinkCount).toBe(5);
    expect(res.links.details.map((l) => l.index)).toEqual([...Array(14).keys()]);
    expect(res.links.details.map((l) => l.text)).not.toContain("Terug naar de vragen");
  });

  it("gives absolute hrefs and reads rel=nofollow (in any case), sponsored and ugc", () => {
    const link = (href) => res.links.details.find((l) => l.href === href);
    expect(link("https://www.example.be/nl-be/afspraak/fietsherstel/"))
      .toMatchObject({ text: "Maak een afspraak", internal: true, nofollow: false, sponsored: false, ugc: false });
    expect(link("https://www.example.org/fietsverlichting")).toMatchObject({ internal: false, nofollow: false });
    expect(link("https://partner.example.com/banden")).toMatchObject({ internal: false, nofollow: true });
    expect(link("https://ads.example.net/premie")).toMatchObject({ sponsored: true, nofollow: false });
    expect(link("https://forum.example.org/topic/42")).toMatchObject({ ugc: true, nofollow: true });
  });

  it("puts each link in the page region it sits in", () => {
    expect(res.links.details.map((l) => l.context)).toEqual([
      "header", "nav", "nav", "nav", "breadcrumb", "breadcrumb",
      "main", "main", "main", "main", "main", "sidebar", "footer", "footer"
    ]);
    expect(res.links.byContext).toEqual({ header: 1, nav: 3, breadcrumb: 2, main: 5, sidebar: 1, footer: 2, other: 0 });
  });

  it("lists images with alt text, declared size, lazy flag, format and region, none broken while loading", () => {
    const summary = ({ alt, naturalWidth, naturalHeight, lazy, format, context, isBackground }) =>
      ({ alt, naturalWidth, naturalHeight, lazy, format, context, isBackground });
    const [logo, hero, decorative, noAlt, team] = res.images;

    expect(res.images.map((i) => i.domIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(logo.src).toBe("https://www.example.be/img/logo.svg");
    expect(summary(logo)).toEqual({ alt: "Example", naturalWidth: 120, naturalHeight: 32, lazy: false, format: "svg", context: "header", isBackground: false });
    // With srcset Chrome reports the candidate it picked; either one is right.
    expect(hero.src).toMatch(/^https:\/\/www\.example\.be\/img\/fietsenmaker-(800|1600)\.jpg$/);
    expect(summary(hero)).toEqual({ alt: "Fietsenmaker vervangt een ketting", naturalWidth: 1600, naturalHeight: 900, lazy: false, format: "jpg", context: "main", isBackground: false });
    // alt="" marks a decorative image.
    expect(summary(decorative)).toMatchObject({ alt: "", lazy: false, format: "png", context: "main" });
    expect(noAlt).toMatchObject({ src: "https://www.example.be/img/schema-fiets.webp", naturalWidth: 600, naturalHeight: 400, format: "webp" });
    expect(summary(team)).toEqual({ alt: "Het klantenteam", naturalWidth: 400, naturalHeight: 300, lazy: true, format: "jpg", context: "main", isBackground: false });
    // jsdom never finishes loading an image (complete stays false), like an image still loading in Chrome: not broken.
    expect(res.images.map((i) => i.brokenLoad)).toEqual([false, false, false, false, false]);
  });

  it("counts words on the page and in <main>", () => {
    expect(res.mainContentSelector).toBe("main");
    expect(res.mainContentWordCount).toBeGreaterThan(50);
    expect(res.wordCount).toBeGreaterThan(res.mainContentWordCount);
    expect(res.textRatio).toBeGreaterThan(0);
    expect(res).toMatchObject({ listCount: 1, tableCount: 0 });
  });

  it("derives schema signals", () => {
    expect(res.schemaSignals).toMatchObject({
      hasBreadcrumb: true, faqQuestionCount: 3, stepsListed: true, hasArticleTag: false, isHomepage: false
    });
  });
});

describe("ANALYZE_ONPAGE on the fr-BE edge-case page", () => {
  let res;
  beforeAll(async () => {
    res = await analyze(fixture("edge-cases-fr-be.html"), { url: EDGE_URL });
  });

  it("takes the title from <title>, not from the inline SVG's <title>", async () => {
    expect(res.title).toBe("Vélo : comparez des ateliers | Example");
    expect(res.lang).toBe("fr-BE");
    // With an SVG <title> as the only one, the page has no title (document.title is "" in Chrome too).
    expect((await analyze(html("<h1><svg><title>Icône vélo</title></svg>Vélo</h1>"))).title).toBe("");
  });

  it("resolves relative and protocol-relative links against <base href>", () => {
    const link = (text) => res.links.details.find((l) => l.text === text);
    expect(link("Demander un rendez-vous")).toMatchObject({ href: "https://www.example.be/fr-be/rendez-vous/", internal: true });
    expect(link("Contact")).toMatchObject({ href: "https://www.example.be/fr-be/contact/", internal: true });
    expect(link("Guide PDF")).toMatchObject({ href: "https://cdn.example.net/guide-velo.pdf", internal: false });
  });

  // href="#" and href="" are left to the broken-links todo below.
  it("skips links to a fragment of the page itself", () => {
    expect(res.links.details.map((l) => l.text)).not.toContain("FAQ");
  });

  // Google's Rich Results Test ignores comments in JSON-LD, but its help says the JSON-LD
  // standard does not support them and they should be removed before publishing
  // (https://support.google.com/webmasters/answer/7445569), so "Invalid JSON" is right.
  it("reports unparsable JSON-LD, including JSON-LD wrapped in an HTML comment, instead of dropping it", () => {
    expect(res.schema.map((s) => s.type)).toEqual(["Invalid JSON", "Invalid JSON"]);
    const [trailingComma, commented] = res.schema.map((s) => s.raw);
    expect(trailingComma.text).toContain('"name": "Example",}');
    expect(commented.text.startsWith("<!--")).toBe(true);
    for (const raw of [trailingComma, commented]) expect(raw.error).toEqual(expect.any(String));
  });

  it("lists CSS background images, skipping gradients, data: URLs and URLs already listed as img elements", () => {
    expect(res.images.filter((i) => i.isBackground).map(({ src, format, alt }) => ({ src, format, alt }))).toEqual([
      { src: "https://www.example.be/img/velo-hero.jpg", format: "jpg", alt: "" },
      { src: "https://www.example.be/img/promo.png", format: "png", alt: "" }
    ]);
    expect(res.images.filter((i) => i.src === "https://www.example.be/img/velo.jpg")).toHaveLength(1);
  });

  it("sees the phone link", () => {
    // The link text ("Appelez-nous") has no digits, so only the tel: link can set this.
    expect(res.schemaSignals.hasPhone).toBe(true);
  });

  it("GET_RENDERED counts every heading and a[href], hidden or hash-only, like the raw-HTML count", async () => {
    const page = await load(fixture("edge-cases-fr-be.html"), { url: EDGE_URL });
    await expect(page.send({ type: "GET_RENDERED" })).resolves.toMatchObject({ headings: 3, links: 9, schema: 2 });
  });

  it("reads every robots and googlebot meta, in any case", () => {
    expect(res.robots).toBe("NOINDEX, index, follow, noindex, nofollow");
  });
  it("flags metadata that an invalid head element (the img here) pushed into <body>", () => {
    expect(res.descriptionOutsideHead).toBe(true);
    expect(res.hreflangOutsideHead).toBe(1);
    expect(res.hreflang).toEqual([]);
  });
  it("resolves a relative canonical against <base href>", () => {
    expect(res.canonical).toBe("https://www.example.be/fr-be/atelier/velo/");
  });
  it("does not count mailto:, tel: and javascript: links as internal or external", () => {
    const other = res.links.details.filter((l) => /^(mailto|tel|javascript):/.test(l.href));
    expect(other).toHaveLength(3);
    expect(other.every((l) => !l.internal && !l.external)).toBe(true);
    expect(res.links.external).toBe(1);
  });
  it("reports a link with an empty href as broken", () => {
    expect(res.links.broken).toBe(1);
    expect(res.links.details.find((l) => l.broken).text).toBe("Lien vide");
  });
  it("marks hidden headings (hidden attribute, display:none)", () => {
    expect(res.headings.map((h) => h.hidden)).toEqual([false, true, true]);
  });
  it("keeps the inline SVG's <title> out of the heading text", () => {
    expect(res.headings[0].text).toBe("Vélo : comparez des ateliers");
  });
});

describe("ANALYZE_ONPAGE on a nearly empty page", () => {
  it("returns empty values instead of failing", async () => {
    const res = await analyze(fixture("nearly-empty.html"));
    expect(res).toMatchObject({
      title: "", description: "", canonical: "", robots: "", lang: "", viewport: "", keywords: "",
      headings: [], images: [], schema: [], hreflang: [], microdataTypes: [],
      wordCount: 1, mainContentWordCount: null, mainContentSelector: null,
      authorMeta: "", authorByline: "", publishedMeta: "", modifiedMeta: "",
      externalLinkCount: 0, listCount: 0, tableCount: 0
    });
    expect(res.links).toMatchObject({ internal: 0, external: 0, nofollow: 0, broken: 0, total: 0, details: [] });
    expect(res.og).toMatchObject({ title: "", description: "", image: "", imageWidth: 0, imageHeight: 0, type: "", url: "", siteName: "" });
    expect(Object.values(res.schemaSignals).filter(Boolean)).toEqual([]);
  });

  it("GET_RENDERED returns zero counts", async () => {
    const page = await load(fixture("nearly-empty.html"));
    await expect(page.send({ type: "GET_RENDERED" })).resolves.toMatchObject({ wordCount: 1, headings: 0, links: 0, schema: 0 });
  });

  it("recognises market home pages by their path", async () => {
    for (const [url, isHomepage] of [
      ["https://www.example.be/", true],
      ["https://www.example.be/fr-be/", true],
      ["https://www.example.nl/nl-nl/", true],
      ["https://www.example.be/nl-be/page/", false]
    ]) {
      expect((await analyze(fixture("nearly-empty.html"), { url })).schemaSignals.isHomepage, url).toBe(isHomepage);
    }
  });
});

describe("ANALYZE_ONPAGE details", () => {
  it("counts rendered words only and prefers <main> unless another container holds twice as many words", async () => {
    const res = await analyze(html(
      "<main><p>een twee drie</p><p hidden>verborgen</p><script>var verborgen = 1;</script></main><footer><p>vier vijf</p></footer>"
    ));
    expect(res).toMatchObject({ wordCount: 5, mainContentWordCount: 3, mainContentSelector: "main" });

    const articles = await analyze(html("<article><p>een twee</p></article><article><p>drie vier vijf</p></article>"));
    expect(articles).toMatchObject({ mainContentWordCount: 5, mainContentSelector: "article × 2" });

    // <main> holds at least half the words of the wordiest candidate, so it wins over an outer wrapper.
    const wrapper = await analyze(html('<main><p>een twee drie</p></main><div class="entry-content"><p>een twee drie vier vijf</p></div>'));
    expect(wrapper).toMatchObject({ mainContentWordCount: 3, mainContentSelector: "main" });

    const entry = await analyze(html('<main><p>een</p></main><div class="entry-content"><p>een twee drie vier vijf</p></div>'));
    expect(entry).toMatchObject({ mainContentWordCount: 5, mainContentSelector: ".entry-content" });
  });

  it("counts the answers in a closed <details> FAQ, which innerText leaves out", async () => {
    const res = await analyze(html("<main><details><summary>Wat kost een ketting?</summary><p>Tussen 20 en 40 euro per ketting.</p></details></main>"));
    expect(res.mainContentWordCount).toBeGreaterThanOrEqual(11);
  });

  it("lists all six heading levels", async () => {
    const page = await load(html("<h1>Een</h1><h2>Twee</h2><h3>Drie</h3><h4>Vier</h4><h5>Vijf</h5><h6>Zes</h6>"));
    const res = await page.send({ type: "ANALYZE_ONPAGE" });
    expect(res.headings.map((h) => h.level)).toEqual([1, 2, 3, 4, 5, 6]);
    await expect(page.send({ type: "GET_RENDERED" })).resolves.toMatchObject({ headings: 6 });
  });

  it("trims heading text to 200 and link text to 100 characters", async () => {
    const res = await analyze(html(`<h2>  ${"k".repeat(250)}  </h2><a href="/x">  ${"l".repeat(150)}  </a>`));
    expect(res.headings[0].text).toBe("k".repeat(200));
    expect(res.links.details[0].text).toBe("l".repeat(100));
  });

  it("joins @type arrays, reads top-level JSON-LD arrays and lists microdata types once", async () => {
    const res = await analyze(html(
      '<div itemscope itemtype="https://schema.org/Product"></div>' +
      '<div itemscope itemtype="http://schema.org/BreadcrumbList"></div>' +
      '<div itemscope itemtype="https://schema.org/Product"></div>',
      '<script type="application/ld+json">[{"@context": "https://schema.org", "@type": ["Product", "Thing"]}, ' +
      '{"@context": "https://schema.org", "@type": "Offer"}]</script>'
    ));
    expect(res.schema.map((s) => s.type)).toEqual(["Product, Thing", "Offer"]);
    expect(res.microdataTypes).toEqual(["BreadcrumbList", "Product"]);
  });

  it("reads the author and the publication dates", async () => {
    const res = await analyze(html(
      '<article><p class="byline">Door de redactie</p></article>',
      '<meta name="author" content="Redactie Example">' +
      '<meta property="article:published_time" content="2026-10-01T08:00:00+02:00">' +
      '<meta property="article:modified_time" content="2026-10-10T09:30:00+02:00">'
    ));
    expect(res).toMatchObject({
      authorMeta: "Redactie Example",
      authorByline: "Door de redactie",
      publishedMeta: "2026-10-01T08:00:00+02:00",
      modifiedMeta: "2026-10-10T09:30:00+02:00"
    });

    const fromTime = await analyze(html(
      '<time itemprop="datePublished" datetime="2026-10-01">1 oktober</time><time itemprop="dateModified" datetime="2026-10-10">10 oktober</time>'
    ));
    expect(fromTime).toMatchObject({ publishedMeta: "2026-10-01", modifiedMeta: "2026-10-10" });
  });

  it("raises the schema signals a page gives reason for", async () => {
    const res = await analyze(html(`<nav aria-label="breadcrumb"><a href="/">Home</a></nav><article>
      <h2>Wat kost een ketting?</h2><h3>Hoe lang duurt het?</h3>
      <p>Vanaf € 1.250 per fiets. Beoordeeld met 4,5/5.</p>
      <iframe src="https://www.youtube.com/embed/voorbeeld"></iframe>
      <button class="add-to-cart">In winkelwagen</button>
      <address>Voorbeeldstraat 1, 9000 Gent</address>
      <a href="tel:+3290000000">09 000 00 00</a>
      <p>Open van maandag tot vrijdag, van 9u tot 17u.</p>
      <p class="byline">Door de redactie</p><time datetime="2026-10-01">1 oktober</time>
      <p>Vacature: fietsenmaker.</p></article>`));
    expect(res.schemaSignals).toMatchObject({
      hasBreadcrumb: true, hasVideoEmbed: true, hasArticleTag: true, faqQuestionCount: 2, hasPricing: true,
      hasCartButton: true, hasRating: true, hasAddress: true, hasPhone: true, hasOpeningHours: true,
      hasAuthorByline: true, hasPublishDate: true, jobSignals: true
    });
  });

  it("falls back to the position on the page for links outside any landmark", async () => {
    const page = await load(html(
      '<div><a href="/boven" data-test-rect="10,10,80,20">boven</a></div>' +
      '<div><a href="/midden" data-test-rect="10,1500,80,20">midden</a></div>' +
      '<div><a href="/onder" data-test-rect="10,2900,80,20">onder</a></div>'
    ));
    page.document.body.setAttribute("data-test-rect", "0,0,1366,3000");
    const res = await page.send({ type: "ANALYZE_ONPAGE" });
    expect(res.links.details.map((l) => l.context)).toEqual(["header", "other", "footer"]);

    // The page height is measured again on every analysis: the page has grown since.
    page.document.body.setAttribute("data-test-rect", "0,0,1366,6000");
    const grown = await page.send({ type: "ANALYZE_ONPAGE" });
    expect(grown.links.details.map((l) => l.context)).toEqual(["header", "other", "other"]);
  });

  it("puts a <main> link with class 'btn-secondary' or 'sidebar-toggle' in main", async () => {
    const res = await analyze(html('<main><p>tekst</p><a class="btn-secondary" href="/a">A</a><a class="sidebar-toggle" href="/b">B</a></main>'));
    expect(res.links.details.map((l) => l.context)).toEqual(["main", "main"]);
  });
  it("finds the visible byline when a <link rel=\"author\"> in <head> comes first", async () => {
    const res = await analyze(html('<p class="byline">Door An Peeters</p>', '<link rel="author" href="/humans.txt">'));
    expect(res.authorByline).toBe("Door An Peeters");
  });

  it("detects prices with € after the amount", async () => {
    expect((await analyze(html("<p>Prijs: 1.250 €</p>"))).schemaSignals.hasPricing).toBe(true);
    expect((await analyze(html("<p>Prijs: 1.250,00 €</p>"))).schemaSignals.hasPricing).toBe(true);
  });

  it("reads Belgian postcodes that look like years, and skips counts, date ranges and loose times", async () => {
    const yes = await analyze(html("<p>Kerkstraat 12, 2000 Antwerpen</p><p>Ma-vr 9:00 - 17:30</p><p>Bel 0470/12.34.56</p>"));
    expect(yes.schemaSignals).toMatchObject({ hasAddress: true, hasOpeningHours: true, hasPhone: true });
    const no = await analyze(html(
      "<p>Über 1500 Kunden vertrauen uns.</p><p>Actie geldig van 14.10.2026 - 20.11.2026.</p>" +
      "<p>Our tool is open source. Support 24h a day, version 1:2.</p>"));
    expect(no.schemaSignals).toMatchObject({ hasAddress: false, hasOpeningHours: false, hasPhone: false });
  });

  it("does not read a year before a word as an address, or a dotted date as a phone number", async () => {
    const res = await analyze(html("<p>In 2026 kiezen veel mensen voor een e-bike. Bijgewerkt op 14.10.2026.</p>"));
    expect(res.schemaSignals).toMatchObject({ hasAddress: false, hasPhone: false });
    const real = await analyze(html("<p>Molenstraat 12, 9000 Gent. Bel 09 123 45 67.</p>"));
    expect(real.schemaSignals).toMatchObject({ hasAddress: true, hasPhone: true });
  });

});

describe("ANALYZE_ONPAGE images: layout, bytes and load state", () => {
  it("flags lazy images above the fold, partly visible ones too, and images shown at under half their declared width", async () => {
    const res = await analyze(html(`<main>
      <img src="/img/hero.jpg" alt="a" loading="lazy" width="1200" height="630" data-test-rect="0,100,375,197">
      <img src="/img/half.jpg" alt="b" loading="lazy" width="400" height="300" data-test-rect="0,500,375,281">
      <img src="/img/onder.jpg" alt="c" loading="lazy" width="400" height="300" data-test-rect="0,1800,375,281">
      <div style="background-image: url(/img/achtergrond.jpg)" data-test-rect="0,0,375,200"></div></main>`),
    { viewport: { width: 375, height: 667 } });
    const [hero, straddling, below, background] = res.images;
    expect(hero).toMatchObject({ aboveFold: true, lazyAboveFold: true, displayedWidth: 375, downscaled: true });
    // Its top 167 px show in the 667 px viewport.
    expect(straddling).toMatchObject({ aboveFold: true, lazyAboveFold: true });
    expect(below).toMatchObject({ aboveFold: false, lazyAboveFold: false, downscaled: false });
    expect(background).toMatchObject({ isBackground: true, displayedWidth: 375, displayedHeight: 200 });
  });

  it("measures above the fold from the top of the page, not the current scroll position", async () => {
    const page = await load(html('<img src="/a.jpg" alt="a" loading="lazy" data-test-rect="0,-1900,375,200"><img src="/b.jpg" alt="b" loading="lazy" data-test-rect="0,100,375,200">'), { viewport: { width: 375, height: 667 } });
    // Scrolled 2000 px down: rects are viewport-relative, as in Chrome.
    page.window.scrollY = 2000;
    const res = await page.send({ type: "ANALYZE_ONPAGE" });
    expect(res.images.map((i) => i.aboveFold)).toEqual([true, false]);
  });

  it("takes image bytes from resource timing's encodedBodySize, never transferSize (300 bytes for a 304)", async () => {
    const res = await analyze(html('<img src="/img/groot.jpg" alt="a"><img src="/img/klein.png" alt="b">'), {
      resourceEntries: [
        { name: "https://www.example.be/img/groot.jpg", initiatorType: "img", transferSize: 300, encodedBodySize: 249000, decodedBodySize: 250000 },
        { name: "https://www.example.be/img/klein.png", initiatorType: "img", transferSize: 0, encodedBodySize: 5000, decodedBodySize: 5000 }
      ]
    });
    expect(res.images.map(({ bytes, oversized }) => ({ bytes, oversized })))
      .toEqual([{ bytes: 249000, oversized: true }, { bytes: 5000, oversized: false }]);
  });

  it("marks an image that finished loading without pixels as broken", async () => {
    const page = await load(html('<img src="/img/kapot.jpg" alt="a">'));
    // jsdom never loads images: make it "finished" with naturalWidth 0, as a failed load in Chrome.
    Object.defineProperty(page.document.images[0], "complete", { value: true });
    const res = await page.send({ type: "ANALYZE_ONPAGE" });
    expect(res.images[0].brokenLoad).toBe(true);
  });

  it("flags a lazy image whose load failed, but not one still waiting to load", async () => {
    const page = await load(html('<img src="/img/kapot.jpg" alt="a" loading="lazy"><img src="/img/wacht.jpg" alt="b" loading="lazy">'));
    Object.defineProperty(page.document.images[0], "complete", { value: true });
    Object.defineProperty(page.document.images[1], "complete", { value: false });
    const res = await page.send({ type: "ANALYZE_ONPAGE" });
    expect(res.images.map((i) => i.brokenLoad)).toEqual([true, false]);
  });

  it("swaps a data: placeholder for the lazy-load data-src URL", async () => {
    const res = await analyze(html(
      '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="/img/echt.jpg" alt="a">' +
      '<img src="data:image/png;base64,iVBORw0KGgo=" alt="b">'
    ));
    expect(res.images[0]).toMatchObject({ lazy: true, format: "jpg" });
    expect(res.images[0].src).toMatch(/\/img\/echt\.jpg$/);
    expect(res.images[1]).toMatchObject({ lazy: false, format: "data-url" });
  });

  it("flags images without width and height, http: files on https pages and data-nosnippet text", async () => {
    const res = await analyze(html('<img src="/a.jpg" alt="a" width="10" height="10"><img src="http://cdn.example.net/b.jpg" alt="b"><p data-nosnippet>secret</p>'), { url: "https://www.example.be/" });
    expect(res.images.map((i) => i.missingDims)).toEqual([false, true]);
    expect(res.mixedContent).toEqual([{ tag: "img", url: "http://cdn.example.net/b.jpg" }]);
    expect(res.dataNosnippetCount).toBe(1);
  });

  it("tells a missing alt from an empty (decorative) one", async () => {
    const res = await analyze(html('<img src="/a.jpg"><img src="/b.jpg" alt="">'));
    expect(res.images.map((i) => i.altMissing)).toEqual([true, false]);
  });

  it("returns lazy-load data-src URLs absolute, like img.src", async () => {
    const res = await analyze(html('<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="/img/echt.jpg" alt="x">'));
    expect(res.images[0].src).toBe("https://www.example.be/img/echt.jpg");
  });
});

// The overhaul may restyle the highlights, so these tests check what is inserted
// ([data-needle-inserted]) and that everything is restored, not class names or colours.
describe("HIGHLIGHT_HEADINGS and UNHIGHLIGHT_HEADINGS", () => {
  it("labels each heading, warns on a skipped level, and cleans up", async () => {
    const page = await load(html("<h1>Titel</h1><h2>Sectie</h2><h4>Te diep</h4><h5>Vijf</h5><h6>Zes</h6>"));
    const headings = [...page.document.querySelectorAll("h1, h2, h4, h5, h6")];
    const classes = headings.map((h) => h.className);
    const inserted = (h) => [...h.querySelectorAll("[data-needle-inserted]")];
    await page.send({ type: "HIGHLIGHT_HEADINGS" });
    await expect(page.send({ type: "HIGHLIGHT_HEADINGS" })).resolves.toEqual({ ok: true, count: 5 });

    // One level label each, even after highlighting twice; the h4 (no h3 above it) also gets a warning.
    expect(headings.map((h) => inserted(h)[0]?.textContent)).toEqual(["H1", "H2", "H4", "H5", "H6"]);
    expect(headings.map((h) => inserted(h).length)).toEqual([1, 1, 2, 1, 1]);

    await expect(page.send({ type: "UNHIGHLIGHT_HEADINGS" })).resolves.toEqual({ ok: true });
    expect(page.document.querySelectorAll("[data-needle-inserted]")).toHaveLength(0);
    expect(headings.map((h) => h.textContent)).toEqual(["Titel", "Sectie", "Te diep", "Vijf", "Zes"]);
    expect(headings.map((h) => h.className)).toEqual(classes);
  });

  it("ANALYZE_ONPAGE while headings are highlighted reads the heading text without the injected label", async () => {
    const page = await load(fixture("landing-nl-be.html"));
    await page.send({ type: "HIGHLIGHT_HEADINGS" });
    const res = await page.send({ type: "ANALYZE_ONPAGE" });
    expect(res.headings[0].text).toBe("Fietsherstel: prijzen vergelijken");
  });
});

describe("HIGHLIGHT_LINKS and UNHIGHLIGHT_LINKS", () => {
  // The filter exactly as popup.js highlightLinksOnPage builds it from the link type and region menus.
  const popupFilter = (kind, ctx) => ({
    internal: kind === "internal" || kind === "external" ? kind : "all",
    nofollowOnly: kind === "nofollow",
    brokenOnly: kind === "broken",
    contexts: ctx === "all" ? [] : [ctx]
  });

  it("marks the links the popup's filter selects, with the same counts and regions as ANALYZE_ONPAGE, and cleans up", async () => {
    const page = await load(fixture("landing-nl-be.html"));
    const highlight = (kind, ctx) => page.send({ type: "HIGHLIGHT_LINKS", filter: popupFilter(kind, ctx) });
    const classes = () => [...page.document.links].map((a) => a.className);
    const before = classes();

    await expect(highlight("all", "all")).resolves.toEqual({ ok: true, matched: 14 });
    await expect(highlight("external", "all")).resolves.toEqual({ ok: true, matched: 5 });
    await expect(highlight("internal", "all")).resolves.toEqual({ ok: true, matched: 9 });
    await expect(highlight("nofollow", "all")).resolves.toEqual({ ok: true, matched: 2 });
    await expect(highlight("all", "main")).resolves.toEqual({ ok: true, matched: 5 });
    await expect(highlight("internal", "breadcrumb")).resolves.toEqual({ ok: true, matched: 2 });

    // Only the last call's links stay marked, each with one inserted region tag.
    const marked = [...page.document.querySelectorAll("[data-needle-inserted]")]
      .map((tag) => tag.parentElement.textContent.replace(tag.textContent, "").trim());
    expect(marked).toEqual(["Home", "Fietsen en onderhoud"]);

    await expect(page.send({ type: "UNHIGHLIGHT_LINKS" })).resolves.toEqual({ ok: true });
    expect(page.document.querySelectorAll("[data-needle-inserted]")).toHaveLength(0);
    expect(classes()).toEqual(before);
  });
});

describe("HIGHLIGHT", () => {
  it("scrolls to a heading, outlines it for 2.5 s, then restores its own style", async () => {
    const page = await load(html('<h1 style="outline: 1px dotted red">Titel</h1>'));
    const scroll = vi.spyOn(page.window.Element.prototype, "scrollIntoView");
    const h1 = page.document.querySelector("h1");
    const own = h1.style.cssText;
    vi.useFakeTimers();

    await expect(page.send({ type: "HIGHLIGHT", target: { kind: "heading", index: 0 } })).resolves.toMatchObject({ ok: true });
    expect(scroll.mock.contexts).toEqual([h1]);
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: "center" }));
    expect(h1.style.cssText).not.toBe(own);
    vi.advanceTimersByTime(2500);
    expect(h1.style.cssText).toBe(own);
  });

  it("finds links and images by their index in the last ANALYZE_ONPAGE result", async () => {
    const page = await load(fixture("landing-nl-be.html"));
    const highlight = (target) => page.send({ type: "HIGHLIGHT", target });

    await page.send({ type: "ANALYZE_ONPAGE" });
    await expect(highlight({ kind: "link", index: 7 })).resolves.toMatchObject({ ok: true });
    expect(page.document.querySelector('a[href="https://www.example.org/fietsverlichting"]').style.cssText).not.toBe("");
    await expect(highlight({ kind: "image", index: 4 })).resolves.toMatchObject({ ok: true });
    expect(page.document.querySelector('img[src="/img/team.jpg"]').style.cssText).not.toBe("");
  });

  it("falls back to the image src, and answers ok: false when nothing matches", async () => {
    const page = await load(fixture("landing-nl-be.html"));
    const highlight = (target) => page.send({ type: "HIGHLIGHT", target });

    await expect(highlight({ kind: "image", src: "https://www.example.be/img/team.jpg" })).resolves.toMatchObject({ ok: true });
    await expect(highlight({ kind: "heading", index: 99 })).resolves.toEqual({ ok: false });
    await expect(highlight({ kind: "image", src: "https://www.example.be/img/bestaat-niet.jpg" })).resolves.toEqual({ ok: false });
  });

  it("finds a CSS background image by its URL", async () => {
    const page = await load(html('<div class="hero" style="background-image: url(/img/hero.jpg)" data-test-rect="0,0,375,200"></div>'));
    await expect(page.send({ type: "HIGHLIGHT", target: { kind: "image", src: "https://www.example.be/img/hero.jpg" } })).resolves.toEqual({ ok: true });
  });
  it("draws a ring in its own layer over a visible element, so a clipping box can't hide it, and removes it after 2.5 s", async () => {
    const page = await load(html('<div style="overflow:hidden"><img src="/a.jpg" alt="a" data-test-rect="10,20,300,200"></div>'));
    vi.useFakeTimers();
    await expect(page.send({ type: "HIGHLIGHT", target: { kind: "image", index: 0 } })).resolves.toEqual({ ok: true });
    const ring = page.document.querySelector('body > [data-needle-inserted="locator"]');
    expect(ring.style.width).toBe("312px");
    vi.advanceTimersByTime(2500);
    expect(page.document.querySelector('[data-needle-inserted="locator"]')).toBeNull();
  });

  it("says when the element is hidden on the page", async () => {
    const page = await load(html('<img src="/a.jpg" alt="a">'));
    await expect(page.send({ type: "HIGHLIGHT", target: { kind: "image", index: 0 } })).resolves.toEqual({ ok: true, hidden: true });
  });

  it("finds an image from a saved result by any of its srcset URLs, without a new analysis", async () => {
    const page = await load(html('<img src="/a-300.jpg" srcset="/a-300.jpg 300w, /a-1200.jpg 1200w" alt="a" data-test-rect="0,0,300,200"><img src="/b.jpg" alt="b" data-test-rect="0,300,300,200">'));
    await expect(page.send({ type: "HIGHLIGHT", target: { kind: "image", index: 0, src: "https://www.example.be/a-1200.jpg" } })).resolves.toEqual({ ok: true });
    // A stale index is checked against the URL and corrected.
    await expect(page.send({ type: "HIGHLIGHT", target: { kind: "image", index: 0, src: "https://www.example.be/b.jpg" } })).resolves.toEqual({ ok: true });
  });

  it("finds a link by its URL when the saved index points elsewhere", async () => {
    const page = await load(html('<a href="/one" data-test-rect="0,0,50,20">One</a><a href="/two" data-test-rect="0,30,50,20">Two</a>'));
    await expect(page.send({ type: "HIGHLIGHT", target: { kind: "link", index: 0, href: "https://www.example.be/two" } })).resolves.toEqual({ ok: true });
    expect(page.document.querySelector('a[href="/two"]').style.cssText).not.toBe("");
  });

  it("restores the original outline when the same element is highlighted twice within 2.5 s", async () => {
    const page = await load(html('<h1 style="outline: 1px dotted red">Titel</h1>'));
    const h1 = page.document.querySelector("h1");
    const own = h1.style.cssText;
    vi.useFakeTimers();
    await page.send({ type: "HIGHLIGHT", target: { kind: "heading", index: 0 } });
    vi.advanceTimersByTime(1000);
    await page.send({ type: "HIGHLIGHT", target: { kind: "heading", index: 0 } });
    vi.advanceTimersByTime(2500);
    expect(h1.style.cssText).toBe(own);
  });

  it("honours prefers-reduced-motion: reduce when scrolling to an element", async () => {
    const page = await load(html("<h1>Titel</h1>"), { media: { "(prefers-reduced-motion: reduce)": true } });
    const scroll = vi.spyOn(page.window.Element.prototype, "scrollIntoView");
    await page.send({ type: "HIGHLIGHT", target: { kind: "heading", index: 0 } });
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
  });
});

describe("Needle's own page marks never count as page content", () => {
  it("leaves heading labels and issue labels out of the main text and the rendered snapshot", async () => {
    const page = await load(html("<main><h1>Bike repair</h1><h3>How it works</h3><p>We fix every bike in a day.</p></main>"));
    const clean = await page.send({ type: "GET_RENDERED" });
    const cleanText = (await page.send({ type: "GET_MAIN_TEXT" })).text;

    await page.send({ type: "HIGHLIGHT_HEADINGS" });
    await page.send({ type: "HIGHLIGHT_ISSUES", items: [{ target: { kind: "heading", index: 0 }, label: "Title too long", severity: "high" }] });
    expect(page.document.querySelectorAll("[data-needle-inserted]").length).toBeGreaterThan(0);

    expect((await page.send({ type: "GET_MAIN_TEXT" })).text).toBe(cleanText);
    expect(await page.send({ type: "GET_RENDERED" })).toEqual(clean);
    // The marks are back afterwards.
    expect(page.document.querySelector('[data-needle-inserted="label"]')).not.toBeNull();
  });

  it("leaves no empty style attribute behind after a short highlight", async () => {
    vi.useFakeTimers();
    const page = await load(html("<h1>Title</h1>"));
    await page.send({ type: "HIGHLIGHT", target: { kind: "heading", index: 0 } });
    vi.advanceTimersByTime(3000);
    expect(page.document.querySelector("h1").hasAttribute("style")).toBe(false);
  });
});

describe("image sizes with srcset", () => {
  it("measures the file the browser loaded, not the width attribute", async () => {
    const res = await analyze(html(`<main><img src="/img/case-2400.jpg" width="2400" height="1024" alt="Case"
      srcset="/img/case-760.jpg 760w, /img/case-1520.jpg 1520w, /img/case-2400.jpg 2400w" sizes="760px"
      data-test-current="/img/case-760.jpg" data-test-natural="760,324" data-test-rect="0,0,760,324"></main>`));
    const img = res.images[0];
    expect(img.naturalWidth).toBe(760);
    expect(img.largestWidth).toBe(2400);
    expect(img.downscaled).toBe(false);
  });

  it("still flags a plain file far larger than its box", async () => {
    const res = await analyze(html(`<main><img src="/img/huge.jpg" alt="Huge" data-test-natural="2400,1024" data-test-rect="0,0,760,324"></main>`));
    expect(res.images[0]).toMatchObject({ naturalWidth: 2400, downscaled: true });
  });

  it("reads x descriptors as a multiple of the natural width", async () => {
    const res = await analyze(html(`<main><img src="/img/a.jpg" srcset="/img/a.jpg 1x, /img/a@2x.jpg 2x" alt="A"
      data-test-current="/img/a@2x.jpg" data-test-natural="600,400" data-test-rect="0,0,600,400"></main>`));
    expect(res.images[0]).toMatchObject({ naturalWidth: 1200, downscaled: false });
  });
});
