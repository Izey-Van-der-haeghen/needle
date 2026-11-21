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
  return {
    maxKB: num(stored.imgMaxKB, DEFAULT_IMAGE_RULES.maxKB),
    width: num(stored.imgWidth, 0),
    height: num(stored.imgHeight, 0),
    mode: stored.imgMode === "exact" ? "exact" : "ratio"
  };
}

/** Does an image match the team's expected size? null when no rule is set or the size is unknown. */
export function matchesExpectedSize(img, rules) {
  if (!rules.width || !rules.height || !img.naturalWidth || !img.naturalHeight) return null;
  if (rules.mode === "exact") return img.naturalWidth === rules.width && img.naturalHeight === rules.height;
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
 * Set each image's `oversized` flag with the team's file-size limit, so the
 * checklist score, report and handoff use the same rule.
 */
export function applyImageRules(images, rules) {
  for (const i of images || []) i.oversized = i.bytes > rules.maxKB * 1024;
  return images;
}

const CHROME_CONTEXTS = new Set(["header", "footer", "nav", "sidebar"]);
/**
 * Images a reader sees as content: not in header, menu, footer or sidebar, not a
 * CSS background, not an SVG icon, and at least 200 px on both sides.
 */
export function isContentImage(img) {
  if (CHROME_CONTEXTS.has(img.context) || img.isBackground || img.format === "svg") return false;
  const w = img.displayedWidth || 0;
  const h = img.displayedHeight || 0;
  if (w > 0 && h > 0) return w >= 200 && h >= 200;
  const nw = img.naturalWidth || 0;
  const nh = img.naturalHeight || 0;
  return !(nw > 0 && nh > 0 && (nw < 200 || nh < 200));
}
