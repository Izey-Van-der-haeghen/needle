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
 * @param {"good"|"warn"|"bad"|"neutral"|"info"} [kind="neutral"] - info: for information only, nothing to fix
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

// The snippet widths live in lib/snippet.js (no DOM there), shared with findings and the score.
export { SNIPPET } from "./snippet.js";
import { cwvStatus } from "./labels.js";

/**
 * Status label for a pixel width.
 * @param {number} px
 * @param {number} ideal
 * @param {number} max - truncation point
 * @returns {string} HTML
 */
export function pixelTag(px, ideal, max) {
  const v = snippetWidthVerdict(px, ideal, max);
  return tag(v.label, v.kind);
}

/**
 * The verdict for a title or description width, the one rule the popup card and the report share.
 * @param {number} px
 * @param {number} ideal
 * @param {number} max - truncation point
 * @returns {{label: string, kind: "good"|"warn"|"bad"|"info"}}
 */
export function snippetWidthVerdict(px, ideal, max) {
  if (px === 0) return { label: "0 px", kind: "bad" };
  if (px > max) return { label: `${px} px, cut off`, kind: "bad" };
  // Between ideal and max it still fits: worth knowing, nothing to fix.
  if (px > ideal) return { label: `${px} px, near the limit`, kind: "info" };
  if (px < ideal * 0.5) return { label: `${px} px, short`, kind: "warn" };
  return { label: `${px} px`, kind: "good" };
}

/**
 * Status label for a character count.
 * @param {number} count
 * @param {number} idealMin
 * @param {number} idealMax
 * @param {number} [hardMax]
 * @param {boolean} [widthKnown] - the pixel width was measured: it gives the verdict (Google cuts by
 *   pixels), so the count is shown as information only
 * @returns {string} HTML
 */
export function charTag(count, idealMin, idealMax, hardMax, widthKnown = false) {
  if (count === 0) return tag("empty", "bad");
  if (widthKnown) return tag(`${count} characters`, "info");
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
export function cachedBanner(age, refreshKind, { always = false, now = new Date() } = {}) {
  if (!age && !always) return "";
  // A fresh audit says when it was made: in the side panel it can stay open while the page changes.
  const when = age ? (formatAge(age) === "just now" ? "Saved just now" : `Saved result from ${formatAge(age)}`) : `Audited at ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  return `<div class="cached-banner">
    <span>${escapeHtml(when)}</span>
    ${refreshKind ? `<button type="button" class="link-btn" data-refresh="${escapeHtml(refreshKind)}">Refresh</button>` : ""}
  </div>`;
}

/**
 * Label for a Core Web Vitals category from CrUX.
 * @param {string} category - FAST, AVERAGE or SLOW
 * @returns {string} HTML
 */
export function cwvTag(category) {
  return tag(...cwvStatus(category));
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
  // Phone and camera names with a date and time: IMG_20231105_123456 (Android), PXL_20231105_123456789.MP
  // (Pixel), IMG-20231105-WA0001 (WhatsApp), DSCF1234, DJI_0001, GOPR1234.
  if (/^(img|pxl|vid|mvimg|dsc[fn]?|dji|gopr)[_-]?\d+(?:[_-]\d+)*(?:[_.-](?:hdr|mp|portrait|night|wa\d+))?(?:~\d+)?$/i.test(stem)) return true;
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

/**
 * Today's date (or a given moment) as YYYY-MM-DD in the user's own timezone. toISOString() would
 * give the UTC day: in Brussels between midnight and 1:00 that is still yesterday.
 * @param {Date} [d]
 * @returns {string}
 */
export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A data: URL has no file name: name its type and size instead of showing kilobytes of base64.
 * @param {string} src
 * @returns {string} e.g. "Inline image (PNG, 2.3 KB)"
 */
export function inlineImageLabel(src) {
  const m = String(src).match(/^data:image\/([a-z0-9.+-]+)?/i);
  const type = (m?.[1] || "").replace(/\+xml$/i, "").toUpperCase();
  const comma = String(src).indexOf(",");
  const b64 = /;base64,/i.test(String(src).slice(0, comma + 1));
  const bytes = comma < 0 ? 0 : b64 ? Math.floor((src.length - comma - 1) * 3 / 4) : src.length - comma - 1;
  return `Inline image (${type ? `${type}, ` : ""}${(bytes / 1024).toFixed(1)} KB)`;
}
