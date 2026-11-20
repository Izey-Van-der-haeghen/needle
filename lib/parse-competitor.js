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
  const canonical = doc.querySelector('link[rel="canonical" i]')?.getAttribute("href")?.trim() || "";
  const robots = Array.from(doc.querySelectorAll('meta[name="robots" i], meta[name="googlebot" i]'), m => m.getAttribute("content")?.trim()).filter(Boolean).join(", ");
  const lang = doc.documentElement.getAttribute("lang") || "";
  const ogTitle = doc.querySelector('meta[property="og:title" i]')?.getAttribute("content")?.trim() || "";

  const h1Nodes = Array.from(doc.querySelectorAll("h1"));
  // Read H1s the way content.js cleanText does.
  doc.querySelectorAll("h1 style, h1 title, h1 script").forEach(n => n.remove());
  doc.querySelectorAll("h1 br").forEach(br => br.replaceWith(" "));
  const h1s = h1Nodes.map(h => (h.textContent || "").replace(/[ \t\n\f\r]+/g, " ").trim()).filter(Boolean);
  const h2Count = doc.querySelectorAll("h2").length;
  const h3Count = doc.querySelectorAll("h3").length;

  const links = doc.querySelectorAll("a[href]").length;
  const imgEls = doc.querySelectorAll("img");
  const images = imgEls.length;
  // Same rule as the current page: an image without an alt attribute (empty alt is decorative, so fine).
  const imagesWithAlt = Array.from(imgEls).filter(i => i.hasAttribute("alt")).length;

  const schemaTypes = new Set();
  doc.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
    try {
      const parsed = JSON.parse(s.textContent || "{}");
      const items = Array.isArray(parsed) ? parsed
        : parsed["@graph"] ? parsed["@graph"]
        : [parsed];
      items.forEach(it => {
        const t = it?.["@type"];
        if (!t) return;
        if (Array.isArray(t)) t.forEach(x => schemaTypes.add(String(x)));
        else schemaTypes.add(String(t));
      });
    } catch {}
  });

  doc.querySelectorAll("script, style, noscript").forEach(n => n.remove());
  const text = (doc.body?.textContent || "").replace(/\s+/g, " ").trim();
  const wordCount = text ? text.split(/\s+/).length : 0;

  return {
    url: baseUrl,
    title,
    titleLen: title.length,
    description,
    descLen: description.length,
    canonical,
    robots,
    lang,
    ogTitle,
    h1s,
    h1Count: h1s.length,
    h2Count,
    h3Count,
    links,
    images,
    imagesWithAlt,
    imagesWithoutAlt: images - imagesWithAlt,
    schemaTypes: [...schemaTypes],
    wordCount,
    htmlLen: html.length
  };
}
