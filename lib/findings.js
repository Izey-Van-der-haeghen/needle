import { robotsBlocksIndexing, canonicalFromLinkHeader, snippetDirectives, limitsSnippets, copilotLimit, unavailableAfter } from "./popup-compute.js";
import { withoutTracking } from "./urls.js";
import { snippetLength, charCount } from "./snippet.js";
import { validateSchema, suggestMissingSchemas, detectFaqDuplicates } from "./schema-validator.js";
import { validateHreflang, isLanguageChooser } from "./hreflang.js";
import { imageSizeIssues, normaliseImageRules, isContentImage, discoverCheck, LEAD_IMAGE_MIN_WIDTH } from "./image-rules.js";
import { keepsOutOfAnswers } from "./geo.js";
import { inlineImageLabel } from "./popup-helpers.js";

/**
 * One list of everything worth fixing on a page, from every check, ordered by
 * how much it matters. The popup's "Fix this first", the developer handoff,
 * "Copy for AI" and the on-page overlay all read this list.
 *
 * @typedef {"critical"|"high"|"medium"|"low"} Severity
 * @typedef {{kind: "heading"|"image"|"link", index?: number, level?: number, text?: string, src?: string, href?: string}} Target
 * @typedef {{id: string, severity: Severity, area: string, title: string, why: string, fix: string,
 *            targets?: Target[], examples?: string[]}} Finding
 */

export const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
export const SEVERITY_LABEL = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

const plural = (n, one, many = one + "s") => `${Number(n).toLocaleString("en")} ${n === 1 ? one : many}`;
/** Verb that agrees with a count: verb(1, "skips", "skip") → "skips". */
const verb = (n, one, many) => (n === 1 ? one : many);
const imgTarget = (i) => ({ kind: "image", index: i.domIndex, src: i.src });
const linkTarget = (l) => ({ kind: "link", index: l.index, href: l.href });

/** Findings that only matter for a page in search results; left out while it is noindex. */
const NOINDEX_NOTE = " While it is set, this list leaves out what only matters in search results: title, description, thin content, canonical, structured data, hreflang, the main image, snippet limits and trust signals.";
const SEARCH_ONLY = new Set(["title-long", "title-short", "desc-missing", "desc-long", "desc-short", "desc-body", "thin",
  "canonical-missing", "canonical-multiple", "canonical-body", "canonical-js", "schema-invalid", "schema-required", "schema-suggest", "schema-faq-dupes",
  "hreflang", "hreflang-body", "hreflang-alternates", "img-lead", "nosnippet", "eeat"]);

/**
 * @param {{onpage: Object, tech?: Object|null, geo?: Object|null, rendered?: Object|null,
 *          imageRules?: Object, titlePx?: number, descPx?: number}} input
 * @returns {Finding[]}
 */
export function collectFindings({ onpage: d, tech = null, geo = null, rendered = null, imageRules, titlePx = 0, descPx = 0, hreflangCluster = null }) {
  const out = [];
  const add = (f) => out.push(f);
  const rules = imageRules || normaliseImageRules({});

  // ----- Indexing -----
  if (tech?.status >= 400) {
    add({ id: "http-error", severity: "critical", area: "Indexing", title: `The page answers HTTP ${tech.status}`, why: "Search engines drop pages that answer with an error.", fix: "Make the server answer 200 for this URL, or redirect it to the right page." });
  }
  const metaNoindex = robotsBlocksIndexing(d.robots || "");
  const xrt = tech?.headers?.["x-robots-tag"] || "";
  // A passed unavailable_after date drops the page from Google as noindex does.
  // (robotsBlocksIndexing at the start of time sees noindex and none only.)
  const expired = (v) => (v && !robotsBlocksIndexing(v, -Infinity) ? unavailableAfter(v)?.when : null);
  const metaExpired = metaNoindex && expired(d.robots);
  if (metaNoindex) add({ id: "noindex-meta", severity: "critical", area: "Indexing", title: metaExpired ? "The page's unavailable_after date has passed (meta robots)" : "The page tells search engines not to index it (meta robots)", why: metaExpired ? `Google stopped showing this page after ${metaExpired}.` : `"${d.robots}" keeps this page out of Google.`, fix: metaExpired ? "If the page should be found, remove unavailable_after from the robots meta tag, or set a later date." : 'If the page should be found, remove noindex and none from the robots and googlebot meta tags.' });
  const headerExpired = robotsBlocksIndexing(xrt) && expired(xrt);
  if (robotsBlocksIndexing(xrt)) add({ id: "noindex-header", severity: "critical", area: "Indexing", title: headerExpired ? "The page's unavailable_after date has passed (X-Robots-Tag)" : "The server tells search engines not to index this page (X-Robots-Tag)", why: headerExpired ? `The HTTP header says "${xrt}": Google stopped showing this page after ${headerExpired}.` : `The HTTP header says "${xrt}".`, fix: headerExpired ? "Remove unavailable_after from the X-Robots-Tag header, or set a later date." : "Remove noindex from the X-Robots-Tag header at the server or CDN." });
  const pa = tech?.robotsTxt?.pathAllowed;
  if (pa && pa.allowed === false) add({ id: "robots-blocked", severity: "critical", area: "Indexing", title: "robots.txt blocks Google from this page", why: `The rule ${pa.rule} stops Googlebot from reading it; Google can still list the bare URL.`, fix: "Allow the path in /robots.txt if the page should be found." });
  else if (pa === null && tech?.robotsTxt && tech.status) {
    const rs = tech.robotsTxt.status || 0;
    if (rs) add({ id: "robots-unreachable", severity: "high", area: "Indexing", title: `robots.txt answers HTTP ${rs}`, why: "On a server error or 429, Google stops crawling the site for up to 12 hours, then uses its last saved copy of robots.txt for up to 30 days.", fix: "Make /robots.txt answer 200 (or 404 if you have none)." });
    // No status: the request itself failed, often because /robots.txt redirects to another site this check can't follow.
    else add({ id: "robots-unchecked", severity: "low", area: "Indexing", title: "Needle could not read robots.txt", why: "The request failed. A common cause is a /robots.txt that redirects to another domain, which Google follows but this check can't.", fix: "Open /robots.txt in a tab: it should answer 200 (or 404 if you have none), ideally without redirecting." });
  }
  if (tech && !tech.status) add({ id: "not-verified", severity: "medium", area: "Indexing", title: "The server check failed", why: "Status, redirects and headers could not be checked.", fix: "Check the internet connection and refresh. If it keeps failing while other sites load, the server may block requests without cookies, and Googlebot may be blocked too." });
  if (tech?.redirected) add({ id: "redirect", severity: "high", area: "Indexing", title: "This URL redirects", why: `It ends on ${tech.finalUrl}; Google indexes that one.`, fix: "Link to the final URL everywhere and put the canonical and content there." });

  const canonical = d.canonical || canonicalFromLinkHeader(tech?.headers?.link || "");
  if (canonical) {
    try {
      const can = new URL(canonical, d.url); can.hash = "";
      // A campaign link (?utm_…) to the page is the same page.
      if (withoutTracking(can.href) !== withoutTracking(d.url)) add({ id: "canonical-elsewhere", severity: "high", area: "Indexing", title: "The canonical points to another URL", why: `Google is asked to index ${can.href} instead.`, fix: "If this page should rank, make its canonical point to itself." });
    } catch {}
  } else {
    add({ id: "canonical-missing", severity: "medium", area: "Indexing", title: "No canonical URL", why: "Without one, Google picks the version it thinks is best, which may not be the one you want.", fix: `Add <link rel="canonical" href="${String(d.url || "").split("#")[0]}"> in <head>.` });
  }
  if (d.canonicalDistinct > 1) add({ id: "canonical-multiple", severity: "high", area: "Indexing", title: `${d.canonicalDistinct} different canonical URLs`, why: "With conflicting canonicals Google may ignore all of them.", fix: "Keep exactly one canonical link." });
  if (d.canonicalOutsideHead) add({ id: "canonical-body", severity: "medium", area: "Indexing", title: "Canonical link outside <head>", why: "Google only reads rel=canonical in <head>.", fix: "Move it into <head>." });

  // The HTML the server sends against the page after JavaScript. Only for a 200 on the same URL:
  // after a redirect or on an error page (bot challenges carry noindex) the server sent another document.
  const raw = tech?.raw;
  const sameDocument = raw && !raw.challenge && tech.status >= 200 && tech.status < 300 && !tech.redirected;
  if (sameDocument && typeof raw.robots === "string" && robotsBlocksIndexing(raw.robots) && !metaNoindex) add({ id: "noindex-js", severity: "critical", area: "Indexing", title: "Server HTML says noindex; JavaScript removes it", why: `The HTML the server sends says "${raw.robots}", but the page in this tab has no noindex. When Google finds noindex, it may skip running JavaScript, so it may never see the change.`, fix: "If the page should be found, remove noindex from the HTML the server sends. Don't rely on JavaScript to remove it." });
  if (sameDocument && raw.canonical && d.canonical) {
    try {
      const served = withoutTracking(raw.canonical);
      const rendered = withoutTracking(new URL(d.canonical, d.url).href);
      if (served !== rendered) add({ id: "canonical-js", severity: "high", area: "Indexing", title: "The canonical in the server HTML differs from the rendered one", why: `The server HTML names ${served}; after JavaScript the page names ${rendered}. Google advises against changing the canonical with JavaScript: conflicting canonicals may lead to unexpected results.`, fix: "Put the right canonical in the HTML the server sends, and keep JavaScript from changing it." });
    } catch {}
  }

  // ----- Title, description, headings -----
  const titleLen = charCount(d.title);
  const descLen = charCount(d.description);
  if (!titleLen) add({ id: "title-missing", severity: "critical", area: "Content", title: "No <title>", why: "The title is the blue link in search results.", fix: "Write a unique title of about 50–60 characters with the main topic first." });
  // Google cuts by pixel width; characters only stand in when the width isn't known.
  else if (snippetLength("title", titleLen, titlePx) === "long") add({ id: "title-long", severity: "medium", area: "Content", title: titlePx ? `Title is cut off in Google results (${titlePx} px)` : `Title is ${titleLen} characters and may be cut off`, why: "Google cuts long titles to fit the screen. Needle measures them against about 600 pixels, the width of a desktop result.", fix: "Shorten it, with the most important words first." });
  else if (snippetLength("title", titleLen, titlePx) === "short") add({ id: "title-short", severity: "low", area: "Content", title: titlePx ? `Title is short in Google results (${titlePx} px)` : `Title is only ${titleLen} characters`, why: "A short title leaves room unused to say what the page offers.", fix: "Add the topic and what makes the page useful." });
  if (!descLen) add({ id: "desc-missing", severity: "medium", area: "Content", title: "No meta description", why: "Google then writes its own snippet from page text.", fix: "Write a description of about 120–155 characters that says what the reader gets." });
  else if (snippetLength("description", descLen, descPx) === "long") add({ id: "desc-long", severity: "low", area: "Content", title: descPx ? `Meta description is cut off in Google results (${descPx} px)` : `Meta description is ${descLen} characters and may be cut off`, why: "Google cuts long descriptions to fit the screen. Needle uses about 155–160 characters, what a desktop result usually shows.", fix: "Put the key message in the first 120 characters." });
  else if (snippetLength("description", descLen, descPx) === "short") add({ id: "desc-short", severity: "low", area: "Content", title: descPx ? `Meta description is short in Google results (${descPx} px)` : `Meta description is only ${descLen} characters`, why: "Short descriptions are often replaced by Google.", fix: "Expand it to about 120–155 characters." });
  if (d.descriptionOutsideHead) add({ id: "desc-body", severity: "high", area: "Content", title: "Meta description outside <head>", why: "An element that isn't allowed in <head> closed it early; search engines ignore metadata after that point.", fix: "Move the invalid element (often an img, div or tracking pixel) out of <head>, or the meta tags above it." });

  const visibleHeadings = (d.headings || []).map((h, index) => ({ ...h, index })).filter((h) => !h.hidden);
  const h1s = visibleHeadings.filter((h) => h.level === 1);
  const hiddenH1 = (d.headings || []).some((h) => h.hidden && h.level === 1);
  if (!h1s.length && !hiddenH1) add({ id: "h1-missing", severity: "high", area: "Content", title: "No H1 heading", why: "The H1 tells readers and search engines what the page is about.", fix: "Add one H1 with the page's main topic." });
  else if (h1s.length > 1) add({ id: "h1-multiple", severity: "low", area: "Content", title: `${h1s.length} H1 headings`, why: "Several H1s blur what the page is mainly about.", fix: "Keep one H1 and make the others H2.", targets: h1s.map((h) => ({ kind: "heading", index: h.index, level: h.level, text: h.text })), examples: h1s.map((h) => h.text) });
  const skips = [];
  let prev = 0;
  for (const h of visibleHeadings) { if (prev && h.level > prev + 1) skips.push(h); prev = h.level; }
  if (skips.length) add({ id: "heading-skips", severity: "low", area: "Content", title: `${plural(skips.length, "heading")} ${verb(skips.length, "skips", "skip")} a level`, why: "Skipped levels make the outline harder to follow for screen readers.", fix: "Use the next level down (H2 after H1, H3 after H2).", targets: skips.map((h) => ({ kind: "heading", index: h.index, level: h.level, text: h.text })), examples: skips.map((h) => `H${h.level} ${h.text}`) });
  const hiddenHeadings = (d.headings || []).filter((h) => h.hidden);
  if (hiddenHeadings.some((h) => h.level === 1)) add({ id: "h1-hidden", severity: "medium", area: "Content", title: "An H1 is hidden on the page", why: "Visitors don't see it at this screen size. If it holds the main topic, the visible page has no main heading.", fix: "Check that the visible page shows its main heading. Show the hidden H1, or remove it." });

  if (!d.viewport) add({ id: "viewport", severity: "high", area: "Technical", title: "No viewport meta tag", why: "Without it the page isn't mobile-friendly, and Google indexes the mobile version.", fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.' });
  if (!d.lang) add({ id: "lang", severity: "medium", area: "Content", title: "No language on <html>", why: "Screen readers use it to pronounce the page, and translation tools to detect it. Google detects the language itself.", fix: 'Add lang to <html>, for example <html lang="en-GB">.' });
  const words = d.mainContentWordCount ?? d.wordCount ?? 0;
  // A language chooser is short on purpose.
  if (words < 150 && !isLanguageChooser(d.hreflang, d.canonical || d.url)) add({ id: "thin", severity: "low", area: "Content", title: `Only ${words} words of main content`, why: "Google says length alone doesn't matter, but a page this short may not answer what visitors come for.", fix: "Check that the page answers what visitors come for, and add what they need to decide or act." });

  // ----- Images -----
  const imgs = (d.images || []).filter(isContentImage);
  const group = (id, severity, list, title, why, fix) => {
    if (list.length) add({ id, severity, area: "Images", title: title(list.length), why, fix, targets: list.map(imgTarget), examples: list.map((i) => (/^data:/i.test(i.src) ? inlineImageLabel(i.src) : i.src)) });
  };
  group("img-broken", "high", imgs.filter((i) => i.brokenLoad), (n) => `${plural(n, "image")} ${verb(n, "doesn't", "don't")} load`, "Broken images look careless and can't be found in image search.", "Fix the file path or remove the image.");
  group("img-alt", "medium", imgs.filter((i) => i.altMissing ?? !i.alt), (n) => `${plural(n, "image")} without an alt attribute`, "Screen readers and image search rely on alt text.", "Describe each image in a short alt text; use alt=\"\" for pure decoration.");
  group("img-lazy-top", "medium", imgs.filter((i) => i.lazyAboveFold), (n) => `${plural(n, "image")} lazy-loaded above the fold`, "The first visible image loads late, which slows Largest Contentful Paint.", "Remove loading=\"lazy\" from images in the first screen.");
  // Low: Google sets no file-size target; the limit is the team's own (Settings).
  group("img-heavy", "low", imgs.filter((i) => i.bytes > rules.maxKB * 1024), (n) => `${plural(n, "image")} over ${rules.maxKB} KB`, "Heavy images slow the page, especially on mobile.", "Compress them and serve WebP or AVIF in the size they are shown.");
  group("img-blurry", "low", imgs.filter((i) => i.upscaled), (n) => `${plural(n, "image")} shown larger than the file`, "They look blurry.", "Use a larger file, or a srcset with larger versions.");
  group("img-dims", "low", imgs.filter((i) => i.missingDims), (n) => `${plural(n, "image")} without width and height`, "The browser can't reserve space, so the layout jumps (CLS).", "Add width and height attributes with the image's real proportions.");
  group("img-rule", "low", imgs.filter((i) => imageSizeIssues(i, rules).some(([t]) => /^not /.test(t))), (n) => `${plural(n, "image")} ${verb(n, "doesn't", "don't")} match your size rule`, `Your rule in Settings: ${rules.mode === "exact" ? `exactly ${rules.width}×${rules.height}` : `the shape of ${rules.width}×${rules.height}`}.`, "Export them in the expected size or shape.");
  // Discover (articles only): a wide enough main image, and permission to show it large.
  const lead = discoverCheck(imgs, d, xrt);
  if (lead && !lead.wideEnough) add({ id: "img-lead", severity: "low", area: "Images", title: `Main image is only ${lead.width} px wide`, why: `Google recommends at least ${LEAD_IMAGE_MIN_WIDTH} px for large previews in Discover.`, fix: `Use a main image of at least ${LEAD_IMAGE_MIN_WIDTH} px wide${lead.largePreview ? "" : ", and allow large previews with max-image-preview:large in the robots meta tag"}.`, targets: [imgTarget(lead.img)] });
  else if (lead && !lead.largePreview) add({ id: "img-lead", severity: "low", area: "Images", title: "Large image previews aren't turned on", why: `Discover shows a large image only with max-image-preview:large (or AMP). ${lead.preview ? `This page sets max-image-preview:${lead.preview}.` : "This page doesn't set it."}`, fix: 'If you want large previews in Discover, add <meta name="robots" content="max-image-preview:large">.', targets: [imgTarget(lead.img)] });

  // ----- Links -----
  const links = d.links?.details || [];
  const empty = links.filter((l) => l.broken);
  if (empty.length) add({ id: "link-empty", severity: "low", area: "Links", title: `${plural(empty.length, "link")} with an empty href`, why: "They go nowhere for visitors and crawlers.", fix: "Give them a real URL, or make them buttons.", targets: empty.map(linkTarget) });
  const broken = links.filter((l) => l.checkedStatus?.kind === "broken");
  if (broken.length) add({ id: "link-broken", severity: "high", area: "Links", title: `${plural(broken.length, "broken link")}`, why: "Broken links frustrate visitors and lead search engines to dead ends.", fix: "Fix or remove them.", targets: broken.map(linkTarget), examples: broken.map((l) => `${l.href} (${l.checkedStatus.status || "no answer"})`) });
  const redirects = links.filter((l) => l.checkedStatus?.kind === "redirect");
  if (redirects.length) add({ id: "link-redirect", severity: "low", area: "Links", title: `${plural(redirects.length, "link")} that ${verb(redirects.length, "redirects", "redirect")}`, why: "Each redirect adds a step for visitors and crawlers.", fix: "Link straight to the final URL.", targets: redirects.map(linkTarget), examples: redirects.map((l) => l.href) });

  // ----- Structured data -----
  const invalid = (d.schema || []).filter((s) => s.type === "Invalid JSON");
  if (invalid.length) add({ id: "schema-invalid", severity: "high", area: "Structured data", title: `${plural(invalid.length, "JSON-LD block")} can't be read`, why: "Search engines skip structured data with a syntax error.", fix: "Fix the JSON (often a trailing comma or an HTML comment around it)." });
  const required = validateSchema((d.schema || []).filter((s) => s.type !== "Invalid JSON")).flatMap((s) => s.issues.filter((i) => i.level === "error").map((i) => i.msg));
  if (required.length) add({ id: "schema-required", severity: "medium", area: "Structured data", title: `${plural(required.length, "required property", "required properties")} missing in structured data`, why: "Without them the markup isn't eligible for rich results.", fix: "Add the missing properties; check with the Rich Results Test.", examples: required });
  const dupes = detectFaqDuplicates(d.schema || []);
  if (dupes.length) add({ id: "schema-faq-dupes", severity: "low", area: "Structured data", title: `${plural(dupes.length, "FAQ question")} repeated`, why: "Usually a template or plugin mistake.", fix: "Keep each question once.", examples: dupes.map((q) => q.question) });
  const suggestions = suggestMissingSchemas(d).filter((s) => s.priority === "high");
  if (suggestions.length) add({ id: "schema-suggest", severity: "low", area: "Structured data", title: `Structured data worth adding: ${suggestions.map((s) => s.type).join(", ")}`, why: suggestions[0].reason, fix: "Add it as JSON-LD and test it with the Rich Results Test." });

  // ----- International -----
  if (d.hreflangOutsideHead) add({ id: "hreflang-body", severity: "high", area: "International", title: `${plural(d.hreflangOutsideHead, "hreflang link")} outside <head>`, why: "Google only reads hreflang in <head>.", fix: "Move them into <head>." });
  if ((d.hreflang || []).length) {
    // Notes (no x-default, a link listed twice) are recommendations, not problems.
    const issues = validateHreflang(d.hreflang, withoutTracking(d.url)).filter((i) => i.level !== "info");
    if (issues.length) add({ id: "hreflang", severity: issues.some((i) => i.level === "error") ? "high" : "medium", area: "International", title: `${plural(issues.length, "hreflang problem")}`, why: "Google ignores hreflang tags it can't trust.", fix: issues[0].hint || "Fix the language codes and URLs.", examples: issues.map((i) => i.msg) });
  }
  // After "Check the alternates" ({rows, total}): return links and the state of each alternate.
  const checked = hreflangCluster?.rows || [];
  const badAlternates = checked.filter((r) => r.problems?.length);
  const partly = hreflangCluster?.total > checked.length ? ` Only the first ${checked.length} of ${hreflangCluster.total} alternates were checked.` : "";
  if (badAlternates.length) add({ id: "hreflang-alternates", severity: "medium", area: "International", title: `${plural(badAlternates.length, "hreflang alternate")} with problems`, why: `Google ignores hreflang pairs that don't link back to each other, and alternates that fail, redirect or can't be indexed.${partly}`, fix: "Each alternate should answer 200, be canonical to itself, be indexable and list this page in its own hreflang.", examples: badAlternates.map((r) => `${r.lang} ${r.href}: ${r.problems.join(", ")}`) });

  // ----- Technical -----
  if (tech?.finalUrl && !/^https:/.test(tech.finalUrl)) add({ id: "no-https", severity: "high", area: "Technical", title: "The page isn't served over HTTPS", why: "Browsers mark it as not secure, and HTTPS is a ranking signal.", fix: "Serve the site over HTTPS and redirect http to https." });
  if (d.mixedContent?.length) add({ id: "mixed-content", severity: "high", area: "Technical", title: `${plural(d.mixedContent.length, "file")} loaded over http on an https page`, why: "Browsers block or warn about mixed content.", fix: "Load them over https.", examples: d.mixedContent.map((m) => m.url) });
  // A sitemap on another site, or a compressed one, can't be read from here: no sign of a problem.
  if (tech?.sitemap && !tech.sitemap.ok && !tech.sitemap.unchecked && tech.status) add({ id: "sitemap", severity: "low", area: "Technical", title: "No valid sitemap found", why: "A sitemap helps search engines find every page.", fix: /not a sitemap/i.test(tech.sitemap.reason || "") ? "Make the sitemap address serve the sitemap itself (XML, RSS, Atom or a text list of URLs), not a web page." : "Publish /sitemap.xml and list it in robots.txt.", ...(tech.sitemap.url ? { examples: [`${tech.sitemap.url}: ${tech.sitemap.reason}`] } : {}) });
  if (rendered && tech?.raw && tech.raw.wordCount < rendered.wordCount * 0.7) add({ id: "js-content", severity: "medium", area: "Technical", title: "Much of the text needs JavaScript", why: "Crawlers that don't run JavaScript miss it, and tests by others suggest many AI crawlers don't run it.", fix: "Render the main content on the server." });

  // ----- AI search -----
  const limits = snippetDirectives(d.robots, xrt).filter(limitsSnippets);
  if (limits.length) add({ id: "nosnippet", severity: "medium", area: "AI search", title: "Snippets are limited", why: `"${limits.join(", ")}" also limits what AI Overviews may quote.`, fix: "Remove the limit if you want this page quoted." });
  const copilot = copilotLimit(d.robots, xrt);
  if (copilot === "noarchive") add({ id: "copilot-noarchive", severity: "low", area: "AI search", title: "Kept out of Microsoft Copilot answers", why: "Bing doesn't use or link a noarchive page in its Copilot answers. Google no longer uses noarchive, so it is often left over.", fix: "Remove noarchive if you want this page in Copilot answers." });
  else if (copilot === "nocache") add({ id: "copilot-nocache", severity: "low", area: "AI search", title: "Copilot shows only this page's link, title and snippet", why: "With nocache, Bing's Copilot answers may cite the page but show only its URL, title and snippet. Google ignores nocache.", fix: "Remove nocache if you want Copilot to quote more of the page." });
  const blockedSearch = (geo?.aiAccess?.bots || []).filter((b) => !b.allowed && keepsOutOfAnswers(b));
  if (blockedSearch.length) add({ id: "ai-blocked", severity: "high", area: "AI search", title: `robots.txt blocks ${plural(blockedSearch.length, "AI answer bot")}`, why: `robots.txt stops ${blockedSearch.map((b) => b.ua).join(", ")} from reading this page, so those AI answers will probably leave it out.`, fix: "Allow these bots in robots.txt if you want to appear in AI answers." });
  if ((geo?.aiAccess?.bots || []).some((b) => b.ua === "Google-Extended" && !b.allowed)) add({ id: "ai-google-extended", severity: "low", area: "AI search", title: "Google-Extended is blocked", why: "Google won't use this site to train or ground Gemini (Gemini apps, Vertex AI). Google Search, including AI Overviews, is not affected.", fix: "Allow Google-Extended in robots.txt if you want Gemini apps to use and cite your pages; leave it blocked if you don't." });
  if (geo?.aiAccess?.cloudflareManaged) add({ id: "ai-cloudflare", severity: "low", area: "AI search", title: "Cloudflare may also block AI bots", why: "This robots.txt is managed by Cloudflare. Its AI Crawl Control can turn AI bots away at the network level (HTTP 403), even ones robots.txt allows; Needle can't see that from your browser.", fix: "Check AI Crawl Control in the Cloudflare dashboard and allow the AI answer bots you want." });
  const eeatMissing = (geo?.eeat || []).filter((s) => !s.ok && !s.info);
  if (eeatMissing.length >= 3) add({ id: "eeat", severity: "low", area: "AI search", title: `${plural(eeatMissing.length, "trust signal")} missing`, why: "Author, dates, sources and organisation help readers and AI tools judge the page.", fix: eeatMissing[0].hint || "Add the author, dates and sources.", examples: eeatMissing.map((s) => s.label) });

  // ----- Social -----
  if (!d.og?.image) add({ id: "og-image", severity: "low", area: "Social", title: "No og:image", why: "Shared links show without a picture.", fix: "Add an og:image of at least 1200×630 px." });

  // While the page asks not to be indexed, what only matters in search results waits: fixing it
  // changes nothing until noindex goes. Accessibility, links, images and security stay.
  const NOINDEX_IDS = ["noindex-meta", "noindex-header", "noindex-js"];
  if (out.some((f) => NOINDEX_IDS.includes(f.id))) {
    const kept = out.filter((f) => !SEARCH_ONLY.has(f.id));
    // The popup says how many were left out, so the shorter list never looks complete.
    kept.leftOut = out.filter((f) => SEARCH_ONLY.has(f.id));
    // Explained once, on the first noindex finding (a page can carry both the meta tag and the header).
    const first = kept.find((f) => NOINDEX_IDS.includes(f.id));
    first.why += NOINDEX_NOTE;
    return kept.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }
  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
