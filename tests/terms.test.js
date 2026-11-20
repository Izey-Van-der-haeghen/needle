import { describe, it, expect } from "vitest";
import { termFrequency, countPhrase, keywordPlacement, tokenize } from "../lib/terms.js";

describe("termFrequency", () => {
  it("counts content words and phrases, leaving out stopwords in four languages", () => {
    const text = "Running shoes for trail running. The best running shoes are light. De beste running shoes zijn licht. Les chaussures de running.";
    const r = termFrequency(text);
    expect(r.words[0]).toMatchObject({ term: "running", count: 5 });
    expect(r.words.map((w) => w.term)).not.toContain("the");
    expect(r.words.map((w) => w.term)).not.toContain("de");
    expect(r.phrases2[0]).toMatchObject({ term: "running shoes", count: 3 });
  });
});

describe("countPhrase and keywordPlacement", () => {
  it("matches whole words, ignoring case and accents", () => {
    expect(countPhrase("Vélo électrique pas cher, VELO electrique!", "velo électrique")).toBe(2);
    expect(countPhrase("offering", "offer")).toBe(0);
    expect(tokenize("l'isolation")).toEqual(["l", "isolation"]);
  });

  it("says where a keyphrase appears", () => {
    const page = {
      url: "https://e.com/trail-running-shoes/", title: "Trail running shoes guide", description: "How to pick shoes",
      headings: [{ level: 1, text: "Trail running shoes" }, { level: 2, text: "Why trail running shoes grip" }, { level: 2, text: "Prices" }],
      images: [{ alt: "trail running shoes on rocks" }, { alt: "" }]
    };
    const r = Object.fromEntries(keywordPlacement("trail running shoes", page, "Trail running shoes need grip. More text here.").map((x) => [x.place, x]));
    expect(r.Title.found).toBe(true);
    expect(r["Meta description"].found).toBe(false);
    expect(r.Subheadings.detail).toBe("1 of 2");
    expect(r.URL.found).toBe(true);
    expect(r["Image alt text"].detail).toBe("1 image");
  });
});
