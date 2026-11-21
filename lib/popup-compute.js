import { isContentImage } from "./image-rules.js";
import { validateSchema } from "./schema-validator.js";
import { isLanguageChooser } from "./hreflang.js";

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
 * @returns {HealthScore|null}
 */
export function computeHealthScore(op, tech) {
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

  // Hidden H1s don't count, as in "Fix this first".
  const h1Count = op.headings.filter(h => h.level === 1 && !h.hidden).length;
  checks.push({
    label: "H1 structure",
    weight: 8,
    score: h1Count === 1 ? 1 : h1Count > 1 ? 0.4 : 0
  });

  // ----- IMPORTANT: structural quality, correlates with rankings -----
  let prevLevel = 0; let skipped = 0;
  op.headings.forEach(h => { if (prevLevel > 0 && h.level > prevLevel + 1) skipped++; prevLevel = h.level; });
  checks.push({
    label: "Heading hierarchy",
    weight: 6,
    score: skipped === 0 ? 1 : skipped <= 2 ? 0.5 : 0
  });

  const mainWords = op.mainContentWordCount || op.wordCount || 0;
  checks.push({
    label: "Content depth",
    weight: 10,
    // A language chooser is short on purpose.
    score: isLanguageChooser(op.hreflang, op.canonical || op.url) || mainWords >= 600 ? 1 : mainWords >= 300 ? 0.6 : mainWords >= 100 ? 0.3 : 0
  });

  // Content images only, the same set the Images card and "Fix this first" use.
  // Missing alt attribute counts; an empty alt is fine (decoration).
  const contentImgs = (op.images || []).filter(isContentImage);
  const missingAltCount = contentImgs.filter(i => i.altMissing ?? !i.alt).length;
  const oversizedCount = contentImgs.filter(i => i.oversized).length;
  const lazyAboveFoldCount = contentImgs.filter(i => i.lazyAboveFold).length;
  const totalImgs = contentImgs.length;
  let imgScore = 1;
  if (totalImgs > 0) imgScore -= Math.min(0.5, missingAltCount / totalImgs);
  if (oversizedCount > 0) imgScore -= Math.min(0.3, oversizedCount * 0.1);
  if (lazyAboveFoldCount > 0) imgScore -= 0.2;
  checks.push({ label: "Images", weight: 10, score: Math.max(0, imgScore) });

  const validated = validateSchema(op.schema || []);
  const totalSchemas = validated.length;
  const goodSchemas = validated.filter(s => !s.issues.some(i => i.level === "error")).length;
  const schemaScore = totalSchemas === 0 ? 0 : goodSchemas / totalSchemas;
  checks.push({
    label: "Schema markup",
    weight: 10,
    score: schemaScore
  });

  // ----- NICE-TO-HAVE: best practice / CTR signals, low direct ranking impact -----
  const titleLen = op.title?.length || 0;
  checks.push({
    label: "Title length",
    weight: 8,
    score: titleLen >= 30 && titleLen <= 60 ? 1 : titleLen > 0 ? 0.5 : 0
  });

  const descLen = op.description?.length || 0;
  checks.push({
    label: "Description length",
    weight: 8,
    score: descLen >= 70 && descLen <= 160 ? 1 : descLen > 0 ? 0.5 : 0
  });

  checks.push({
    label: "OG / social tags",
    weight: 5,
    score: (op.og?.title && op.og?.image) ? 1 : (op.og?.title || op.og?.image) ? 0.5 : 0
  });

  checks.push({
    label: "Hreflang",
    weight: 5,
    score: op.hreflang?.length ? 1 : 0.7
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
      hint: "Refresh to try again. If it keeps failing, the server may block requests without cookies, and Googlebot may be blocked too."
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
    } else if (pa === null && tech.robotsTxt) {
      warn();
      issues.push({
        msg: `robots.txt could not be read (${tech.robotsTxt.status ? "HTTP " + tech.robotsTxt.status : tech.robotsTxt.error || "network error"})`,
        hint: "On a server error Google pauses crawling the site for up to 12 hours, then uses its last cached copy."
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
        // Google ignores #fragments, so URLs that differ only after "#" are the same page.
        const can = new URL(canonical, op.url); can.hash = "";
        const cur = new URL(op.url); cur.hash = "";
        if (can.href !== cur.href) {
          warn(level === "good" || verdict === "Indexable" ? "Canonicalized away" : undefined);
          issues.push({ msg: `Canonical points elsewhere: ${can.href}`, hint: "If this URL should be indexed, make the canonical point to itself." });
        }
      } catch {}
    } else {
      warn();
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
 * Does a robots directive string (meta robots, googlebot or X-Robots-Tag) stop
 * Google from indexing? Handles "none", user-agent scopes ("bingbot: noindex"
 * applies to Bing only) and value rules ("max-image-preview:none" is not a noindex).
 * @param {string} value
 * @returns {boolean}
 */
export function robotsBlocksIndexing(value) {
  const VALUE_RULES = /^(max-snippet|max-image-preview|max-video-preview|unavailable_after)$/i;
  let scope = null; // null = all crawlers
  for (const part of String(value || "").split(",")) {
    let token = part.trim().toLowerCase();
    if (!token) continue;
    const m = token.match(/^([a-z0-9_-]+)\s*:\s*(.*)$/);
    if (m && !VALUE_RULES.test(m[1])) {
      scope = m[1];
      token = m[2].trim();
      if (!token) continue;
    } else if (m) {
      continue; // a value rule such as max-snippet: 50
    }
    const forGoogle = scope === null || scope === "googlebot";
    if (forGoogle && (token === "noindex" || token === "none" || /\bnoindex\b/.test(token))) return true;
  }
  return false;
}

/** rel="canonical" from an HTTP Link header, if any. */
export function canonicalFromLinkHeader(link) {
  const m = String(link || "").match(/<([^>]+)>\s*;[^,]*rel="?canonical"?/i);
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

