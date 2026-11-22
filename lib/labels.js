// Labels and colours the popup and the downloaded report share, so the two never drift apart.
// Each helper returns [label, kind]; the caller wraps it in its own tag().

/** Fix this first: severity → tag kind. */
export const SEV_KIND = { critical: "bad", high: "bad", medium: "warn", low: "neutral" };

/** What each AI crawler is for. */
export const BOT_KIND_LABEL = { search: "AI search", user: "user fetch", training: "training", control: "Gemini use (token)" };

/** A crawler's row: blocked search bots are a problem, a blocked training bot is a plain fact. */
export function botStatus(bot, robotsKnown) {
  if (!robotsKnown) return ["unknown", "neutral"];
  if (bot.allowed) return ["allowed", "good"];
  return ["blocked", bot.kind === "search" ? "bad" : "info"];
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

/** A validation issue's level → tag kind (structured data, hreflang). */
export const LEVEL_KIND = { error: "bad", warn: "warn", note: "info", info: "neutral" };

/** The line above a noindex page's shorter Fix this first, in the popup, the report and the copy. */
export function leftOutNote(n) {
  return n === 1
    ? "1 finding that only matters in search results is left out while the page is noindex."
    : `${n.toLocaleString("en")} findings that only matter in search results are left out while the page is noindex.`;
}
