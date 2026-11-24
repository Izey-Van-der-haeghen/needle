import { countWords } from "./words.js";
import { flattenJsonLd, bareType } from "./schema-validator.js";
import { serverIndexingTags } from "./technical.js";

/**
 * Parse a competitor page's HTML with DOMParser. Runs in the popup, and in
 * unit tests through jsdom.
 *
 * @param {string} html
 * @param {string} baseUrl
 * @param {typeof DOMParser} [DOMParserImpl] - optional injectable parser for tests
 * @returns {Object} structured snapshot of the page
 */
export function parseCompetitorHtml(html, baseUrl, DOMParserImpl) {
  const Parser = DOMParserImpl || (typeof DOMParser !== "undefined" ? DOMParser : null);
  if (!Parser) throw new Error("DOMParser unavailable in this context");
  const doc = new Parser().parseFromString(html, "text/html");
  // DOMParser parses with scripting off, so <noscript> fallbacks (lazy-load twins,
  // tracking pixels) become elements; a browser with JavaScript ignores them.
  doc.querySelectorAll("noscript").forEach(n => n.remove());

  const title = (doc.title || "").trim();
  const description = doc.querySelector('meta[name="description" i]')?.getAttribute("content")?.trim() || "";
  // As the server check reads them (and as content.js does): robots first, then googlebot and Bing's tags.
  const { robots, canonical } = serverIndexingTags(html, baseUrl);
  const lang = doc.documentElement.getAttribute("lang") || "";

  const h1Nodes = Array.from(doc.querySelectorAll("h1"));
  // Read H1s the way content.js does: no hidden parts, and a logo heading by its text alternative.
  const alt = (h) => h.getAttribute("aria-label")?.trim() || Array.from(h.querySelectorAll('img[alt], svg[aria-label], [role="img"][aria-label], svg > title'), (el) => (el.matches("svg > title") ? el.textContent : el.getAttribute(el.matches("img") ? "alt" : "aria-label"))?.trim()).find(Boolean) || "";
  const alts = h1Nodes.map(alt);
  doc.querySelectorAll("h1 style, h1 title, h1 script, h1 [hidden]:not([hidden='until-found' i])").forEach(n => n.remove());
  doc.querySelectorAll("h1 br").forEach(br => br.replaceWith(" "));
  const h1s = h1Nodes.map((h, i) => (h.textContent || "").replace(/[ \t\n\f\r]+/g, " ").trim() || alts[i]).filter(Boolean);
  const h2Count = doc.querySelectorAll("h2").length;
  const h3Count = doc.querySelectorAll("h3").length;

  const links = doc.querySelectorAll("a[href]").length;
  const imgEls = doc.querySelectorAll("img");
  const images = imgEls.length;
  // Same rule as the current page: an image without an alt attribute (empty alt is decorative, so fine).
  const imagesWithAlt = Array.from(imgEls).filter(i => i.hasAttribute("alt")).length;

  // The same nodes content.js reads from each block (flattenJsonLd), so both columns compare alike.
  const schemaTypes = new Set();
  doc.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
    const text = (s.textContent || "").trim();
    if (!text) return;
    try {
      flattenJsonLd(JSON.parse(text)).forEach(it => {
        // "https://schema.org/Product" and "Product" are the same type on two sites.
        [].concat(it["@type"] || []).forEach(x => { if (typeof x === "string" && bareType(x)) schemaTypes.add(bareType(x)); });
      });
    } catch {}
  });

  doc.querySelectorAll("script, style, noscript").forEach(n => n.remove());
  const text = (doc.body?.textContent || "").replace(/\s+/g, " ").trim();
  const wordCount = countWords(text);

  return {
    url: baseUrl,
    title,
    description,
    canonical,
    robots,
    lang,
    h1s,
    h1Count: h1s.length,
    h2Count,
    h3Count,
    links,
    images,
    imagesWithoutAlt: images - imagesWithAlt,
    schemaTypes: [...schemaTypes],
    wordCount
  };
}
