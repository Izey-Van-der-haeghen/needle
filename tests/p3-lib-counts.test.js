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

describe("the size of an inline image is the size it decodes to (P3-20)", () => {
  it("leaves base64's '=' padding out", () => {
    const gif = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
    expect(Buffer.from(gif.split(",")[1], "base64")).toHaveLength(43);
    expect(inlineImageLabel(gif)).toBe("Inline image (GIF, 43 bytes)");
    // The same padding written as %3D, and with line breaks, as some pages have it.
    expect(inlineImageLabel(gif.replace("==", "%3D%3D"))).toBe("Inline image (GIF, 43 bytes)");
    expect(inlineImageLabel(gif.replace("R0lGODlh", "R0lG\nODlh "))).toBe("Inline image (GIF, 43 bytes)");
  });

  it("counts a percent-escape as one byte", () => {
    expect(inlineImageLabel("data:image/svg+xml,%3Csvg%3E%3C/svg%3E")).toBe("Inline image (SVG, 11 bytes)");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>`;
    expect(inlineImageLabel(`data:image/svg+xml,${encodeURIComponent(svg)}`)).toBe(`Inline image (SVG, ${svg.length} bytes)`);
    expect(inlineImageLabel("data:image/svg+xml;utf8,<svg><text>é</text></svg>")).toBe("Inline image (SVG, 26 bytes)");
  });

  it("agrees with the decoded bytes for every length up to 1 KB", () => {
    const wrong = [];
    for (let n = 1; n < 1024; n++) {
      const bytes = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + n) % 256));
      const svg = "é<".repeat(n).slice(0, n);
      if (inlineImageLabel(`data:image/png;base64,${bytes.toString("base64")}`) !== `Inline image (PNG, ${fmtKB(n)})`) wrong.push(`base64 ${n}`);
      const label = inlineImageLabel(`data:image/svg+xml,${encodeURIComponent(svg)}`);
      if (label !== `Inline image (SVG, ${fmtKB(Buffer.byteLength(svg))})`) wrong.push(`escaped ${n}`);
    }
    expect(wrong).toEqual([]);
  });
});
