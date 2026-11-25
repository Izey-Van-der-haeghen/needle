/**
 * robots.txt parsing and matching, following RFC 9309 and Google's documented
 * behaviour:
 *  - groups for the same user agent are merged;
 *  - the most specific matching group applies, `*` only when no named group matches;
 *  - the longest matching rule wins, and Allow wins a tie;
 *  - `*` matches any sequence and a trailing `$` anchors the end; every other
 *    character, `?` included, is literal;
 *  - for Googlebot only, "Allow: /dir/index.html" also allows "/dir/" (see indexAsDirectory).
 * Lines are read as Google's open-source parser (github.com/google/robotstxt, the one
 * Googlebot uses) reads them; see robotsLines.
 *
 * Matching is linear (no RegExp), so a hostile rule cannot freeze the extension.
 */

/** Google reads at most 500 KiB of a robots.txt file. */
export const ROBOTS_MAX_BYTES = 500 * 1024;

/** The start of a text that fits in maxBytes of UTF-8. A character cut in half becomes U+FFFD. */
function firstBytes(text, maxBytes) {
  // A UTF-16 code unit takes at most 3 bytes in UTF-8, so short texts need no encoding.
  if (text.length * 3 <= maxBytes) return text;
  const bytes = new TextEncoder().encode(text);
  return bytes.length <= maxBytes ? text : new TextDecoder().decode(bytes.subarray(0, maxBytes));
}

/** The field a key names. Like Google's parser: keys match by prefix, and frequent typos count. */
function fieldOf(key) {
  const k = key.toLowerCase();
  if (/^(user-agent|useragent|user agent)/.test(k)) return "user-agent";
  if (k.startsWith("allow")) return "allow";
  if (/^(disallow|dissallow|dissalow|disalow|diasllow|disallaw)/.test(k)) return "disallow";
  if (/^(sitemap|site-map)/.test(k)) return "sitemap";
  return k;
}

/**
 * The lines of a robots.txt file as fields and values, read as Googlebot reads them:
 *  - only the first 500 KiB count, in bytes (UTF-8), not characters;
 *  - "#" starts a comment, and space around the field and value is ignored;
 *  - the field ends at the first colon. Without a colon, a space separates field and value,
 *    but only on a line of exactly two words ("Disallow /private");
 *  - "Dissallow", "useragent" and the like count, as in Google's parser.
 * @param {string} robotsText
 * @returns {Array<{key: string, val: string}>} key: "user-agent", "allow", "disallow", "sitemap" or the field as written, in lower case
 */
function robotsLines(robotsText) {
  const out = [];
  const text = firstBytes(String(robotsText || ""), ROBOTS_MAX_BYTES).replace(/^\uFEFF/, "");
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    let key;
    let val;
    const colon = line.indexOf(":");
    if (colon >= 0) {
      key = line.slice(0, colon).trim();
      val = line.slice(colon + 1).trim();
    } else {
      const words = line.split(/[ \t]+/);
      if (words.length !== 2) continue;
      [key, val] = words;
    }
    if (key) out.push({ key: fieldOf(key), val });
  }
  return out;
}

/**
 * The product token of a User-agent value: "Googlebot/2.1" and "googlebot*" are both
 * "googlebot" (Google's spec: "All non-matching text is ignored"). Only letters, "_" and "-"
 * count. "*" on its own is every crawler.
 * @param {string} value
 * @returns {string} lower case
 */
export function agentToken(value) {
  const v = String(value || "").trim().toLowerCase();
  if (/^\*(\s|$)/.test(v)) return "*";
  return (v.match(/^[a-z_-]+/) || [""])[0];
}

/**
 * Split a robots.txt file into groups of user agents and rules.
 * @param {string} robotsText
 * @returns {Array<{uas: string[], allow: string[], disallow: string[]}>}
 */
export function parseRobots(robotsText) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const { key, val } of robotsLines(robotsText)) {
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { uas: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.uas.push(agentToken(val));
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      if (!current) continue; // rules before any user-agent line are ignored
      if (val) current[key].push(val);
    }
    // Other lines (Sitemap, Crawl-delay, unknown fields) are ignored and don't end the list of
    // user agents: only a rule does (Google's spec; RFC 9309 section 2.2.4).
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
function normalizeRobotsPath(p) {
  return String(p || "")
    // eslint-disable-next-line no-control-regex -- every non-ASCII character, as Google's parser percent-encodes them
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
function matchRobotsPattern(pattern, path) {
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
 * Google's parser reads "Allow: /dir/index.html" (or index.htm) as "Allow: /dir/$" too, when the
 * rule itself doesn't match (robots.cc, HandleAllow). The priority is the length of "/dir/$".
 * @param {string} pattern - a normalized Allow pattern
 * @returns {string|null} the directory pattern, or null
 */
function indexAsDirectory(pattern) {
  const slash = pattern.lastIndexOf("/");
  return slash >= 0 && pattern.startsWith("/index.htm", slash) ? `${pattern.slice(0, slash + 1)}$` : null;
}

/**
 * Decide if a path is allowed for a user agent.
 * @param {string} robotsText - full /robots.txt content
 * @param {string} path - URL path, with the query string if any
 * @param {string} [ua="*"] - user-agent product token, e.g. "Googlebot"
 * @param {string} [fallbackUa] - the bot whose group applies when none names ua ("googlebot" for Applebot)
 * @returns {{allowed: boolean, rule: string|null}}
 */
export function isAllowedByRobots(robotsText, path, ua = "*", fallbackUa = null) {
  const groups = parseRobots(robotsText);
  const token = agentToken(ua || "*") || "*";
  // The index.html rule is for Googlebot only. Google's own test calls it Google-specific
  // (GoogleOnly_IndexHTMLisDirectory), RFC 9309 doesn't have it, and no other crawler documents
  // it. A bot that follows Googlebot's rules (Applebot) gets it too.
  const asGooglebot = token === "googlebot" || agentToken(fallbackUa) === "googlebot";
  let applicable = groups.filter(g => g.uas.includes(token));
  // A crawler that documents a fallback (Applebot follows Googlebot's group when it isn't named itself).
  if (!applicable.length && fallbackUa) applicable = groups.filter(g => g.uas.includes(agentToken(fallbackUa)));
  if (!applicable.length) applicable = groups.filter(g => g.uas.includes("*"));
  if (!applicable.length) return { allowed: true, rule: null };

  const target = normalizeRobotsPath(path);
  let best = null;
  for (const g of applicable) {
    for (const type of ["allow", "disallow"]) {
      for (const p of g[type]) {
        const norm = normalizeRobotsPath(p);
        let size = matchRobotsPattern(norm, target) ? norm.length : -1;
        if (size < 0 && type === "allow" && asGooglebot) {
          const dir = indexAsDirectory(norm);
          if (dir && matchRobotsPattern(dir, target)) size = dir.length;
        }
        if (size < 0) continue;
        // The most specific rule wins: the one with the most octets.
        if (!best || size > best.size ||
            (size === best.size && type === "allow" && best.type === "disallow")) {
          best = { type, pattern: p, size };
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
  // Read like every other line, so "sitemap : https://…" and "SITEMAP:https://…" count.
  return robotsLines(robotsText).filter((l) => l.key === "sitemap" && l.val).map((l) => l.val.split(/\s/)[0]);
}
