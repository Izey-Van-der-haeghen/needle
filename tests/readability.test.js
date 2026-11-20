import { describe, it, expect } from "vitest";
import { readability, syllables } from "../lib/readability.js";

const easy = "The cat sat on the mat. It was a warm day. The sun was out. We went to the park. Kids ran and played. Dogs barked at birds. ".repeat(4);
const hard = "Notwithstanding considerable organisational complexity, interdisciplinary implementation methodologies necessitate comprehensive institutional coordination mechanisms throughout successive developmental iterations. ".repeat(8);

describe("readability", () => {
  it("scores short plain sentences as easy and long technical ones as difficult", () => {
    expect(readability(easy, "en")).toMatchObject({ supported: true, band: "easy" });
    expect(readability(hard, "en-GB").score).toBeLessThan(30);
  });

  it("uses the formula of the page language", () => {
    expect(readability(easy, "nl-BE").formula).toBe("Flesch–Douma");
    expect(readability(easy, "fr").formula).toBe("Kandel & Moles");
    expect(readability(easy, "de").formula).toBe("Amstad");
    expect(readability(easy, "ja")).toEqual({ supported: false, lang: "ja" });
  });

  it("says when a text is too short to score", () => {
    expect(readability("One line only.", "en").tooShort).toBe(true);
  });

  it("counts syllables roughly", () => {
    expect(syllables("cat")).toBe(1);
    expect(syllables("readability")).toBe(5);
    expect(syllables("fiets", "nl")).toBe(1);
  });
});
