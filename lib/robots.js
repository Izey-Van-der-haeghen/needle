/**
 * robots.txt parsing and matching, following RFC 9309 and Google's documented
 * behaviour:
 *  - groups for the same user agent are merged;
 *  - the most specific matching group applies, `*` only when no named group matches;
 *  - the longest matching rule wins, and Allow wins a tie;
 *  - `*` matches any sequence and a trailing `$` anchors the end; every other
 *    character, `?` included, is literal.
 *
 * Matching is linear (no RegExp), so a hostile rule cannot freeze the extension.
 */

/** Google reads at most 500 KiB of a robots.txt file. */
export const ROBOTS_MAX_BYTES = 500 * 1024;

/**
 * Split a robots.txt file into groups of user agents and rules.
 * @param {string} robotsText
 * @returns {Array<{uas: string[], allow: string[], disallow: string[]}>}
 */
export function parseRobots(robotsText) {
  const text = String(robotsText || "").slice(0, ROBOTS_MAX_BYTES).replace(/^﻿/, "");
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const val = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { uas: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.uas.push(val.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      if (!current) continue; // rules before any user-agent line are ignored
      if (val) current[key].push(val);
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

/**
 * RFC 9309 section 2.2.2: compare rules and paths in one form. Characters outside
 * US-ASCII are percent-encoded as UTF-8, escapes get upper-case hex, and escapes
 * of unreserved characters (A-Z a-z 0-9 - . _ ~) are decoded. So "Disallow: /café"
 * matches the path "/caf%C3%A9", and "/%7Euser" matches "/~user".
 * @param {string} p
 * @returns {string}
 */
export function normalizeRobotsPath(p) {
  return String(p || "")
    .replace(/[^\x00-\x7F]+/g, (ch) => { try { return encodeURIComponent(ch); } catch { return ch; } })
    .replace(/%([0-9a-fA-F]{2})/g, (m, hex) => {
      const c = String.fromCharCode(parseInt(hex, 16));
      return /[A-Za-z0-9\-._~]/.test(c) ? c : `%${hex.toUpperCase()}`;
    });
}

/**
 * Does a robots.txt path pattern match a URL path (path + query)?
 * @param {string} pattern
 * @param {string} path
 * @returns {boolean}
 */
export function matchRobotsPattern(pattern, path) {
  if (!pattern) return false;
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const parts = body.split("*");
  const first = parts[0];
  if (!path.startsWith(first)) return false;
  let pos = first.length;
  if (parts.length === 1) return anchored ? pos === path.length : true;
  for (let i = 1; i < parts.length - 1; i++) {
    const idx = path.indexOf(parts[i], pos);
    if (idx < 0) return false;
    pos = idx + parts[i].length;
  }
  const last = parts[parts.length - 1];
  if (anchored) {
    if (path.length - last.length < pos) return false;
    return path.endsWith(last);
  }
  return path.indexOf(last, pos) >= 0;
}

/**
 * Decide if a path is allowed for a user agent.
 * @param {string} robotsText - full /robots.txt content
 * @param {string} path - URL path, with the query string if any
 * @param {string} [ua="*"] - user-agent product token, e.g. "Googlebot"
 * @returns {{allowed: boolean, rule: string|null}}
 */
export function isAllowedByRobots(robotsText, path, ua = "*") {
  const groups = parseRobots(robotsText);
  const token = String(ua || "*").toLowerCase();
  let applicable = groups.filter(g => g.uas.includes(token));
  if (!applicable.length) applicable = groups.filter(g => g.uas.includes("*"));
  if (!applicable.length) return { allowed: true, rule: null };

  const target = normalizeRobotsPath(path);
  let best = null;
  for (const g of applicable) {
    for (const type of ["allow", "disallow"]) {
      for (const p of g[type]) {
        const norm = normalizeRobotsPath(p);
        if (!matchRobotsPattern(norm, target)) continue;
        // The most specific rule wins: the one with the most octets.
        if (!best || norm.length > best.size ||
            (norm.length === best.size && type === "allow" && best.type === "disallow")) {
          best = { type, pattern: p, size: norm.length };
        }
      }
    }
  }
  if (!best) return { allowed: true, rule: null };
  return {
    allowed: best.type === "allow",
    rule: `${best.type === "allow" ? "Allow" : "Disallow"}: ${best.pattern}`
  };
}

/**
 * List the Sitemap: lines of a robots.txt file.
 * @param {string} robotsText
 * @returns {string[]}
 */
export function robotsSitemaps(robotsText) {
  return [...String(robotsText || "").matchAll(/^\s*sitemap:\s*(\S+)/gim)].map(m => m[1]);
}
