// Full check of 25 November 2026, P3-18: punycode hosts as people read them (lib/idn.js).
import { describe, it, expect } from "vitest";
import { domainToASCII, domainToUnicode } from "node:url";
import { decodePunycode, readableLabel, readableHost } from "../lib/idn.js";

// RFC 3492, section 6.3: punycode for basic letters with one other code point at `pos`.
// Node's encoder refuses code points that don't exist, so the tests that need them use this.
const digit = (d) => String.fromCharCode(d < 26 ? 0x61 + d : 0x30 + d - 26);
function encodeNumber(q, bias) {
  let out = "";
  for (let k = 36; ; k += 36) {
    const t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
    if (q < t) break;
    out += digit(t + (q - t) % (36 - t));
    q = Math.floor((q - t) / (36 - t));
  }
  return out + digit(q);
}
const encodeOne = (basic, cp, pos) => (basic ? `${basic}-` : "") + encodeNumber((cp - 0x80) * (basic.length + 1) + pos, 72);

describe("decodePunycode", () => {
  it("decodes what Node's IDNA encoder makes", () => {
    const words = ["bücher", "münchen", "\u043F\u0440\u0438\u043C\u0435\u0440", "日本語",
      "한국", "مثال", "ελληνικά", "ไทย",
      "fietsenhérstel-brüssel", "\u0938\u0902\u0917\u0920\u0928", "\u{1F6B2}fiets"];
    for (const word of words) {
      const ascii = domainToASCII(word);
      expect(ascii.startsWith("xn--")).toBe(true);
      expect(decodePunycode(ascii.slice(4))).toBe(domainToUnicode(ascii));
    }
  });

  it("decodes every letter of the Basic Multilingual Plane as Node does", () => {
    const wrong = [];
    for (let cp = 0xa0; cp <= 0xffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ascii = domainToASCII(`ab${String.fromCodePoint(cp)}`);
      if (!ascii.startsWith("xn--")) continue;
      if (decodePunycode(ascii.slice(4)) !== domainToUnicode(ascii)) wrong.push(cp.toString(16));
    }
    expect(wrong).toEqual([]);
  });

  it("refuses what isn't punycode", () => {
    expect(decodePunycode("zz")).toBeNull(); // ends in the middle of a number
    expect(decodePunycode("bcher-kv!")).toBeNull(); // not a punycode digit
    expect(decodePunycode("bücher-kva")).toBeNull(); // a basic part that isn't ASCII
    expect(decodePunycode("99999999999")).toBeNull(); // beyond the last code point
  });

  it("refuses a code point that doesn't exist, or half of a pair", () => {
    expect(encodeOne("bcher", 0xfc, 1)).toBe("bcher-kva"); // the helper encodes as RFC 3492 does
    expect(decodePunycode(encodeOne("", 0x110000, 0))).toBeNull(); // one past U+10FFFF
    expect(decodePunycode(encodeOne("", 0xd800, 0))).toBeNull(); // a lone surrogate
    expect(decodePunycode(encodeOne("", 0xdfff, 0))).toBeNull();
    expect(decodePunycode(encodeOne("", 0x10fffd, 0))).toBe("\u{10FFFD}");
  });

  it("refuses a number that doesn't fit in 31 bits, as RFC 3492 asks", () => {
    // After 2,000 basic letters, U+10FFFD at the start is a jump of 2,229 million: more than 2^31 - 1.
    expect(decodePunycode(encodeOne("a".repeat(2000), 0x10fffd, 0))).toBeNull();
    // After 1,000 it fits, and decodes.
    expect(decodePunycode(encodeOne("a".repeat(1000), 0x10fffd, 0))).toBe(`\u{10FFFD}${"a".repeat(1000)}`);
  });
});

describe("readableLabel and readableHost", () => {
  it("decodes a label in one script", () => {
    expect(readableHost("xn--bcher-kva.example")).toBe("bücher.example");
    expect(readableHost("XN--BCHER-KVA.example")).toBe("bücher.example");
    expect(readableHost("xn--fietsenhrstel-brssel-i2b04b.example:8080")).toBe("fietsenhérstel-brüssel.example:8080");
    expect(readableHost("xn--hxargifdar.example")).toBe("ελληνικά.example");
    expect(readableHost("xn--mgbh0fb.xn--kgbechtv")).toBe("مثال.إختبار");
    expect(readableHost("www.xn--e1afmkfd.ru.")).toBe("www.\u043F\u0440\u0438\u043C\u0435\u0440.ru.");
  });

  it("decodes Japanese, Chinese and Korean, which each use more than one script", () => {
    expect(readableLabel("xn--eckwd4c7c5976acvb2w6i")).toBe("日本語ドメイン"); // Han and Katakana
    expect(readableLabel("xn--3e0b707e")).toBe("한국");
    expect(readableLabel("xn--pss817l9sn6jn")).toBe("大韓민국"); // Han and Hangul
    expect(readableLabel("xn--5ek909fo6p")).toBe("中文ㄅ"); // Han and Bopomofo
    expect(readableLabel("xn--wgv71a119e")).toBe("日本語");
  });

  it("keeps a label that mixes scripts", () => {
    for (const label of [
      "xn--pple-43d", // Cyrillic a + "pple"
      "xn--bcher-kva569b", // Latin with a Greek alpha
      "xn--ddk6960c", // Hangul with Katakana: two writing systems
      "xn--comlogin-634g", // "com", Katakana no, "login": google.comノlogin.example reads as google.com/login
      "xn--paypallogin-qm8q", // "paypal", Han one, "login"
      "xn--paypallogin-zu5j", // "paypal", the Japanese long vowel mark, "login"
      "xn--googlecom-0q6n", // "google", a Han stroke that looks like a slash, "com"
      "xn--abc-7k4bocn", // Latin with Katakana
      "xn--abc-lt8lk11n" // Hangul with Latin
    ]) expect(readableLabel(label)).toBe(label);
  });

  it("never shows a label that mixes Latin with Han, Hiragana, Katakana, Bopomofo or Hangul", () => {
    const shown = [];
    const cjk = /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Bopomofo}\p{Script_Extensions=Hangul}]/u;
    for (let cp = 0x1100; cp <= 0xffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ch = String.fromCodePoint(cp);
      if (!cjk.test(ch)) continue;
      const ascii = domainToASCII(`ab${ch}`);
      if (ascii.startsWith("xn--") && readableLabel(ascii) !== ascii) shown.push(cp.toString(16));
    }
    expect(shown).toEqual([]);
  });

  it("keeps a label in a script it doesn't list", () => {
    expect(readableLabel("xn--9d6hc")).toBe("xn--9d6hc"); // Adlam
  });

  it("keeps a label with a blank-looking letter or a character that can't be seen", () => {
    for (const label of [
      "xn--vhk2848ahbza", // U+3164 Hangul filler between two syllables
      "xn--bcher-kva9740a", // U+115F
      "xn--bcher-kva03476b", // U+FFA0
      "xn--bcher-kva972b", // U+034F combining grapheme joiner
      "xn--bcher-kva32646b", // U+FE0F variation selector
      "xn--bcher-0ha66c" // U+00AD soft hyphen
    ]) expect(readableLabel(label)).toBe(label);
    // A filler on its own: U+1160 and U+3164 are letters, but blank.
    expect(decodePunycode("psd")).toBe("\u1160");
    expect(decodePunycode("vhk")).toBe("\u3164");
    for (const label of ["xn--psd", "xn--vhk"]) expect(readableLabel(label)).toBe(label);
  });

  it("keeps a label with a character that is not a letter, mark, digit or hyphen", () => {
    expect(readableLabel("xn--bcher-kva1847d")).toBe("xn--bcher-kva1847d"); // a star
    expect(readableLabel("xn--collegi-xma")).toBe("xn--collegi-xma"); // a middle dot
    expect(readableLabel("xn--bcher-5ed")).toBe("xn--bcher-5ed"); // starts with an accent
  });

  it("keeps a label that isn't in its mapped form, decodes to ASCII or isn't punycode", () => {
    expect(readableLabel("xn--tda1031keaio5d")).toBe("xn--tda1031keaio5d"); // full-width letters
    expect(readableLabel("xn--abc-")).toBe("xn--abc-");
    expect(readableLabel("xn--zz")).toBe("xn--zz");
    expect(readableLabel("xn--")).toBe("xn--");
  });

  it("keeps a label longer than a DNS label can be", () => {
    const longest = domainToASCII(`ü${"a".repeat(55)}`);
    expect(longest).toHaveLength(63);
    expect(readableLabel(longest)).toBe(`ü${"a".repeat(55)}`);
    const tooLong = domainToASCII(`ü${"a".repeat(56)}`);
    expect(tooLong).toHaveLength(64);
    expect(readableLabel(tooLong)).toBe(tooLong);
  });

  it("keeps Cyrillic that reads as a Latin word, unless the top-level domain is Cyrillic too", () => {
    expect(readableHost("xn--80ak6aa92e.com")).toBe("xn--80ak6aa92e.com");
    expect(readableHost("www.xn--80ak6aa92e.com:443")).toBe("www.xn--80ak6aa92e.com:443");
    expect(readableHost("xn--80ak6aa92e.xn--p1ai")).toBe("\u0430\u0440\u0440\u04CF\u0435.\u0440\u0444");
    expect(readableHost("xn--80ak6aa92e.xn--90ais")).toBe("\u0430\u0440\u0440\u04CF\u0435.\u0431\u0435\u043B");
    expect(readableHost("xn--e1afmkfd.com")).toBe("\u043F\u0440\u0438\u043C\u0435\u0440.com");
  });

  it("keeps that Cyrillic as xn-- under a top-level domain in another script", () => {
    expect(readableHost("xn--80ak6aa92e.xn--fiqs8s")).toBe("xn--80ak6aa92e.\u4E2D\u56FD");
    expect(readableHost("xn--80ak6aa92e.xn--mgbaam7a8h")).toBe("xn--80ak6aa92e.\u0627\u0645\u0627\u0631\u0627\u062A");
  });

  it("never shows a label that mixes Latin with Greek, Cyrillic, Armenian or Georgian", () => {
    const shown = [];
    const other = /[\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Armenian}\p{Script=Georgian}]/u;
    for (let cp = 0x370; cp <= 0x2dff; cp++) {
      const ch = String.fromCodePoint(cp);
      if (!other.test(ch)) continue;
      const ascii = domainToASCII(`ab${ch}`);
      if (ascii.startsWith("xn--") && readableLabel(ascii) !== ascii) shown.push(cp.toString(16));
    }
    expect(shown).toEqual([]);
  });

  it("leaves hosts without punycode alone", () => {
    expect(readableHost("www.example.be")).toBe("www.example.be");
    expect(readableHost("[2001:db8::1]:8080")).toBe("[2001:db8::1]:8080");
    expect(readableHost("")).toBe("");
  });
});
