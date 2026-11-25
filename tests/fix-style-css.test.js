// Layout fixes that jsdom can't measure, because it has no layout. These tests read popup.css and
// check that the rule is there.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

// Comments out, so a rule that is only described or commented out doesn't count.
const css = readFileSync(new URL("../popup.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("popup.css", () => {
  it("wraps one long word in the Google preview, so the 320 px side panel doesn't scroll sideways", () => {
    // On the box, so the crumbs, the title and the description all wrap.
    expect(css).toMatch(/(^|\n)\.serp-preview\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });

  it("keeps History, theme and Settings in place in the side panel when Download appears", () => {
    // The brand takes the free space, so a new icon appears to the left of History.
    expect(css).toMatch(/(^|\n)html\.side-panel \.topbar \.brand\s*\{[^}]*margin-inline-end:\s*auto/);
  });
});
