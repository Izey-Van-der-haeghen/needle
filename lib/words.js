// Counting words in any language. Japanese, Chinese, Thai, Lao, Khmer and Myanmar text has no
// spaces between words, so splitting on spaces would count a whole paragraph as one word.
// content.js has a copy of countWords (it is injected without imports): keep the two the same.

const NO_SPACES = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}]/u;
let segmenter = null;

/**
 * @param {string} text
 * @returns {number}
 */
export function countWords(text) {
  if (!text || !text.trim()) return 0;
  if (!NO_SPACES.test(text) || typeof Intl.Segmenter !== "function") return text.trim().split(/\s+/).length;
  segmenter ??= new Intl.Segmenter(undefined, { granularity: "word" });
  let n = 0;
  for (const s of segmenter.segment(text)) if (s.isWordLike) n++;
  return n;
}
