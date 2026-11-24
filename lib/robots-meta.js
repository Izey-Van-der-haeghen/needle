// The rules in a meta robots or X-Robots-Tag value, each with the crawler it is for: the one parser
// the indexing verdict, the snippet controls, Copilot and the Discover preview setting share.

/**
 * The rules in a meta robots or X-Robots-Tag value, each with the crawler it is for.
 * "googlebot: noindex, nofollow" scopes both rules to googlebot; rules without a name are for all
 * crawlers. A date's comma stays inside unavailable_after (RFC 822 and RFC 850 dates have one).
 * Fetch joins repeated headers with ", ", so "otherbot: noindex" followed by a second header
 * "noindex" reads as two otherbot rules: the parts can't be told apart any more.
 * @param {string} value
 * @returns {{scope: string|null, rule: string}[]} rule in lower case, a value rule as "name:value"
 */
export function robotsRules(value) {
  const VALUE_RULES = /^(max-snippet|max-image-preview|max-video-preview|unavailable_after)$/i;
  const parts = [];
  for (const part of String(value || "").split(",")) {
    if (parts.length && /^\s*\d/.test(part) && /unavailable_after\s*:\s*[a-z]+$/i.test(parts[parts.length - 1].trim())) parts[parts.length - 1] += `,${part}`;
    else parts.push(part);
  }
  let scope = null; // null = all crawlers
  const rules = [];
  for (const part of parts) {
    let token = part.trim();
    if (!token) continue;
    const m = token.match(/^([a-z0-9_-]+)\s*:\s*(.*)$/i);
    if (m && !VALUE_RULES.test(m[1])) {
      scope = m[1].toLowerCase();
      token = m[2].trim();
      if (!token) continue;
    }
    const v = token.match(/^([a-z_-]+)\s*:\s*(.*)$/i);
    rules.push({ scope, rule: v ? `${v[1].toLowerCase()}:${v[2].trim()}` : token.toLowerCase() });
  }
  return rules;
}

/** Google reads rules for all crawlers and for googlebot (googlebot-news has its own). */
export const forGoogle = (r) => r.scope === null || r.scope === "googlebot";
