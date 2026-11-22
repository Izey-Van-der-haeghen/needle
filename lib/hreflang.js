import { urlKey } from "./urls.js";

/**
 * Validate a set of hreflang declarations from the page.
 *
 * Checks (no network calls — runs purely on the data the content script
 * already collected). Reciprocity / return-tag validation requires fetching
 * each referenced URL and is deliberately out of scope here.
 *
 * @param {Array<{lang: string, href: string}>} hreflang
 * @param {string} [currentUrl]
 * @returns {Array<{level: "error"|"warn"|"info", msg: string, hint?: string}>} info: a recommendation, not a problem
 */
const CODE_HINT = "Use a language code (en, nl) with an optional country code (en-GB, nl-BE), or \"x-default\".";

// ISO 639-1 language codes (2-letter), the only ones Google supports for hreflang.
const ISO_639_1 = new Set(("aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu").split(" "));
// ISO 3166-1 alpha-2 country codes.
const ISO_3166_1 = new Set(("ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bl bm bn bo bq br bs bt bv bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg eh er es et fi fj fk fm fo fr ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mf mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug um us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw").split(" "));
// Country codes used as a language by mistake, and old codes ISO 639-1 replaced.
const LOOKS_LIKE_A_COUNTRY = { gb: "en-GB", us: "en-US", jp: "ja", dk: "da", cz: "cs", gr: "el", ua: "uk", cn: "zh-CN", at: "de-AT", kp: "ko-KP", vn: "vi", rs: "sr" };
const LEGACY_LANGUAGE = { iw: "he", in: "id", ji: "yi" };

export function validateHreflang(hreflang, currentUrl) {
  /** @type {Array<{level: string, msg: string, hint?: string}>} */
  const issues = [];

  if (!Array.isArray(hreflang) || hreflang.length === 0) return issues;

  // Google: "Only language codes listed in ISO 639-1 and region codes listed in ISO 3166-1
  // Alpha 2 are supported" (so not es-419, and not a three-letter code such as fil).
  // Language + optional script (4 letters) + optional region, or "x-default". Case-insensitive
  // like BCP 47 and Google; `i` without `u` keeps the match ASCII-only.
  const TAG = /^(x-default|([a-z]{2,3})(-[a-z]{4})?(-([a-z0-9]{2,3}))?)$/i;

  // 1. Format validation
  hreflang.forEach(h => {
    const lang = (h.lang || "").trim();
    const m = lang.match(TAG);
    if (!m) {
      issues.push({ level: "error", msg: `Invalid hreflang code: "${lang}"`, hint: CODE_HINT });
      return;
    }
    if (m[1].toLowerCase() === "x-default") return;
    const language = m[2].toLowerCase();
    const region = m[5]?.toLowerCase();
    if (!ISO_639_1.has(language)) {
      const country = LOOKS_LIKE_A_COUNTRY[language];
      const legacy = LEGACY_LANGUAGE[language];
      issues.push({
        level: "error",
        msg: `Invalid hreflang language: "${lang}"`,
        hint: country ? `"${language}" is a country code, not a language code: use ${country}.` : legacy ? `"${language}" is an old code: use ${legacy}.` : `Google supports two-letter ISO 639-1 language codes only. ${CODE_HINT}`
      });
    } else if (region && !ISO_3166_1.has(region)) {
      const better = { uk: "GB" }[region];
      issues.push({
        level: "error",
        msg: `Invalid hreflang region: "${lang}"`,
        hint: better ? `"${region.toUpperCase()}" is not a country code: use ${better}.` : `"${region.toUpperCase()}" is not a two-letter ISO 3166-1 country code; Google ignores it.`
      });
    }
  });

  // 2. Duplicates: nl-BE and nl-be are the same tag; report the spellings as declared. The same
  // code for two different URLs is a conflict; the same link twice is only untidy.
  const seen = new Map();
  hreflang.forEach(h => {
    const lang = (h.lang || "").trim();
    const key = lang.toLowerCase();
    seen.set(key, [...(seen.get(key) || []), { lang, href: urlKey(h.href || "", currentUrl || "https://example.com/") || h.href }]);
  });
  seen.forEach((entries) => {
    if (entries.length < 2) return;
    const conflict = new Set(entries.map((e) => e.href)).size > 1;
    const names = [...new Set(entries.map((e) => e.lang))].map(l => `"${l}"`).join(" / ");
    issues.push(conflict
      ? { level: "error", msg: `Duplicate hreflang tag: ${names} (${entries.length}×), for ${new Set(entries.map((e) => e.href)).size} different URLs`, hint: "Each hreflang value may point to one URL only; Google can't tell which one is meant." }
      : { level: "info", msg: `${names} is listed ${entries.length}× with the same URL`, hint: "Harmless, but one link per language is enough." });
  });

  // 3. x-default: recommended by Google, not required.
  if (!hreflang.some(h => (h.lang || "").trim().toLowerCase() === "x-default")) {
    issues.push({
      level: "info",
      msg: "No x-default declared",
      hint: "Recommended: add <link rel=\"alternate\" hreflang=\"x-default\" href=\"…\"> for visitors whose language matches none of your versions."
    });
  }

  // 4. Self-reference
  if (currentUrl) {
    const norm = (u) => urlKey(u, currentUrl);
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
  const norm = (u) => urlKey(u, pageUrl);
  const me = norm(pageUrl);
  const list = hreflang || [];
  const isDefault = (h) => String(h.lang || "").toLowerCase() === "x-default";
  const languages = list.filter((h) => !isDefault(h));
  return !!me && list.some((h) => isDefault(h) && norm(h.href) === me)
    && languages.length >= 2 && !languages.some((h) => norm(h.href) === me);
}
