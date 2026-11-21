import { formatAge } from "./cache.js";

/**
 * Escape text for HTML (element content and quoted attributes).
 * For URLs in href/src also check isSafeHttpUrl.
 * @param {*} s
 * @returns {string}
 */
export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

const SYMBOLS = { good: "✓", warn: "!", bad: "✗" };

/**
 * A status label. The text is escaped, and good/warn/bad carry a symbol so
 * the meaning never rests on colour alone.
 * @param {string|number} text
 * @param {"good"|"warn"|"bad"|"neutral"} [kind="neutral"]
 * @returns {string} HTML
 */
export function tag(text, kind = "neutral") {
  const sym = SYMBOLS[kind];
  return `<span class="tag ${kind}">${sym ? `<span class="tag-sym" aria-hidden="true">${sym}</span>` : ""}${escapeHtml(text)}</span>`;
}

/**
 * A label/value row.
 * @param {string} labelHtml - already safe HTML
 * @param {string} valueHtml - already safe HTML
 * @returns {string} HTML
 */
export function row(labelHtml, valueHtml) {
  return `<div class="row"><div class="k">${labelHtml}</div><div class="v">${valueHtml ?? "—"}</div></div>`;
}

let measureCtx;
const getMeasureCtx = () => {
  if (measureCtx === undefined) {
    try { measureCtx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null; } catch { measureCtx = null; }
  }
  return measureCtx;
};

/**
 * Pixel width of text in a font, measured with canvas.
 * @param {string} text
 * @param {string} [font="20px Arial"]
 * @returns {number}
 */
export function pixelWidth(text, font = "20px Arial") {
  const ctx = getMeasureCtx();
  if (!text || !ctx) return 0;
  ctx.font = font;
  return Math.ceil(ctx.measureText(text).width);
}

/**
 * Google truncates snippets by pixel width. These are the widths Needle uses
 * for the title (desktop, 20px Arial) and the description (14px Arial).
 */
export const SNIPPET = {
  titleFont: "20px Arial",
  titleMaxPx: 600,
  titleIdealPx: 580,
  descFont: "14px Arial",
  descMaxPx: 990,
  descIdealPx: 920
};

/**
 * Status label for a pixel width.
 * @param {number} px
 * @param {number} ideal
 * @param {number} max - truncation point
 * @returns {string} HTML
 */
export function pixelTag(px, ideal, max) {
  if (px === 0) return tag("0 px", "bad");
  if (px > max) return tag(`${px} px, cut off`, "bad");
  // Between ideal and max it still fits: worth knowing, nothing to fix.
  if (px > ideal) return tag(`${px} px, near the limit`, "neutral");
  if (px < ideal * 0.5) return tag(`${px} px, short`, "warn");
  return tag(`${px} px`, "good");
}

/**
 * Status label for a character count.
 * @param {number} count
 * @param {number} idealMin
 * @param {number} idealMax
 * @param {number} [hardMax]
 * @param {boolean} [fitsWidth] - the pixel width is known and fits: Google cuts by pixels, so a long count is no problem
 * @returns {string} HTML
 */
export function charTag(count, idealMin, idealMax, hardMax, fitsWidth = false) {
  if (count === 0) return tag("empty", "bad");
  if (fitsWidth && count > idealMax) return tag(`${count} characters`, "neutral");
  if (hardMax && count > hardMax) return tag(`${count} characters, too long`, "bad");
  if (count > idealMax) return tag(`${count} characters, long`, "warn");
  if (count < idealMin) return tag(`${count} characters, short`, "warn");
  return tag(`${count} characters`, "good");
}

/**
 * Bytes as kilobytes.
 * @param {number} b
 * @returns {string} e.g. "12.4 KB", or "—" when unknown
 */
export function fmtKB(b) {
  return b ? (b / 1024).toFixed(1) + " KB" : "—";
}

/**
 * "Saved 5 min ago · Refresh" line for cached results.
 * @param {number|null} age - ms since the result was saved; 0/null = fresh
 * @param {string|null} refreshKind - value for data-refresh on the button
 * @returns {string} HTML
 */
export function cachedBanner(age, refreshKind) {
  if (!age) return "";
  return `<div class="cached-banner">
    <span>Saved result from ${escapeHtml(formatAge(age))}</span>
    ${refreshKind ? `<button type="button" class="link-btn" data-refresh="${escapeHtml(refreshKind)}">Refresh</button>` : ""}
  </div>`;
}

/**
 * Label for a Core Web Vitals category from CrUX.
 * @param {string} category - FAST, AVERAGE or SLOW
 * @returns {string} HTML
 */
export function cwvTag(category) {
  if (category === "FAST") return tag("good", "good");
  if (category === "AVERAGE") return tag("needs work", "warn");
  if (category === "SLOW") return tag("poor", "bad");
  return tag("no data", "neutral");
}

/**
 * Relative time.
 * @param {number} ts - timestamp in ms
 * @returns {string}
 */
export function timeAgo(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** Numbers with thousands separators, English style. */
export function fmtNum(n) {
  return n == null || Number.isNaN(Number(n)) ? "—" : Number(n).toLocaleString("en");
}

/**
 * One spreadsheet cell for a copied table. Page text that starts with = + - @
 * would run as a formula when pasted, so it gets a leading apostrophe.
 * @param {*} v
 * @returns {string}
 */
export function sheetCell(v) {
  const s = String(v ?? "").replace(/[\t\r\n]+/g, " ");
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

/**
 * Tab-separated rows, ready to paste into a spreadsheet.
 * @param {string[]} header
 * @param {Array<Array<*>>} rows
 * @returns {string}
 */
export function tsv(header, rows) {
  return [header, ...rows].map((r) => r.map(sheetCell).join("\t")).join("\n");
}

/**
 * File names that say nothing: camera/CMS IDs, hashes, size and copy suffixes.
 * Real words pass, also when they end in a number ("iphone-15.jpg").
 * @param {string} src
 * @returns {boolean}
 */
export function hasUncleanFilename(src) {
  const filename = (String(src || "").split("?")[0].split("/").pop() || "").toLowerCase();
  const stem = filename.replace(/\.(jpe?g|png|gif|webp|avif|svg|bmp)(\.[a-z]+)?$/i, "");
  if (!stem) return true;
  if (/\d{2,}x\d{2,}/.test(stem)) return true; // 1200x630, not 4x4
  if (/-(jpg|jpeg|png|gif|webp|avif)$/i.test(stem)) return true;
  if (/-(scaled|copy|kopie)(-\d+)?$/.test(stem)) return true;
  // Camera and CMS names only when that is all the name says ("IMG_4512", not "photo-2024-team-day").
  if (/^(wp-image-\d+|img[_-]?\d+|image[_-]?\d+|dsc[_-]?\d+|photo[_-]?\d+|p\d{4,}|pic\d+|untitled(-\d+)?|screen-?shot(?:[-_ ]+\d.*)?)$/i.test(stem)) return true;
  if (/^[a-f0-9]{8,}$/.test(stem)) return true;
  // Long run without separators: only flag it when it looks random (several digits, or no vowels).
  if (/^[a-z0-9]{12,}$/i.test(stem) && (/\d.*\d.*\d/.test(stem) || !/[aeiouy]/i.test(stem))) return true;
  return false;
}

/**
 * The popup's layout size at a browser zoom, given outerWidth / innerWidth.
 * Chrome caps a popup at 800 × 600 screen pixels. Only a ratio that matches one of
 * Chrome's zoom levels counts: an odd value (headless Chrome, a popup still growing)
 * must never shrink a popup at 100 %.
 * @param {number} ratio
 * @returns {{width: number, height: number}|null} null: use the normal 560 × 600
 */
export function popupSizeForZoom(ratio) {
  const zoom = [1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5].find((z) => Math.abs(ratio / z - 1) < 0.03);
  if (!zoom) return null;
  return { width: Math.min(560, Math.floor(800 / zoom)), height: Math.min(600, Math.floor(600 / zoom)) };
}

/**
 * Is the tab an HTML page? A text file, XML or an image opened in a tab is not, and
 * auditing it as a page only produces false alarms ("No <title>"). An empty type
 * (a result cached by an older version) counts as HTML.
 * @param {string} [contentType] - document.contentType of the tab
 */
export function isHtmlDocument(contentType) {
  return !contentType || /^(text\/html|application\/xhtml\+xml)\b/i.test(contentType);
}

/**
 * What the tabs show instead of an audit when the tab is not an HTML page.
 * @param {string} contentType
 * @param {string} url
 * @returns {string} HTML
 */
export function notHtmlNotice(contentType, url) {
  const path = (() => { try { return new URL(url).pathname; } catch { return ""; } })();
  const llms = /^\/llms(-full)?\.txt$/i.test(path);
  const type = String(contentType || "").toLowerCase();
  // Plain words for the marketers who use Needle; the type itself only when there is no word for it.
  const what = /^text\/plain\b/.test(type) ? "a plain text file"
    : /xml/.test(type) ? "an XML file"
    : /^image\//.test(type) ? "an image"
    : /json/.test(type) ? "a JSON file"
    : /pdf/.test(type) ? "a PDF"
    : `a file of type <span class="mono">${escapeHtml(contentType)}</span>`;
  const subject = path && path !== "/" ? `<span class="mono">${escapeHtml(path)}</span>` : "This address";
  return `<div class="empty-state">
      <h2>This isn't an HTML page</h2>
      <p>${subject} is ${what}, not a web page. Needle audits web pages, so there is nothing to check here.</p>
      ${llms ? '<p>To see whether AI tools can find this file, open any page of the site: the AI tab lists <span class="mono">/llms.txt</span> and <span class="mono">/llms-full.txt</span>.</p>' : ""}
    </div>`;
}
