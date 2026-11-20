import { describe, it, expect } from "vitest";
import { normaliseImageRules, matchesExpectedSize, imageSizeIssues, leadImageCheck, applyImageRules } from "../lib/image-rules.js";

describe("image rules", () => {
  it("defaults to a 100 KB limit and no size rule", () => {
    expect(normaliseImageRules({})).toEqual({ maxKB: 100, width: 0, height: 0, mode: "ratio" });
    expect(normaliseImageRules({ imgMaxKB: "250", imgWidth: "1200", imgHeight: "630", imgMode: "exact" })).toEqual({ maxKB: 250, width: 1200, height: 630, mode: "exact" });
  });

  it("checks a team's expected size exactly or by shape", () => {
    const exact = normaliseImageRules({ imgWidth: 1200, imgHeight: 630, imgMode: "exact" });
    const shape = normaliseImageRules({ imgWidth: 1200, imgHeight: 630 });
    expect(matchesExpectedSize({ naturalWidth: 1200, naturalHeight: 630 }, exact)).toBe(true);
    expect(matchesExpectedSize({ naturalWidth: 2400, naturalHeight: 1260 }, exact)).toBe(false);
    expect(matchesExpectedSize({ naturalWidth: 2400, naturalHeight: 1260 }, shape)).toBe(true);
    expect(matchesExpectedSize({ naturalWidth: 800, naturalHeight: 800 }, shape)).toBe(false);
    expect(matchesExpectedSize({ naturalWidth: 800, naturalHeight: 800 }, normaliseImageRules({}))).toBeNull();
  });

  it("lists size problems with the team's limits", () => {
    const rules = normaliseImageRules({ imgMaxKB: 200, imgWidth: 4, imgHeight: 3 });
    const labels = imageSizeIssues({ bytes: 250 * 1024, upscaled: true, naturalWidth: 1600, naturalHeight: 900 }, rules).map(([t]) => t);
    expect(labels).toEqual(["over 200 KB", "shown larger than the file (blurry)", "not 4:3 in shape"]);
    expect(imageSizeIssues({ bytes: 150 * 1024, naturalWidth: 800, naturalHeight: 600 }, rules)).toEqual([]);
  });

  it("finds the main image and checks it is at least 1200 px wide", () => {
    const imgs = [{ naturalWidth: 300, naturalHeight: 300, aboveFold: true }, { naturalWidth: 1000, naturalHeight: 600, aboveFold: true }, { naturalWidth: 2000, naturalHeight: 1000 }];
    expect(leadImageCheck(imgs)).toMatchObject({ img: { naturalWidth: 1000 }, wideEnough: false });
    expect(leadImageCheck([])).toBeNull();
  });

  it("sets the oversized flag the score and report use", () => {
    const imgs = applyImageRules([{ bytes: 150 * 1024 }, { bytes: 50 * 1024 }], normaliseImageRules({ imgMaxKB: 120 }));
    expect(imgs.map((i) => i.oversized)).toEqual([true, false]);
  });
});
