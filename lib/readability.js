/**
 * Readability of the main content, with the classic formula for the page's language.
 * These scores are rough guides: they count sentence and word length, not meaning.
 *
 *   en  Flesch Reading Ease   206.835 − 1.015·ASL − 84.6·ASW
 *   nl  Flesch–Douma          206.835 − 0.93·ASL − 77·ASW
 *   fr  Kandel & Moles        207 − 1.015·ASL − 73.6·ASW
 *   de  Amstad                180 − ASL − 58.5·ASW
 * (ASL = words per sentence, ASW = syllables per word)
 */

const FORMULAS = {
  en: { name: "Flesch Reading Ease", a: 206.835, b: 1.015, c: 84.6, vowels: "aeiouy" },
  nl: { name: "Flesch–Douma", a: 206.835, b: 0.93, c: 77, vowels: "aeiouyëïéèêáóúàüö" },
  fr: { name: "Kandel & Moles", a: 207, b: 1.015, c: 73.6, vowels: "aeiouyàâäéèêëîïôöùûüÿœæ" },
  de: { name: "Amstad", a: 180, b: 1, c: 58.5, vowels: "aeiouyäöü" }
};

/** Approximate syllables: groups of vowels, with a silent final e in English and French. */
export function syllables(word, lang = "en") {
  const f = FORMULAS[lang] || FORMULAS.en;
  let w = word.toLowerCase();
  if ((lang === "en" || lang === "fr") && w.length > 3) w = w.replace(/(?:e|es|ed)$/, "");
  const groups = w.match(new RegExp(`[${f.vowels}]+`, "g"));
  return Math.max(1, groups ? groups.length : 1);
}

function band(score) {
  if (score >= 80) return "easy";
  if (score >= 60) return "plain";
  if (score >= 50) return "fairly difficult";
  if (score >= 30) return "difficult";
  return "very difficult";
}

/**
 * @param {string} text
 * @param {string} langTag - <html lang>, e.g. "nl-BE"
 * @returns {{supported: false, lang: string} | {supported: true, lang, formula, score, band, sentences, words, avgSentence, longSentences}}
 */
export function readability(text, langTag) {
  const lang = String(langTag || "en").toLowerCase().split(/[-_]/)[0];
  const f = FORMULAS[lang];
  if (!f) return { supported: false, lang };
  const sentences = String(text || "")
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => (s.match(/[\p{L}\p{N}]+/gu) || []).length >= 3);
  const words = sentences.flatMap((s) => s.match(/[\p{L}]+/gu) || []);
  if (sentences.length < 3 || words.length < 50) return { supported: true, lang, formula: f.name, tooShort: true };
  const syl = words.reduce((n, w) => n + syllables(w, lang), 0);
  const asl = words.length / sentences.length;
  const asw = syl / words.length;
  const score = Math.round(Math.max(0, Math.min(100, f.a - f.b * asl - f.c * asw)));
  const longSentences = sentences.filter((s) => (s.match(/[\p{L}\p{N}]+/gu) || []).length > 25).length;
  return {
    supported: true, lang, formula: f.name, score, band: band(score),
    sentences: sentences.length, words: words.length,
    avgSentence: Math.round(asl * 10) / 10, longSentences
  };
}
