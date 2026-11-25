// Full check of 25 November 2026, P2-9: file names keep the words of every script.
import { describe, it, expect } from "vitest";
import { fileSlug, pathSlug } from "../lib/popup-helpers.js";
import { compareExportFilename } from "../lib/compare-export.js";

const me = [{ isMe: true, data: { url: "https://www.example.com/" } }];
const keywordPart = (keyword) => compareExportFilename(me, keyword, "csv").match(/^compare-example\.com(.*)-\d{4}-\d{2}-\d{2}\.csv$/)[1];

describe("file names in other scripts", () => {
  it("keeps the marks that are part of the word", () => {
    expect(keywordPart("バイク修理 東京")).toBe("-バイク修理-東京");
    expect(keywordPart("साइकिल मरम्मत")).toBe("-साइकिल-मरम्मत");
    expect(keywordPart("ซ่อมจักรยาน")).toBe("-ซ่อมจักรยาน");
    expect(keywordPart("நன்றி")).toBe("-நன்றி");
    expect(pathSlug("https://e.jp/ja/バイク/")).toBe("-ja-バイク");
  });

  it("writes Korean in its composed form (NFC), however it was typed", () => {
    const part = keywordPart("자전거 수리".normalize("NFD"));
    expect(part).toBe("-자전거-수리");
    expect(part).toBe(part.normalize("NFC"));
  });

  it("adds no keyword part for an emoji, so there is no double dash", () => {
    expect(compareExportFilename(me, "\u{1F6B2}", "csv")).toMatch(/^compare-example\.com-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(compareExportFilename(me, "\u{1F6B2} repair", "csv")).toMatch(/^compare-example\.com-repair-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("cuts by character as people see it, never inside a syllable", () => {
    // 41 code points but 21 characters: all fit in 30.
    expect(keywordPart(`x${"कि".repeat(20)}`)).toBe(`-x${"कि".repeat(20)}`);
    expect(fileSlug("कि".repeat(20), 15)).toBe("कि".repeat(15));
  });

  it("leaves no dash at the end of a cut keyword", () => {
    expect(keywordPart(`${"a".repeat(29)} b`)).toBe(`-${"a".repeat(29)}`);
  });
});

describe("file names in Latin script, as before", () => {
  // The slug before this fix, for Latin text.
  const before = (s, max) => s.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, max);

  it("still strips accents", () => {
    for (const s of ["entretien vélo électrique", "Fahrrad-Reparatur Köln", "Ångström søknad", "phở bò Hà Nội", "Kraków łódź", "a".repeat(80)]) {
      expect(keywordPart(s)).toBe(`-${before(s, 30)}`);
    }
    expect(pathSlug("https://www.example.be/fr/vélos/")).toBe("-fr-velos");
  });
});
