/**
 * Internationalised domain names as people read them, for display only: "xn--bcher-kva.example"
 * is shown as "bücher.example". Links, copies and comparisons keep the address as it is.
 *
 * A label stays in its xn-- form when its letters could make the address read as another one:
 *  - it mixes scripts. Only the scripts Unicode counts as one writing system go together (UTS 39,
 *    "single script"): Japanese (Han, Hiragana, Katakana), Chinese (Han, Bopomofo) and Korean
 *    (Han, Hangul). Latin with any other script stays xn--: "comノlogin" would read as "com/login";
 *  - it holds a script that is not in SCRIPTS;
 *  - it holds a character other than a letter, a mark, a digit or a hyphen, or starts with a mark;
 *  - it holds a blank-looking letter (a Hangul filler) or a character that can't be seen
 *    (Default_Ignorable_Code_Point);
 *  - it is made only of Cyrillic letters that look like Latin ones, so it reads as a Latin word
 *    (xn--80ak6aa92e reads as "apple"), unless the top-level domain is Cyrillic too (.рф, .бел);
 *  - it isn't in the form a domain name has after IDNA mapping (NFKC: no full-width letters),
 *    it decodes to plain ASCII, it isn't valid punycode, or it is longer than a DNS label can be.
 */

// RFC 3492, section 5: the parameters of punycode for IDNA.
const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 0x80;
const MAX_INT = 0x7fffffff;

/** RFC 3492, section 6.1: the bias for the next number. */
function adapt(delta, numPoints, firstTime) {
  let d = firstTime ? Math.floor(delta / DAMP) : Math.floor(delta / 2);
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - TMIN) * TMAX) / 2) {
    d = Math.floor(d / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
}

/** The value of a punycode digit: a-z are 0-25, 0-9 are 26-35. BASE for anything else. */
function digitValue(code) {
  if (code >= 0x61 && code <= 0x7a) return code - 0x61;
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 26;
  return BASE;
}

/**
 * RFC 3492, section 6.2: decode punycode (the part after "xn--", in lower case).
 * @param {string} input
 * @returns {string|null} null when it isn't valid punycode
 */
export function decodePunycode(input) {
  const out = [];
  const delimiter = input.lastIndexOf("-");
  for (let j = 0; j < Math.max(delimiter, 0); j++) {
    const code = input.charCodeAt(j);
    if (code >= 0x80) return null;
    out.push(code);
  }
  let n = INITIAL_N;
  let i = 0;
  let bias = INITIAL_BIAS;
  for (let pos = delimiter + 1; pos < input.length;) {
    const oldI = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (pos >= input.length) return null;
      const digit = digitValue(input.charCodeAt(pos++));
      if (digit >= BASE || digit > Math.floor((MAX_INT - i) / w)) return null;
      i += digit * w;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;
      // RFC 3492 also checks w for overflow. That can't happen here. With i in 31 bits the bias is at
      // most 198, so t is under 18 for at most the first five digits, where w stays under 35^5. From
      // then on t is 18 or more, and any w that BASE - t could push past MAX_INT fails the check on i.
      w *= BASE - t;
    }
    const length = out.length + 1;
    bias = adapt(i - oldI, length, oldI === 0);
    n += Math.floor(i / length);
    i %= length;
    // Past U+10FFFF, or half of a surrogate pair. This also covers RFC 3492's overflow test for n.
    if (n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return null;
    out.splice(i, 0, n);
    i++;
  }
  return String.fromCodePoint(...out);
}

// The scripts a readable label may be written in. A label in any other script stays as xn--.
const SCRIPTS = ["Latin", "Greek", "Cyrillic", "Armenian", "Georgian", "Hebrew", "Arabic", "Syriac", "Thaana", "Nko",
  "Devanagari", "Bengali", "Gurmukhi", "Gujarati", "Oriya", "Tamil", "Telugu", "Kannada", "Malayalam", "Sinhala",
  "Thai", "Lao", "Tibetan", "Myanmar", "Khmer", "Mongolian", "Ethiopic", "Cherokee", "Canadian_Aboriginal", "Tifinagh",
  "Yi", "Han", "Hiragana", "Katakana", "Bopomofo", "Hangul"]
  .map((name) => [name, new RegExp(`\\p{Script_Extensions=${name}}`, "u")]);

// UTS 39: the writing systems that use more than one script (its augmented script sets). Han is in all three.
const WRITING_SYSTEMS = { Han: ["Japanese", "Chinese", "Korean"], Hiragana: ["Japanese"], Katakana: ["Japanese"], Bopomofo: ["Chinese"], Hangul: ["Korean"] };

const SHARED = /[\p{Script_Extensions=Common}\p{Script_Extensions=Inherited}]/u;

/**
 * A character's scripts, with the writing systems they belong to. null: used by every script (digits,
 * the hyphen, most marks). Empty: a script not in SCRIPTS, so its label is never one writing system.
 */
function scriptsOf(ch) {
  if (SHARED.test(ch)) return null;
  const set = new Set();
  for (const [name, re] of SCRIPTS) {
    if (!re.test(ch)) continue;
    set.add(name);
    for (const system of WRITING_SYSTEMS[name] || []) set.add(system);
  }
  return set;
}

const intersect = (sets) => sets.reduce((a, b) => new Set([...a].filter((x) => b.has(x))));

/** Is the label in one script, or in one writing system (UTS 39, single script)? */
function oneWritingSystem(text) {
  const sets = [];
  for (const ch of text) {
    const set = scriptsOf(ch);
    if (set !== null) sets.push(set);
  }
  return !sets.length || intersect(sets).size > 0;
}

const LETTERS_MARKS_DIGITS = /^[\p{L}\p{M}\p{Nd}-]+$/u;
// Characters that can't be seen, and the Hangul fillers, which are letters that look blank.
const BLANK = /[\p{Default_Ignorable_Code_Point}\u115F\u1160\u3164\uFFA0]/u;
// Cyrillic letters that look like Latin ones, as Chromium lists them (idn_spoof_checker.cc).
const CYRILLIC_LATIN_ALIKE = /^[\u0430\u0441\u0501\u0435\u04BB\u0456\u0458\u04CF\u043E\u0440\u051B\u0455\u051D\u0445\u0443\u044A\u042C\u04BD\u043F\u0433\u0475\u0461\p{Nd}-]+$/u;

/** Can a decoded label be shown as it is? */
function readable(text, cyrillicTld) {
  // eslint-disable-next-line no-control-regex -- a label that is all ASCII after decoding isn't a valid IDN
  return !/^[\x00-\x7F]*$/.test(text)
    && text === text.normalize("NFKC")
    && LETTERS_MARKS_DIGITS.test(text)
    && !/^\p{M}/u.test(text)
    && !BLANK.test(text)
    && oneWritingSystem(text)
    && (cyrillicTld || !CYRILLIC_LATIN_ALIKE.test(text));
}

/** The text of an xn-- label, or null when it isn't valid punycode. */
const decodeLabel = (label) => decodePunycode(label.slice(4).toLowerCase());

/**
 * One label as people read it: decoded when it is "xn--" punycode that is safe to show.
 * @param {string} label
 * @param {boolean} [cyrillicTld=false] - the host's top-level domain is in Cyrillic (.рф, .бел)
 * @returns {string}
 */
export function readableLabel(label, cyrillicTld = false) {
  // 63 characters is the longest a DNS label can be.
  if (label.length > 63 || !/^xn--/i.test(label)) return label;
  const text = decodeLabel(label);
  return text !== null && readable(text, cyrillicTld) ? text : label;
}

/**
 * A host as people read it: each punycode label that is safe to show is decoded.
 * @param {string} host - e.g. "xn--bcher-kva.example", with or without a port
 * @returns {string}
 */
export function readableHost(host) {
  const h = String(host ?? "");
  if (!/xn--/i.test(h)) return h;
  const tld = h.replace(/:\d*$/, "").replace(/\.$/, "").split(".").pop();
  const cyrillicTld = /^xn--/i.test(tld) && /^\p{Script=Cyrillic}+$/u.test(decodeLabel(tld) ?? "");
  return h.replace(/(^|\.)(xn--[a-z0-9-]+)(?=[.:]|$)/gi, (all, dot, label) => dot + readableLabel(label, cyrillicTld));
}
