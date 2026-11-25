// Full check of 25 November 2026, P3-1: a settings file whose settings are not an object.
import { describe, it, expect } from "vitest";
import { readSettingsFile } from "../lib/settings.js";

const lists = { locations: [{ code: 2056 }], languages: [{ code: "fr" }] };
const nothing = { prefs: {}, secrets: {}, skipped: 0 };

describe("readSettingsFile with settings that are not an object", () => {
  it("reads nothing from a number, a string, true or a list, and doesn't throw", () => {
    for (const payload of [5, 5e-324, 0, -1, "dark", "", true, false, null, undefined, [], ["theme"], [{ theme: "dark" }]]) {
      expect(readSettingsFile(payload, lists)).toEqual(nothing);
    }
  });

  it("never throws on any JSON value", () => {
    const values = [0, 1, 1.5, -0, 1e308, "x", "defaultLocation", true, false, null, [], [1], {}, { a: 1 }, { theme: 5 }, { settings: 5 }];
    const kinds = [...values, ...values.map((v) => [v]), ...values.map((v) => ({ theme: v, imgWidth: v, popupShortcuts: v }))];
    for (const payload of kinds) {
      const r = readSettingsFile(JSON.parse(JSON.stringify(payload ?? null)), lists);
      expect(Object.keys(r)).toEqual(["prefs", "secrets", "skipped"]);
    }
  });

  it("still reads an object", () => {
    expect(readSettingsFile({ theme: "dark" }, lists)).toEqual({ prefs: { theme: "dark" }, secrets: {}, skipped: 0 });
  });
});
