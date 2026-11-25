// Reads a stylesheet (popup.css, base.css) into its style rules, for tests that check a rule is there.
// jsdom has no layout: what a rule does on screen is checked by the browser pass in dev/check/fullcheck.mjs.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The project root, two folders up from tests/helpers. A path, not a URL object: in a jsdom test the global URL is jsdom's.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Splits text at each separator outside brackets, so ":is(.a, .b)" and "calc(…)" stay whole. */
function splitTop(text, sep) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if (text[i] === sep && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim().replace(/\s+/g, " ")).filter(Boolean);
}

/**
 * @param {string} file - a stylesheet in the project root, such as "popup.css"
 * @returns {{media: string|null, selectors: string[], decls: Object<string, string>}[]} every style rule in order.
 *   media is the @media condition, such as "(max-width: 300px)", or null outside one. Comments are left out,
 *   so a rule that is only described or commented out doesn't count.
 */
export function readRules(file) {
  const css = readFileSync(path.join(ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/@import[^;]*;/g, "");
  const rules = [];
  const walk = (text, media) => {
    let i = 0;
    for (;;) {
      const open = text.indexOf("{", i);
      if (open < 0) return;
      let depth = 1, end = open + 1;
      for (; depth > 0; end++) {
        if (end >= text.length) throw new Error(`${file}: a "{" is never closed`);
        if (text[end] === "{") depth++;
        else if (text[end] === "}") depth--;
      }
      const prelude = text.slice(i, open).trim().replace(/\s+/g, " ");
      const body = text.slice(open + 1, end - 1);
      if (prelude.startsWith("@media")) walk(body, prelude.slice(6).trim());
      else if (!prelude.startsWith("@")) {
        const decls = Object.fromEntries(splitTop(body, ";").map((d) => {
          const colon = d.indexOf(":");
          return [d.slice(0, colon).trim().toLowerCase(), d.slice(colon + 1).trim()];
        }));
        rules.push({ media, selectors: splitTop(prelude, ","), decls });
      }
      i = end;
    }
  };
  walk(css, null);
  return rules;
}

/** The value that the last rule with exactly this selector (in this media query, or outside any) gives prop. */
export function declared(rules, selector, prop, media = null) {
  let value;
  for (const r of rules) if (r.media === media && r.selectors.includes(selector) && prop in r.decls) value = r.decls[prop];
  return value;
}
