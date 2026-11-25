// Full check of 25 November 2026: counts as people read them.
// P3-5 charCount and CR LF, P3-11 charTag's plural, P3-20 fmtKB under 1 KB.
import { describe, it, expect } from "vitest";
import { charCount } from "../lib/snippet.js";
import { charTag, fmtKB, inlineImageLabel } from "../lib/popup-helpers.js";

describe("charCount and CR LF (P3-5)", () => {
  it("counts CR LF as one character, as Intl.Segmenter does", () => {
    expect(charCount("a\r\nb")).toBe(3);
    expect(charCount("Bikes\r\nrepaired")).toBe(14);
    expect(charCount("réparation\r\nrapide")).toBe(17);
  });

  it("still counts a lone CR or LF as one", () => {
    expect(charCount("a\rb")).toBe(3);
    expect(charCount("a\nb")).toBe(3);
  });

  it("agrees with Intl.Segmenter on short ASCII and Latin texts", () => {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const parts = ["a", " ", "\r", "\n", "\r\n", "é", "\t", "Z"];
    const wrong = [];
    for (const x of parts) for (const y of parts) for (const z of parts) {
      const t = x + y + z;
      if (charCount(t) !== [...seg.segment(t)].length) wrong.push(JSON.stringify(t));
    }
    expect(wrong).toEqual([]);
  });
});

describe("charTag says 1 character (P3-11)", () => {
  it("uses the singular for 1", () => {
    expect(charTag(1, 30, 60, 70, true)).toMatch(/>1 character</);
    expect(charTag(1, 30, 60, 70)).toMatch(/>1 character, short</);
  });

  it("keeps the plural, with thousands separators", () => {
    expect(charTag(2, 30, 60, 70, true)).toMatch(/>2 characters</);
    expect(charTag(45, 30, 60, 70)).toMatch(/class="tag good".*>45 characters</);
    expect(charTag(1200, 70, 160, 170)).toMatch(/>1,200 characters, too long</);
  });
});

describe("fmtKB under 1 KB (P3-20)", () => {
  it("names bytes under 1 KB", () => {
    expect(fmtKB(43)).toBe("43 bytes");
    expect(fmtKB(1)).toBe("1 byte");
    expect(fmtKB(1023)).toBe("1,023 bytes");
  });

  it("keeps kilobytes from 1 KB, and a dash when unknown", () => {
    expect(fmtKB(1024)).toBe("1.0 KB");
    expect(fmtKB(13248000)).toBe("12,937.5 KB");
    expect(fmtKB(0)).toBe("\u2014");
    expect(fmtKB(undefined)).toBe("\u2014");
  });

  it("names a 1-pixel lazy-load placeholder in bytes", () => {
    const gif = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    expect(inlineImageLabel(gif)).toBe("Inline image (GIF, 42 bytes)");
  });
});
