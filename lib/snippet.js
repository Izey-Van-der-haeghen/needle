/**
 * Google truncates title and description snippets by pixel width. These are the widths Needle
 * uses (desktop): the title in 20px Arial, the description in 14px Arial.
 */
export const SNIPPET = {
  titleFont: "20px Arial",
  titleMaxPx: 600,
  titleIdealPx: 580,
  descFont: "14px Arial",
  descMaxPx: 990,
  descIdealPx: 920
};

/** Character limits, used only when the width wasn't measured. */
const CHARS = { title: { short: 30, long: 60 }, description: { short: 70, long: 160 } };

/**
 * Is a title or description too short or too long? The one rule the card, Fix this first, the
 * score and the report share: the pixel width decides when it was measured, the characters only
 * stand in when it wasn't.
 * @param {"title"|"description"} field
 * @param {number} chars
 * @param {number} [px] - measured width, 0 when unknown
 * @returns {"missing"|"short"|"long"|"ok"}
 */
export function snippetLength(field, chars, px = 0) {
  if (!chars) return "missing";
  const max = field === "title" ? SNIPPET.titleMaxPx : SNIPPET.descMaxPx;
  const ideal = field === "title" ? SNIPPET.titleIdealPx : SNIPPET.descIdealPx;
  if (px) return px > max ? "long" : px < ideal * 0.5 ? "short" : "ok";
  const c = CHARS[field];
  return chars > c.long ? "long" : chars < c.short ? "short" : "ok";
}

let graphemes = null;
/**
 * Characters as a reader counts them: an emoji, a flag or an accent typed as a separate mark is one.
 * @param {string} text
 * @returns {number}
 */
export function charCount(text) {
  const t = String(text || "");
  // eslint-disable-next-line no-control-regex -- ASCII and Latin letters only: measured without a segmenter
  if (!t || typeof Intl.Segmenter !== "function" || /^[\x00-\x7F\u00A0-\u02FF]*$/.test(t)) return t.length;
  graphemes ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let n = 0;
  for (const _ of graphemes.segment(t)) n++;
  return n;
}
