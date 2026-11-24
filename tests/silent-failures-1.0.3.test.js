// Full check of 24 November 2026, silent-failure hunt: images left out by position, a settings
// import that mixed or wiped rules.
import { describe, it, expect } from "vitest";
import { analyze, html } from "./helpers/content-harness.js";
import { readSettingsFile } from "../lib/settings.js";
import { isContentImage } from "../lib/image-rules.js";

describe("images on a page without landmarks", () => {
  it("a large photo near the end of a long article is content, not footer", async () => {
    const tall = (y, w, h) => `data-test-rect="0,${y},${w},${h}"`;
    const page = html(`<div><p>text</p>
      <img src="/a.jpg" alt="" width="900" height="600" ${tall(9000, 900, 600)}>
      <img src="/icon.png" alt="" width="24" height="24" ${tall(9900, 24, 24)}></div>`);
    const d = await analyze(page, { setup: (w) => { Object.defineProperty(w.HTMLElement.prototype, "scrollHeight", { get() { return 10000; }, configurable: true }); } });
    const [photo, icon] = d.images;
    expect(photo.context).not.toBe("footer");
    expect(isContentImage(photo)).toBe(true);
    expect(icon.context).toBe("footer");
  });
});

describe("importing a settings file", () => {
  const lists = { locations: [{ code: 2056 }], languages: [{ code: "nl" }] };
  it("never mixes half an image size with the stored one, and skips what the form would refuse", () => {
    expect(readSettingsFile({ imgWidth: "800" }, lists)).toEqual({ prefs: {}, secrets: {}, skipped: 1 });
    expect(readSettingsFile({ imgWidth: "1200", imgHeight: "630", imgMaxKB: "150" }, lists).prefs).toEqual({ imgWidth: "1200", imgHeight: "630", imgMaxKB: "150" });
    const bad = readSettingsFile({ imgHeight: "0", imgWidth: "1200", imgMaxKB: "-5", theme: "neon", csvSeparator: "|", defaultLocation: "9999" }, lists);
    expect(bad.prefs).toEqual({});
    expect(bad.skipped).toBe(5);
  });
  it("keeps valid values and secrets", () => {
    const r = readSettingsFile({ theme: "dark", csvSeparator: ";", defaultLocation: "2056", popupShortcuts: false, psiKey: "k" }, lists);
    expect(r).toEqual({ prefs: { theme: "dark", csvSeparator: ";", defaultLocation: "2056", popupShortcuts: false }, secrets: { psiKey: "k" }, skipped: 0 });
  });
  it("checks the image-rule mode and the language against what the form offers", () => {
    expect(readSettingsFile({ imgMode: "ratio", defaultLanguage: "nl" }, lists)).toEqual({ prefs: { imgMode: "ratio", defaultLanguage: "nl" }, secrets: {}, skipped: 0 });
    expect(readSettingsFile({ imgMode: "exact" }, lists).prefs).toEqual({ imgMode: "exact" });
    expect(readSettingsFile({ imgMode: "fit", defaultLanguage: "xx" }, lists)).toEqual({ prefs: {}, secrets: {}, skipped: 2 });
  });
  it("reads the two switches, and only as true or false", () => {
    expect(readSettingsFile({ openInSidePanel: true, popupShortcuts: true }, lists).prefs).toEqual({ openInSidePanel: true, popupShortcuts: true });
    expect(readSettingsFile({ openInSidePanel: false }, lists).prefs).toEqual({ openInSidePanel: false });
    expect(readSettingsFile({ openInSidePanel: "true", popupShortcuts: 1 }, lists).prefs).toEqual({});
  });
  // The JSDoc says "Anything else is skipped and counted", but a switch that is not true or false is
  // dropped without being counted, so the import doesn't say it skipped it.
  it.todo("counts a switch that is not true or false as skipped");
});
