/**
 * robots.txt parsing and matching, following RFC 9309 and Google's documented
 * behaviour:
 *  - groups for the same user agent are merged;
 *  - the most specific matching group applies, `*` only when no named group matches;
 *  - the longest matching rule wins, and Allow wins a tie;
 *  - `*` matches any sequence and a trailing `$` anchors the end; every other
 *    character, `?` included, is literal;
 *  - "Allow: /dir/index.html" also allows "/dir/", for every bot (see indexAsDirectory).
 * Lines are read as Google's open-source parser (github.com/google/robotstxt, the one
 * Googlebot uses) reads them; see robotsLines.
 *
 * Matching uses no RegExp, and each rule is linear in the path. A file of tens of thousands of
 * wildcard rules with a very long URL still adds up, so the work has a time limit: see
 * ROBOTS_MATCH_MS.
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
 * The most time matching may take for one robots.txt and one path, for every bot together, in
 * milliseconds. Each rule is linear in the path, but rules × path length × bots is not: tens of
 * thousands of "Disallow: /*ab" against a URL of 100,000 characters (both chosen by the site) took
 * minutes. Now each pattern and search is done once for all bots, and a real file takes a few
 * milliseconds, so only a file that froze the popup for many seconds before can reach the limit.
 * Then a bot whose verdict isn't certain yet gets none: {allowed: null, unchecked: true}, never a
 * guess. Every verdict given is the one without the limit. Time, not a count of characters: a
 * search for a long part can be 40 times faster than one for a short part, so a count would cut
 * off fast files too.
 */
export const ROBOTS_MATCH_MS = 1000;

/** The time each bot's verdict gets even when the bots before it used up ROBOTS_MATCH_MS. */
export const ROBOTS_BOT_MS = 10;

/**
 * The matching work for the last robots.txt and path, shared by every bot: the rules (normalized
 * once), each pattern's answer, each search's result and the time spent. AI access asks for 18
 * bots and Googlebot for one more, with the same file and path.
 */
let work = null;

function workFor(robotsText, path) {
  const text = String(robotsText || "");
  if (work?.text !== text) {
    const groups = parseRobots(text).map((g, i) => ({
      i,
      uas: g.uas,
      // In the order the verdict reads them: a group's Allow rules, then its Disallow rules.
      rules: ["allow", "disallow"].flatMap((type) => g[type].map((pattern) => {
        const norm = normalizeRobotsPath(pattern);
        return { type, pattern, norm, dir: type === "allow" ? indexAsDirectory(norm) : null };
      }))
    }));
    work = { text, groups, orders: new Map(), path: null };
  }
  if (work.path !== path) {
    const target = normalizeRobotsPath(path);
    // The ASCII characters in the path: a part with another one can't be found, without a search.
    const chars = new Uint8Array(128);
    for (let i = 0; i < target.length; i++) { const c = target.charCodeAt(i); if (c < 128) chars[c] = 1; }
    Object.assign(work, { path, target, chars, spent: 0, deadline: Infinity, answers: new Map(), searches: new Map() });
  }
  return work;
}

/** path.indexOf(part, pos), remembered. null when the time for this file and path is up. */
function search(w, part, pos) {
  if (!part) return pos;
  const key = `${pos}:${part}`;
  const known = w.searches.get(key);
  if (known !== undefined) return known;
  for (let i = 0; i < part.length; i++) {
    const c = part.charCodeAt(i);
    if (c < 128 && !w.chars[c]) { w.searches.set(key, -1); return -1; }
  }
  if (performance.now() > w.deadline) return null;
  const idx = w.target.indexOf(part, pos);
  w.searches.set(key, idx);
  return idx;
}

/**
 * Does a robots.txt path pattern match the path (path + query)? null when the budget ran out first.
 * @param {string} pattern - normalized
 * @param {{target: string}} w - the path, normalized, and the search budget
 * @returns {boolean|null}
 */
function matchRobotsPattern(pattern, w) {
  const path = w.target;
  if (!pattern) return false;
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const parts = body.split("*");
  const first = parts[0];
  if (!path.startsWith(first)) return false;
  let pos = first.length;
  if (parts.length === 1) return anchored ? pos === path.length : true;
  const last = parts[parts.length - 1];
  // A "$" pattern must end the path whatever the parts before it find, so that is checked first.
  if (anchored && !path.endsWith(last)) return false;
  for (let i = 1; i < parts.length - 1; i++) {
    const idx = search(w, parts[i], pos);
    if (idx === null) return null;
    if (idx < 0) return false;
    pos = idx + parts[i].length;
  }
  if (anchored) return path.length - last.length >= pos;
  const idx = search(w, last, pos);
  return idx === null ? null : idx >= 0;
}

/** matchRobotsPattern, remembered for this file and path. A null (out of time) isn't: the next bot tries again. */
function matches(w, pattern) {
  let answer = w.answers.get(pattern);
  if (answer === undefined) {
    answer = matchRobotsPattern(pattern, w);
    if (answer !== null) w.answers.set(pattern, answer);
  }
  return answer;
}

/**
 * Google's parser reads "Allow: /dir/index.html" (or index.htm) as "Allow: /dir/$" too, when the
 * rule itself doesn't match (robots.cc, HandleAllow). The priority is the length of "/dir/$".
 * Needle applies this rule to every bot, not only to Google's crawlers: Izey's decision of
 * 25 November 2026. Google's own test calls the rule Google-specific
 * (GoogleOnly_IndexHTMLisDirectory), and RFC 9309 doesn't have it.
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
 * @returns {{allowed: boolean|null, rule: string|null, unchecked?: true}}
 *   allowed is null and unchecked true when the time for matching ran out (see ROBOTS_MATCH_MS)
 *   before a rule that could decide was checked: no verdict.
 */
export function isAllowedByRobots(robotsText, path, ua = "*", fallbackUa = null) {
  const w = workFor(robotsText, String(path || ""));
  const groups = w.groups;
  const token = agentToken(ua || "*") || "*";
  let applicable = groups.filter(g => g.uas.includes(token));
  // A crawler that documents a fallback (Applebot follows Googlebot's group when it isn't named itself).
  if (!applicable.length && fallbackUa) applicable = groups.filter(g => g.uas.includes(agentToken(fallbackUa)));
  if (!applicable.length) applicable = groups.filter(g => g.uas.includes("*"));
  if (!applicable.length) return { allowed: true, rule: null };

  // The most specific rule wins: the one with the most octets; Allow wins a tie, then the first
  // one read. So the rules are tried strongest first and the first match is the verdict.
  const key = applicable.map((g) => g.i).join(",");
  let order = w.orders.get(key);
  if (!order) {
    order = applicable.flatMap((g) => g.rules.flatMap((r) => [{ r, pattern: r.norm }, ...(r.dir ? [{ r, pattern: r.dir, dir: true }] : [])]));
    // Array sort is stable, so equal rules keep the order they are read in.
    order.sort((a, b) => b.pattern.length - a.pattern.length || (a.r.type === b.r.type ? 0 : a.r.type === "allow" ? -1 : 1));
    w.orders.set(key, order);
  }
  // The time left for this file and path, but at least ROBOTS_BOT_MS: Googlebot, asked first, can't
  // use up the time of every AI bot after it.
  const start = performance.now();
  w.deadline = start + Math.max(ROBOTS_MATCH_MS - w.spent, ROBOTS_BOT_MS);
  try {
    return firstMatch(w, order);
  } finally {
    w.spent += performance.now() - start;
  }
}

/** The verdict of the first rule in `order` that matches; none when the time ran out on one before it. */
function firstMatch(w, order) {
  for (const { r, pattern, dir } of order) {
    // "Allow: /dir/index.html" counts as "/dir/$" only when it doesn't match itself.
    let found = dir ? matches(w, r.norm) : false;
    if (found === false) found = matches(w, pattern);
    else if (found) continue;
    // A stronger rule that may match decides over any weaker one: without its answer, no verdict.
    if (found === null) return { allowed: null, rule: null, unchecked: true };
    if (!found) continue;
    return { allowed: r.type === "allow", rule: `${r.type === "allow" ? "Allow" : "Disallow"}: ${r.pattern}` };
  }
  return { allowed: true, rule: null };
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
