// Labels and colours the popup and the downloaded report share, so the two never drift apart.
// Each helper returns [label, kind]; the caller wraps it in its own tag().
import { keepsOutOfAnswers } from "./geo.js";

/** Fix this first: severity → tag kind. */
export const SEV_KIND = { critical: "bad", high: "bad", medium: "warn", low: "neutral" };

/** What each AI crawler is for. */
export const BOT_KIND_LABEL = { search: "AI search", user: "user fetch", training: "training", control: "Gemini use (token)" };

/** A crawler's row: a block that keeps the site out of answers is a problem, a blocked training bot a plain fact. */
export function botStatus(bot, robotsKnown) {
  if (!robotsKnown) return ["unknown", "neutral"];
  if (bot.allowed) return ["allowed", "good"];
  return ["blocked", keepsOutOfAnswers(bot) ? "bad" : "info"];
}

/** A trust or quotability signal: ok, information only ("not scored"), or missing. */
export function signalStatus(signal, failText) {
  if (signal.ok) return ["ok", "good"];
  if (signal.info) return ["not scored", "info"];
  return [failText, "warn"];
}

/** /llms.txt or /llms-full.txt: information only. */
export function llmsStatus(file) {
  return file?.ok ? ["found", "good"] : ["not found", "info"];
}

/** A Core Web Vitals category from PageSpeed / CrUX. */
export function cwvStatus(category) {
  if (category === "FAST") return ["good", "good"];
  if (category === "AVERAGE") return ["needs work", "warn"];
  if (category === "SLOW") return ["poor", "bad"];
  return ["no data", "neutral"];
}

/** A structured-data issue's level → [word, tag kind]. */
export const SCHEMA_LEVEL = { error: ["required", "bad"], warn: ["warning", "warn"], note: ["note", "info"], info: ["recommended", "neutral"] };

/** An hreflang check's level → [word, tag kind]. Its "info" is a recommendation (no x-default): information, not a Low finding. */
export const HREFLANG_LEVEL = { error: ["error", "bad"], warn: ["warning", "warn"], info: ["note", "info"] };

/**
 * The H1 label of the Headings card and the report: one H1, several, only hidden ones, or none.
 * @param {Array<{level: number, hidden?: boolean}>} headings
 */
export function h1Status(headings) {
  const h1s = (headings || []).filter((h) => h.level === 1);
  const shown = h1s.filter((h) => !h.hidden).length;
  if (shown === 1) return ["one H1", "good"];
  if (shown > 1) return [`${shown} H1s`, "warn"];
  return h1s.length ? ["H1 hidden", "warn"] : ["no H1", "bad"];
}

/** The line above a noindex page's shorter Fix this first, in the popup, the report and the copy. */
export function leftOutNote(n) {
  return n === 1
    ? "1 finding that only matters in search results is left out while the page is noindex."
    : `${n.toLocaleString("en")} findings that only matter in search results are left out while the page is noindex.`;
}
