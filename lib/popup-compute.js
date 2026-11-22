import { isContentImage } from "./image-rules.js";
import { validateSchema } from "./schema-validator.js";
import { isLanguageChooser, validateHreflang } from "./hreflang.js";
import { snippetLength, charCount } from "./snippet.js";
import { withoutTracking } from "./urls.js";

/**
 * @typedef {Object} HealthCheck
 * @property {string} label
 * @property {number} weight
 * @property {number} score - 0..1
 *   - critical: can prevent the page from ranking at all (indexability, canonical, H1)
 *   - important: structural quality that influences rankings (content, schema, images)
 *   - nice:      best-practice / CTR signals, low direct ranking impact (meta lengths, OG)
 */

/**
 * @typedef {Object} HealthScore
 * @property {number} score - 0..100
 * @property {"A"|"B"|"C"|"D"|"F"} grade
 * @property {"good"|"warn"|"bad"} level
 * @property {HealthCheck[]} checks
 */

/**
 * Compute an on-page hygiene score 0-100 from on-page + technical data.
 *
 * IMPORTANT: this is an on-page hygiene heuristic, not a ranking predictor.
 * Real ranking depends on backlinks, content quality, search intent and authority,
 * none of which this function measures.
 *
 * Weights are deliberately conservative:
 *   critical  → must-fix issues that can prevent indexing or canonical ranking
 *   important → structural quality that correlates with ranking but doesn't gate it
 *   nice      → best-practice items that mostly affect CTR or are folklore
 *
 * @param {Object} op - on-page data from content script
 * @param {Object|null} tech - technical data (status, headers, robots)
 * @param {{titlePx?: number, descPx?: number}} [px] - snippet widths; when known they decide, as in Fix this first
 * @returns {HealthScore|null}
 */
export function computeHealthScore(op, tech, { titlePx = 0, descPx = 0 } = {}) {
  if (!op) return null;
  const checks = [];

  // ----- CRITICAL: gate ranking entirely if broken -----
  const verdict = computeIndexability(op, tech);
  checks.push({
    label: "Indexability",
    weight: 25,
    score: verdict.level === "good" ? 1 : verdict.level === "warn" ? 0.5 : 0
  });

  // A canonical in the HTTP Link header counts, as it does for the verdict and "Fix this first".
  checks.push({
    label: "Canonical",
    weight: 5,
    score: op.canonical || canonicalFromLinkHeader(tech?.headers?.link || "") ? 1 : 0
  });

  // The basics Fix this first rates high: a phone layout, https and no http: files on it.
  const finalUrl = tech?.finalUrl || op.url || "";
  let basics = 1;
  if (!op.viewport) basics -= 0.5;
  if (/^http:/i.test(finalUrl)) basics -= 0.5;
  if (op.mixedContent?.length) basics -= 0.3;
  checks.push({ label: "Technical basics", weight: 8, score: Math.max(0, basics) });

  // ----- IMPORTANT: structural quality, correlates with rankings -----
  // Hidden headings don't count, as in "Fix this first". No Google rule asks for exactly one H1;
  // one main heading is clearest for readers and screen readers.
  const visibleHeadings = op.headings.filter(h => !h.hidden);
  const h1Count = visibleHeadings.filter(h => h.level === 1).length;
  checks.push({
    label: "H1 structure",
    weight: 8,
    score: h1Count === 1 ? 1 : h1Count > 1 ? 0.7 : 0
  });

  let prevLevel = 0; let skipped = 0;
  visibleHeadings.forEach(h => { if (prevLevel > 0 && h.level > prevLevel + 1) skipped++; prevLevel = h.level; });
  checks.push({
    label: "Heading hierarchy",
    weight: 6,
    score: skipped === 0 ? 1 : skipped <= 2 ? 0.5 : 0
  });

  const mainWords = op.mainContentWordCount || op.wordCount || 0;
  checks.push({
    label: "Content depth",
    weight: 10,
    // Google: length alone doesn't matter. So this only asks for more than a thin page (the same
    // 150 words as Fix this first). A language chooser is short on purpose.
    score: isLanguageChooser(op.hreflang, op.canonical || op.url) || mainWords >= 150 ? 1 : mainWords >= 50 ? 0.5 : 0
  });

  // Content images only, the same set the Images card and "Fix this first" use.
  // Missing alt attribute counts; an empty alt is fine (decoration).
  const contentImgs = (op.images || []).filter(isContentImage);
  const missingAltCount = contentImgs.filter(i => i.altMissing ?? !i.alt).length;
  const oversizedCount = contentImgs.filter(i => i.oversized).length;
  const lazyAboveFoldCount = contentImgs.filter(i => i.lazyAboveFold).length;
  const brokenCount = contentImgs.filter(i => i.brokenLoad).length;
  const totalImgs = contentImgs.length;
  let imgScore = 1;
  if (totalImgs > 0) imgScore -= Math.min(0.5, missingAltCount / totalImgs);
  if (brokenCount > 0) imgScore -= Math.min(0.5, brokenCount * 0.25);
  if (oversizedCount > 0) imgScore -= Math.min(0.3, oversizedCount * 0.1);
  if (lazyAboveFoldCount > 0) imgScore -= 0.2;
  checks.push({ label: "Images", weight: 10, score: Math.max(0, imgScore) });

  const validated = validateSchema(op.schema || []);
  const totalSchemas = validated.length;
  const goodSchemas = validated.filter(s => !s.issues.some(i => i.level === "error")).length;
  // Microdata and RDFa are structured data too (Google reads all three formats). Needle lists their
  // types but doesn't check their properties, so a page with only those counts as having markup.
  const schemaScore = totalSchemas ? goodSchemas / totalSchemas : op.microdataTypes?.length ? 1 : 0;
  checks.push({
    label: "Schema markup",
    weight: 10,
    score: schemaScore
  });

  // ----- NICE-TO-HAVE: best practice / CTR signals, low direct ranking impact -----
  const titleLen = charCount(op.title);
  checks.push({
    label: "Title length",
    weight: 8,
    // Google cuts at about 600 px; characters only stand in when the width isn't known.
    score: { ok: 1, missing: 0 }[snippetLength("title", titleLen, titlePx)] ?? 0.5
  });

  const descLen = charCount(op.description);
  checks.push({
    label: "Description length",
    weight: 8,
    score: { ok: 1, missing: 0 }[snippetLength("description", descLen, descPx)] ?? 0.5
  });

  checks.push({
    label: "OG / social tags",
    weight: 5,
    score: (op.og?.title && op.og?.image) ? 1 : (op.og?.title || op.og?.image) ? 0.5 : 0
  });

  // A site in one language needs no hreflang; when there is some, it must be right.
  const hreflangIssues = op.hreflang?.length ? validateHreflang(op.hreflang, withoutTracking(op.url || "")) : [];
  checks.push({
    label: "Hreflang",
    weight: 5,
    score: hreflangIssues.some(i => i.level === "error") ? 0 : hreflangIssues.some(i => i.level === "warn") ? 0.7 : 1
  });

  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const weighted = checks.reduce((s, c) => s + c.weight * c.score, 0);
  const score = Math.round((weighted / totalWeight) * 100);

  return {
    score,
    grade: score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F",
    level: score >= 85 ? "good" : score >= 55 ? "warn" : "bad",
    checks
  };
}

/**
 * @typedef {Object} IndexabilityIssue
 * @property {string} msg
 * @property {string|null} hint
 */

/**
 * @typedef {Object} IndexabilityVerdict
 * @property {"good"|"warn"|"bad"} level
 * @property {string} verdict - human-readable verdict
 * @property {IndexabilityIssue[]} issues
 */

/**
 * Combine on-page + technical signals into a single indexability verdict.
 * @param {Object} op - on-page data
 * @param {Object|null} tech - technical data
 * @returns {IndexabilityVerdict}
 */
export function computeIndexability(op, tech) {
  const issues = [];
  let level = "good";
  let verdict = "Indexable";
  const bad = (v) => { level = "bad"; verdict = v; };
  const warn = (v) => { if (level !== "bad") { level = "warn"; if (v || verdict === "Checking the server…") verdict = v || "Check the details"; } };

  // The server check is still running: say so, and judge what the page itself says.
  if (tech?.pending) {
    // No reason line: the final verdict usually has none, so the list below doesn't move.
    level = "pending";
    verdict = "Checking the server…";
  } else if (!tech?.status) {
    // No HTTP status: the server check failed or never ran. Unknown is not "fine".
    warn("Not verified");
    issues.push({
      msg: "Server check failed, so the HTTP status, redirects and X-Robots-Tag are not verified",
      hint: "Check the internet connection and refresh. If it keeps failing while other sites load, the server may block requests without cookies, and Googlebot may be blocked too."
    });
  } else {
    if (tech.status >= 400) {
      bad("Not indexable");
      issues.push({ msg: `HTTP ${tech.status} response`, hint: "Indexable pages must answer 200. Fix the server error or the broken URL." });
    }
    if (tech.redirected) {
      warn("Redirected");
      issues.push({ msg: `This URL redirects to ${tech.finalUrl}`, hint: "Google indexes the final URL. Link to it directly and make sure it carries the canonical, content and internal links." });
    }
    const xrt = tech.headers?.["x-robots-tag"] || "";
    if (robotsBlocksIndexing(xrt)) {
      bad("Not indexable");
      issues.push({ msg: `X-Robots-Tag header: ${xrt}`, hint: "Remove noindex (or none) from the X-Robots-Tag header at the server or CDN." });
    }
    const pa = tech.robotsTxt?.pathAllowed;
    if (pa && pa.allowed === false) {
      if (level !== "bad") bad("Blocked from crawling");
      issues.push({
        msg: `Blocked by robots.txt (${pa.rule})`,
        hint: "Google can't crawl this URL but can still index it without a description. To get it indexed, allow it in /robots.txt. To keep it out of Google, allow crawling and use noindex."
      });
    } else if (pa === null && tech.robotsTxt?.status) {
      // 5xx or 429: Google itself stops crawling.
      warn();
      issues.push({
        msg: `robots.txt could not be read (HTTP ${tech.robotsTxt.status})`,
        hint: "On a server error Google pauses crawling the site for up to 12 hours, then uses its last cached copy."
      });
    } else if (pa === null && tech.robotsTxt) {
      // The request itself failed, which says more about this check than about Google: a note,
      // as in Fix this first ("robots-unchecked", low), not a warning.
      issues.push({
        msg: `Needle could not read robots.txt (${tech.robotsTxt.error || "the request failed"})`,
        hint: "A common cause is a /robots.txt that redirects to another domain, which Google follows but this check can't. Open /robots.txt in a tab: it should answer 200 (or 404 if you have none)."
      });
    }
  }

  if (op) {
    if (robotsBlocksIndexing(op.robots || "")) {
      bad("Not indexable");
      issues.push({ msg: `Meta robots: ${op.robots}`, hint: 'Remove noindex and none from every <meta name="robots"> and <meta name="googlebot"> tag on the page.' });
    }
    let canonical = op.canonical;
    if (!canonical) canonical = canonicalFromLinkHeader(tech?.headers?.link || "");
    if (canonical) {
      try {
        // Google ignores #fragments, and a campaign link (?utm_…) is the same page.
        const can = new URL(canonical, op.url);
        if (withoutTracking(can.href) !== withoutTracking(op.url)) {
          can.hash = "";
          warn(level === "good" || verdict === "Indexable" ? "Canonicalized away" : undefined);
          issues.push({ msg: `Canonical points elsewhere: ${can.href}`, hint: "If this URL should be indexed, make the canonical point to itself." });
        }
      } catch {}
    } else {
      // Google: a canonical isn't required, and without one it picks the best version itself.
      // So it is noted here, and doesn't make the verdict amber.
      issues.push({ msg: "No canonical declared", hint: 'Add <link rel="canonical" href="' + String(op.url || "...").split("#")[0] + '"> in <head>.' });
    }
    if (op.canonicalDistinct > 1) {
      warn();
      issues.push({ msg: `${op.canonicalDistinct} different canonical URLs on the page`, hint: "Google may ignore all of them. Keep exactly one canonical link." });
    }
    if (op.canonicalOutsideHead) {
      warn();
      issues.push({ msg: "Canonical link inside <body>", hint: "Google only reads rel=canonical in <head>. Move it there." });
    }
  }

  if (!issues.length) issues.push({ msg: "All checks passed", hint: null });
  return { level, verdict, issues };
}

/**
 * The rules in a meta robots or X-Robots-Tag value, each with the crawler it is for.
 * "googlebot: noindex, nofollow" scopes both rules to googlebot; rules without a name are for all
 * crawlers. A date's comma stays inside unavailable_after (RFC 822 and RFC 850 dates have one).
 * Fetch joins repeated headers with ", ", so "otherbot: noindex" followed by a second header
 * "noindex" reads as two otherbot rules: the parts can't be told apart any more.
 * @param {string} value
 * @returns {{scope: string|null, rule: string}[]} rule in lower case, a value rule as "name:value"
 */
export function robotsRules(value) {
  const VALUE_RULES = /^(max-snippet|max-image-preview|max-video-preview|unavailable_after)$/i;
  const parts = [];
  for (const part of String(value || "").split(",")) {
    if (parts.length && /^\s*\d/.test(part) && /unavailable_after\s*:\s*[a-z]+$/i.test(parts[parts.length - 1].trim())) parts[parts.length - 1] += `,${part}`;
    else parts.push(part);
  }
  let scope = null; // null = all crawlers
  const rules = [];
  for (const part of parts) {
    let token = part.trim();
    if (!token) continue;
    const m = token.match(/^([a-z0-9_-]+)\s*:\s*(.*)$/i);
    if (m && !VALUE_RULES.test(m[1])) {
      scope = m[1].toLowerCase();
      token = m[2].trim();
      if (!token) continue;
    }
    const v = token.match(/^([a-z_-]+)\s*:\s*(.*)$/i);
    rules.push({ scope, rule: v ? `${v[1].toLowerCase()}:${v[2].trim()}` : token.toLowerCase() });
  }
  return rules;
}

/** Google reads rules for all crawlers and for googlebot (googlebot-news has its own). */
const forGoogle = (r) => r.scope === null || r.scope === "googlebot";

/**
 * The unavailable_after date Google reads, if any, and whether it has passed.
 * @param {string} value - meta robots or X-Robots-Tag
 * @param {number} [now]
 * @returns {{when: string, passed: boolean}|null} null without a date Google can read (it then ignores the rule)
 */
export function unavailableAfter(value, now = Date.now()) {
  for (const r of robotsRules(value)) {
    if (!forGoogle(r) || !r.rule.startsWith("unavailable_after:")) continue;
    const when = r.rule.slice("unavailable_after:".length).trim();
    const t = Date.parse(when);
    if (!Number.isNaN(t)) return { when, passed: t <= now };
  }
  return null;
}

/**
 * Does a meta robots or X-Robots-Tag value keep the page out of Google? noindex or none for all
 * crawlers or for googlebot, or an unavailable_after date that has passed.
 * @param {string} value
 * @param {number} [now]
 */
export function robotsBlocksIndexing(value, now = Date.now()) {
  if (robotsRules(value).some((r) => forGoogle(r) && (r.rule === "noindex" || r.rule === "none" || (!r.rule.includes(":") && /\bnoindex\b/.test(r.rule))))) return true;
  return !!unavailableAfter(value, now)?.passed;
}

/**
 * Rules Google reads for snippets and AI use (nosnippet and max-snippet also limit AI Overviews).
 * A rule for another crawler (bingbot: nosnippet) doesn't count.
 * @returns {string[]} e.g. ["nosnippet", "max-snippet:50"]
 */
export function snippetDirectives(metaRobots, xRobotsTag) {
  const found = new Set();
  for (const r of [...robotsRules(metaRobots), ...robotsRules(xRobotsTag)]) {
    if (!forGoogle(r)) continue;
    const rule = r.rule;
    if (/^(nosnippet|noarchive|noimageindex|notranslate|max-snippet:-?\d+|max-image-preview:\w+|max-video-preview:-?\d+|unavailable_after:.+)$/.test(rule)) found.add(rule);
  }
  return [...found];
}

/** The rules that limit what Google may quote: nosnippet, and max-snippet under 100 characters. */
export const limitsSnippets = (rule) => rule === "nosnippet" || /^max-snippet:(0|[1-9]\d?)$/.test(rule);

/**
 * What Bing reads for Copilot answers: noarchive keeps the page out of them, nocache shows only its
 * URL, title and snippet (Bing: both together count as nocache). Google ignores both.
 * @returns {"noarchive"|"nocache"|null}
 */
export function copilotLimit(metaRobots, xRobotsTag) {
  const rules = [...robotsRules(metaRobots), ...robotsRules(xRobotsTag)].filter((r) => r.scope === null || r.scope === "bingbot" || r.scope === "msnbot").map((r) => r.rule);
  return rules.includes("nocache") ? "nocache" : rules.includes("noarchive") ? "noarchive" : null;
}

/** rel="canonical" from an HTTP Link header, if any. */
export function canonicalFromLinkHeader(link) {
  // rel may be a list ("preload canonical").
  const m = String(link || "").match(/<([^>]+)>\s*;[^,]*rel\s*=\s*(?:"[^"]*\bcanonical\b[^"]*"|canonical\b)/i);
  return m ? m[1] : "";
}

/** @type {Record<string, {code: number, lang: string}>} */
export const TLD_TO_MARKET = {
  be: { code: 2056, lang: "nl" },
  nl: { code: 2528, lang: "nl" },
  fr: { code: 2250, lang: "fr" },
  de: { code: 2276, lang: "de" },
  es: { code: 2724, lang: "es" },
  it: { code: 2380, lang: "it" },
  pt: { code: 2620, lang: "pt" },
  uk: { code: 2826, lang: "en" },
  "co.uk": { code: 2826, lang: "en" },
  ie: { code: 2372, lang: "en" },
  ca: { code: 2124, lang: "en" },
  us: { code: 2840, lang: "en" },
  au: { code: 2036, lang: "en" },
  "com.au": { code: 2036, lang: "en" },
  nz: { code: 2554, lang: "en" },
  "co.nz": { code: 2554, lang: "en" },
  in: { code: 2356, lang: "en" },
  "co.in": { code: 2356, lang: "en" },
  br: { code: 2076, lang: "pt" },
  "com.br": { code: 2076, lang: "pt" },
  mx: { code: 2484, lang: "es" },
  "com.mx": { code: 2484, lang: "es" },
  at: { code: 2040, lang: "de" },
  ch: { code: 2756, lang: "de" },
  se: { code: 2752, lang: "sv" },
  dk: { code: 2208, lang: "da" },
  no: { code: 2578, lang: "no" },
  pl: { code: 2616, lang: "pl" },
  jp: { code: 2392, lang: "ja" },
  "co.jp": { code: 2392, lang: "ja" }
};

// Markets with several languages: the page's <html lang> picks one.
// <html lang="en-GB"> names the region "gb"; the market table uses the domain "uk".
const REGION_ALIAS = { gb: "uk" };

const MULTILINGUAL = {
  2056: ["nl", "fr", "de"], // Belgium
  2756: ["de", "fr", "it"], // Switzerland
  2124: ["en", "fr"] // Canada
};

/**
 * Default market (DataForSEO location code + language) from the URL's TLD.
 * Supports multi-part TLDs (co.uk, com.au, ...). For multilingual markets the
 * page's language decides (a fr-BE page gets French, not Dutch). On generic
 * domains (.com, .org, .io) an explicit region in the page language decides
 * (en-GB → United Kingdom); a bare "de" says nothing about the country.
 * @param {string} url
 * @param {string} [pageLang] - the page's <html lang>, e.g. "fr-BE"
 * @returns {{code: number, lang: string}|null}
 */
export function detectMarketFromUrl(url, pageLang = "") {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const parts = host.split(".");
    const last2 = parts.slice(-2).join(".");
    const last1 = parts.slice(-1)[0];
    const [lang = "", region = ""] = String(pageLang || "").toLowerCase().split(/[-_]/);
    let m = TLD_TO_MARKET[last2] || TLD_TO_MARKET[last1] || null;
    if (!m && /^[a-z]{2}$/.test(region)) m = TLD_TO_MARKET[REGION_ALIAS[region] || region] || null;
    if (!m) return null;
    return MULTILINGUAL[m.code]?.includes(lang) ? { ...m, lang } : m;
  } catch {
    return null;
  }
}

