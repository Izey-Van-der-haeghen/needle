/**
 * Validate a set of hreflang declarations from the page.
 *
 * Checks (no network calls — runs purely on the data the content script
 * already collected). Reciprocity / return-tag validation requires fetching
 * each referenced URL and is deliberately out of scope here.
 *
 * @param {Array<{lang: string, href: string}>} hreflang
 * @param {string} [currentUrl]
 * @returns {Array<{level: "error"|"warn"|"info", msg: string, hint?: string}>}
 */
export function validateHreflang(hreflang, currentUrl) {
  /** @type {Array<{level: string, msg: string, hint?: string}>} */
  const issues = [];

  if (!Array.isArray(hreflang) || hreflang.length === 0) return issues;

  // Language (ISO 639-1, 2-3 letters) + optional script (4 letters) + optional
  // region (ISO 3166-1 alpha-2; Google does not support numeric regions like 419),
  // or "x-default". Case-insensitive like BCP 47 and Google; `i` without `u` keeps
  // the match ASCII-only, so look-alike letters don't pass.
  const TAG = /^(x-default|[a-z]{2,3}(-[a-z]{4})?(-[a-z]{2})?)$/i;
  // Regions people often use that are not ISO 3166-1 country codes.
  const BAD_REGIONS = { uk: "GB", eu: null, un: null };

  // 1. Format validation
  hreflang.forEach(h => {
    const lang = (h.lang || "").trim();
    const region = lang.split("-").slice(-1)[0].toLowerCase();
    if (!TAG.test(lang)) {
      issues.push({
        level: "error",
        msg: `Invalid hreflang code: "${lang}"`,
        hint: "Use a language code (en, nl) with an optional country code (en-GB, nl-BE), or \"x-default\"."
      });
    } else if (lang.includes("-") && region in BAD_REGIONS) {
      issues.push({
        level: "error",
        msg: `Invalid hreflang region: "${lang}"`,
        hint: BAD_REGIONS[region] ? `"${region.toUpperCase()}" is not a country code: use ${BAD_REGIONS[region]}.` : `"${region.toUpperCase()}" is not a country code; Google ignores it.`
      });
    }
  });

  // 2. Duplicates: nl-BE and nl-be are the same tag; report the spellings as declared
  const seen = new Map();
  hreflang.forEach(h => {
    const lang = (h.lang || "").trim();
    const key = lang.toLowerCase();
    seen.set(key, [...(seen.get(key) || []), lang]);
  });
  seen.forEach((langs) => {
    if (langs.length > 1) {
      issues.push({
        level: "error",
        msg: `Duplicate hreflang tag: ${[...new Set(langs)].map(l => `"${l}"`).join(" / ")} (${langs.length}×)`,
        hint: "Each hreflang value should appear exactly once per page; remove the duplicates."
      });
    }
  });

  // 3. x-default
  if (!hreflang.some(h => (h.lang || "").trim().toLowerCase() === "x-default")) {
    issues.push({
      level: "warn",
      msg: "No x-default declared",
      hint: "Add <link rel=\"alternate\" hreflang=\"x-default\" href=\"…\"> for users whose language doesn't match any of your variants."
    });
  }

  // 4. Self-reference
  if (currentUrl) {
    // Drop the #fragment (Google ignores it) first, so the trailing slash can then be trimmed.
    const norm = (u) => { try { const x = new URL(u, currentUrl); x.hash = ""; return x.href.replace(/\/$/, ""); } catch { return ""; } };
    const me = norm(currentUrl);
    if (me && !hreflang.some(h => norm(h.href) === me)) {
      issues.push({
        level: "warn",
        msg: "Missing self-referencing hreflang",
        hint: "Each page should include a hreflang tag pointing to itself; without it Google may ignore the cluster."
      });
    }
  }

  // 5. Mixed protocols
  const protocols = new Set();
  hreflang.forEach(h => {
    try { protocols.add(new URL(h.href, currentUrl || "https://example.com").protocol); } catch {}
  });
  if (protocols.size > 1) {
    issues.push({
      level: "warn",
      msg: "Mixed http/https hreflang targets",
      hint: "Use the same protocol (preferably https) for every hreflang entry."
    });
  }

  // 6. Relative and protocol-relative URLs
  const relativeCount = hreflang.filter(h => {
    const href = (h.href || "").trim();
    return href && !/^https?:\/\//i.test(href);
  }).length;
  if (relativeCount > 0) {
    issues.push({
      level: "error",
      msg: `${relativeCount} hreflang URL${relativeCount === 1 ? " is" : "s are"} not fully qualified`,
      hint: "Google requires full URLs in hreflang, including https://."
    });
  }

  return issues;
}

/**
 * Is this page a language chooser? It is its own x-default and links to at least two
 * language versions elsewhere, none of them itself. Such a page is short on purpose.
 * (An English home page that is also the x-default lists itself as "en", so it doesn't count.)
 * @param {Array<{lang: string, href: string}>} hreflang
 * @param {string} pageUrl
 */
export function isLanguageChooser(hreflang, pageUrl) {
  const norm = (u) => { try { const x = new URL(u, pageUrl); x.hash = ""; return x.href.replace(/\/$/, ""); } catch { return ""; } };
  const me = norm(pageUrl);
  const list = hreflang || [];
  const isDefault = (h) => String(h.lang || "").toLowerCase() === "x-default";
  const languages = list.filter((h) => !isDefault(h));
  return !!me && list.some((h) => isDefault(h) && norm(h.href) === me)
    && languages.length >= 2 && !languages.some((h) => norm(h.href) === me);
}
