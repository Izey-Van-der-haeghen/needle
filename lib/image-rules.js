/**
 * Image size rules. General checks are always on; a team can add its own
 * expected size (exact or same shape) and file-size limit in Settings.
 */

export const DEFAULT_IMAGE_RULES = { maxKB: 100, width: 0, height: 0, mode: "ratio" };
/** Google recommends large images at least 1200 px wide for Discover and article results. */
export const LEAD_IMAGE_MIN_WIDTH = 1200;

/**
 * @param {Record<string, any>} stored - imgMaxKB, imgWidth, imgHeight, imgMode from chrome.storage.sync
 * @returns {{maxKB: number, width: number, height: number, mode: "exact"|"ratio"}}
 */
export function normaliseImageRules(stored = {}) {
  const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };
  const width = num(stored.imgWidth, 0);
  const height = num(stored.imgHeight, 0);
  // A size rule needs both numbers: half a rule ("1200×0") is no rule.
  const both = width > 0 && height > 0;
  return {
    maxKB: num(stored.imgMaxKB, DEFAULT_IMAGE_RULES.maxKB),
    width: both ? width : 0,
    height: both ? height : 0,
    mode: stored.imgMode === "exact" ? "exact" : "ratio"
  };
}

/** Does an image match the team's expected size? null when no rule is set or the size is unknown. */
export function matchesExpectedSize(img, rules) {
  if (!rules.width || !rules.height || !img.naturalWidth || !img.naturalHeight) return null;
  if (rules.mode === "exact") {
    // The uploaded file: with a srcset, the loaded file depends on the screen, so take the largest one offered.
    const w = img.largestWidth || img.naturalWidth;
    if (w === img.naturalWidth) return w === rules.width && img.naturalHeight === rules.height;
    // Height scaled up from a smaller file: allow the rounding of that file's height.
    const h = img.naturalHeight * w / img.naturalWidth;
    return w === rules.width && Math.abs(h - rules.height) <= Math.max(1, w / img.naturalWidth);
  }
  const want = rules.width / rules.height;
  const have = img.naturalWidth / img.naturalHeight;
  return Math.abs(have - want) / want <= 0.02;
}

/**
 * Size problems of one image, as [label, kind] pairs.
 * @param {Object} img - ANALYZE_ONPAGE image
 * @param {ReturnType<typeof normaliseImageRules>} rules
 * @returns {Array<[string, "warn"|"bad"]>}
 */
export function imageSizeIssues(img, rules) {
  const out = [];
  if (img.bytes > rules.maxKB * 1024) out.push([`over ${rules.maxKB} KB`, "warn"]);
  if (img.upscaled) out.push(["shown larger than the file (blurry)", "warn"]);
  if (img.downscaled) out.push(["much larger than shown", "warn"]);
  const fit = matchesExpectedSize(img, rules);
  if (fit === false) out.push([rules.mode === "exact" ? `not ${rules.width}×${rules.height}` : `not ${rules.width}:${rules.height} in shape`, "warn"]);
  return out;
}

/**
 * The page's lead image (the largest content image near the top) and whether it
 * is wide enough for Google Discover.
 * @param {Array<Object>} images - content images, in page order
 * @returns {{img: Object, wideEnough: boolean}|null}
 */
export function leadImageCheck(images, og = null) {
  const sized = (images || []).filter((i) => i.naturalWidth && i.naturalHeight);
  if (!sized.length) return null;
  const top = sized.filter((i) => i.aboveFold);
  const pool = top.length ? top : sized.slice(0, 3);
  const img = pool.reduce((a, b) => (b.naturalWidth * b.naturalHeight > a.naturalWidth * a.naturalHeight ? b : a));
  // A large share image (og:image with its declared width) can serve the large preview too,
  // and so can a larger file in the image's srcset.
  const shareWidth = og?.image && og.imageWidth ? og.imageWidth : 0;
  const width = Math.max(img.naturalWidth, img.largestWidth || 0);
  return { img, width, shareWidth, wideEnough: width >= LEAD_IMAGE_MIN_WIDTH || shareWidth >= LEAD_IMAGE_MIN_WIDTH };
}

/**
 * Is the page an article? Discover looks for content suited to interest-based feeds, "such as
 * articles and videos" (Google, Discover), so the Discover check runs on articles only.
 * Article, BlogPosting, NewsArticle and their subtypes in JSON-LD (also as a WebPage's mainEntity),
 * or og:type "article". Microdata is left out: its types are collected for the whole page, so a
 * list of article cards would count too.
 * @param {Object} onpage - ANALYZE_ONPAGE result
 * @returns {boolean}
 */
export function isArticleLike(onpage) {
  if (String(onpage?.og?.type || "").trim().toLowerCase() === "article") return true;
  const names = (t) => (Array.isArray(t) ? t : String(t || "").split(","))
    .map((s) => String(s).trim().split(/[/:#]/).pop());
  return (onpage?.schema || []).some((s) => {
    const main = s.raw?.mainEntity;
    const types = [...names(s.type), ...(Array.isArray(main) ? main : [main]).flatMap((m) => names(m?.["@type"]))];
    return types.some((t) => /(?:Article|BlogPosting)$/.test(t));
  });
}

/**
 * The max-image-preview that Google applies: "none", "standard", "large", or "" when none is set.
 * Rules aimed at other crawlers ("bingbot: max-image-preview:none") don't count; an agent prefix
 * holds until the next one, as in robotsBlocksIndexing. With several, the most restrictive wins.
 * @param {string} metaRobots - robots and googlebot meta tags, joined with commas
 * @param {string} xRobotsTag - the X-Robots-Tag header
 * @returns {""|"none"|"standard"|"large"}
 */
export function imagePreviewSetting(metaRobots, xRobotsTag) {
  const RANK = { none: 0, standard: 1, large: 2 };
  let found = "";
  for (const value of [metaRobots, xRobotsTag]) {
    let scope = null;
    for (const part of String(value || "").split(",")) {
      let t = part.trim().toLowerCase();
      const m = t.match(/^([a-z0-9_-]+)\s*:\s*(.*)$/);
      if (m && !/^(max-snippet|max-image-preview|max-video-preview|unavailable_after)$/.test(m[1])) {
        scope = m[1];
        t = m[2].trim();
      }
      const p = t.match(/^max-image-preview\s*:\s*(none|standard|large)$/);
      if (p && (scope === null || scope === "googlebot") && (!found || RANK[p[1]] < RANK[found])) found = p[1];
    }
  }
  return found;
}

/**
 * The Discover check: on an article, is the main image wide enough, and may Google show it large?
 * Large images need max-image-preview:large, or AMP (Google, Discover).
 * @param {Array<Object>} images - content images, in page order
 * @param {Object} onpage - ANALYZE_ONPAGE result (robots, og, schema, amp)
 * @param {string} [xRobotsTag]
 * @returns {null|(ReturnType<typeof leadImageCheck> & {preview: string, largePreview: boolean})}
 *   null when the page isn't an article or has no sized image
 */
export function discoverCheck(images, onpage, xRobotsTag = "") {
  if (!isArticleLike(onpage)) return null;
  const lead = leadImageCheck(images, onpage?.og);
  if (!lead) return null;
  const preview = imagePreviewSetting(onpage?.robots, xRobotsTag);
  return { ...lead, preview, largePreview: preview === "large" || (!preview && !!onpage?.amp) };
}

/**
 * Set each image's `oversized` flag with the team's file-size limit, so the
 * checklist score, report and handoff use the same rule.
 */
export function applyImageRules(images, rules) {
  for (const i of images || []) i.oversized = i.bytes > rules.maxKB * 1024;
  return images;
}

/**
 * A vector image: a .svg path, a query value "svg" (?format=svg), or a data:image/svg+xml URL.
 * A PNG rendition such as Logo.svg.png is not one. content.js has a copy of this rule.
 * @param {string} src
 * @returns {boolean}
 */
export function isSvgSource(src) {
  const s = String(src || "");
  if (/^data:image\/svg\+xml[;,]/i.test(s)) return true;
  try {
    const u = new URL(s);
    if (/\.svgz?$/i.test(u.pathname)) return true;
    return [...u.searchParams.values()].some((v) => /^(svg|image\/svg\+xml)$/i.test(v));
  } catch {
    return /\.svgz?(?:[?#]|$)/i.test(s);
  }
}

const CHROME_CONTEXTS = new Set(["header", "footer", "nav", "sidebar"]);
/**
 * Images a reader sees as content: not in header, menu, footer or sidebar, not a
 * CSS background, not an SVG icon, and at least 200 px on both sides.
 */
export function isContentImage(img) {
  if (CHROME_CONTEXTS.has(img.context) || img.isBackground || img.format === "svg" || isSvgSource(img.src)) return false;
  const w = img.displayedWidth || 0;
  const h = img.displayedHeight || 0;
  if (w > 0 && h > 0) return w >= 200 && h >= 200;
  const nw = img.naturalWidth || 0;
  const nh = img.naturalHeight || 0;
  return !(nw > 0 && nh > 0 && (nw < 200 || nh < 200));
}

/**
 * The note for lazy images that haven't loaded yet (their size on screen can't be judged),
 * or "" when there are none. Images that failed to load are left out: they get "does not load".
 * @param {Array<{lazy?: boolean, loaded?: boolean, brokenLoad?: boolean}>} images
 * @returns {string}
 */
export function lazyNote(images) {
  const n = (images || []).filter((i) => i.lazy && i.loaded === false && !i.brokenLoad).length;
  if (!n) return "";
  return n === 1
    ? "1 image hasn't loaded yet (lazy loading), so how large it is shown can't be checked. Scroll to it on the page, then check again."
    : `${n.toLocaleString("en")} images haven't loaded yet (lazy loading), so how large they are shown can't be checked. Scroll to them on the page, then check again.`;
}

/**
 * What "Measure them" reports.
 * @param {{got: number, asked: number, missing: number, known: number}} n - sizes received, files asked
 *   about (at most the sizer's limit), files without a size, files whose size was already known
 * @returns {string}
 */
export function measureNote({ got, asked, missing, known }) {
  const images = (k) => `${k.toLocaleString("en")} image${k === 1 ? "" : "s"}`;
  if (got === 0) return "The image servers gave no file sizes.";
  const more = missing > asked ? ` (the first ${asked.toLocaleString("en")} of ${images(missing)}; measure again for the rest)` : "";
  if (got < asked) return `Measured ${got.toLocaleString("en")} of ${images(asked)}${more}; the servers gave no size for the rest.`;
  const others = known > 0 ? ` The other ${known === 1 ? "image's size was" : "images' sizes were"} already known.` : "";
  return `Measured ${images(got)}${more}.${others}`;
}
