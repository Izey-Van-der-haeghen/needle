// Full check of 25 November 2026, P2-2: displayUrl never shows a hidden character.
import { describe, it, expect } from "vitest";
import { displayUrl } from "../lib/popup-helpers.js";

// The characters Chromium keeps escaped in its address bar (net/base/escape.cc): controls,
// format characters, line and paragraph separators, default-ignorable code points, blank spaces,
// the Braille blank and the lock emoji. Written here on its own, not taken from the code.
const MUST_STAY_ESCAPED = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\u2800\u{1F50F}\u{1F510}\u{1F512}\u{1F513}]/u;

function hiddenCodePoints() {
  const out = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue; // surrogates are not characters
    if (MUST_STAY_ESCAPED.test(String.fromCodePoint(cp))) out.push(cp);
  }
  return out;
}

describe("displayUrl and hidden characters", () => {
  const hidden = hiddenCodePoints();

  it("covers every hidden code point", () => {
    expect(hidden.length).toBeGreaterThan(4000);
  });

  it("never shows a hidden character, whether the address has it escaped or not", () => {
    const leaks = [];
    for (const cp of hidden) {
      const ch = String.fromCodePoint(cp);
      const escaped = `https://e.be/r%C3%A9gion/a${encodeURIComponent(ch)}b`;
      const want = `https://e.be/région/a${encodeURIComponent(ch)}b`;
      for (const input of [escaped, `https://e.be/r%C3%A9gion/a${ch}b`]) {
        const out = displayUrl(input);
        if (out !== want || MUST_STAY_ESCAPED.test(out)) leaks.push(cp.toString(16));
      }
    }
    expect(leaks).toEqual([]);
  });

  it("keeps the ones the full check found escaped", () => {
    for (const esc of ["%EF%BE%A0", "%E3%85%A4", "%E2%80%A8", "%C2%A0", "%E2%A0%80", "%E3%80%80", "%F0%9F%94%92", "%E2%80%AE"]) {
      expect(displayUrl(`https://e.be/a${esc}b`)).toBe(`https://e.be/a${esc}b`);
    }
    expect(displayUrl("https://e.be/a\u202Egpj.exe")).toBe("https://e.be/a%E2%80%AEgpj.exe");
  });

  it("still decodes letters and other emoji, and keeps escapes that mean something", () => {
    expect(displayUrl("https://e.jp/%E3%83%90%E3%82%A4%E3%82%AF")).toBe("https://e.jp/バイク");
    expect(displayUrl("https://e.be/%F0%9F%9A%B2")).toBe("https://e.be/\u{1F6B2}");
    expect(displayUrl("https://e.be/a%2Fb?q=%26")).toBe("https://e.be/a%2Fb?q=%26");
  });
});
