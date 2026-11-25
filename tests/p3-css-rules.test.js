// The P3 polish and the morning's layout items from the steps 3-7 check (notes/reviews-2026-11-24b),
// as rules in popup.css and base.css. jsdom has no layout, so these tests check that each rule is there;
// what it does on screen is checked by the browser pass in dev/check/fullcheck.mjs.
import { describe, it, expect } from "vitest";
import { readRules, declared } from "./p3-css-parse.js";

const popup = readRules("popup.css");
const base = readRules("base.css");
const both = [...base, ...popup];

describe("P3 polish", () => {
  it("P3-13: an image's alt line breaks a long word (a file name) instead of running out of the list", () => {
    expect(declared(popup, ".item-meta", "overflow-wrap")).toBe("anywhere");
  });

  it("P3-16: the word list has one column in the side panel, and three again from 520 px", () => {
    expect(declared(popup, "html.side-panel .term-grid", "grid-template-columns")).toBe("1fr");
    expect(declared(popup, "html.side-panel .term-grid", "grid-template-columns", "(min-width: 520px)")).toBe("repeat(3, 1fr)");
  });

  it("P3-17: every Compare table has the same columns: the metric takes 30 %", () => {
    expect(declared(popup, ".compare-table", "table-layout")).toBe("fixed");
    expect(declared(popup, ".compare-table", "width")).toBe("100%");
    expect(declared(popup, ".compare-table tr > :first-child", "width")).toBe("30%");
  });

  it("P3-17: each page column keeps at least 90 px, for 2, 3 and 4 pages", () => {
    // The pages share the 70 % the metric leaves: pages × 90 px / 0.7 makes each page column 90 px.
    expect(declared(popup, ".compare-table", "min-width")).toBe("calc(var(--pages) * 90px / .7)");
    expect(declared(popup, ".compare-table", "--pages")).toBe("2");
    expect(declared(popup, ".compare-table:has(th:nth-child(4))", "--pages")).toBe("3");
    expect(declared(popup, ".compare-table:has(th:nth-child(5))", "--pages")).toBe("4");
    // The cells' own minimum widths are gone: with fixed columns the table's minimum is the one rule.
    for (const sel of [".compare-table th", ".compare-table td", ".compare-table tbody th"]) {
      expect(declared(popup, sel, "min-width")).toBeUndefined();
    }
  });

  it("P3-21: a social card shows two lines of title and of description", () => {
    for (const sel of [".social-body > strong", ".social-body > strong + div"]) {
      expect(declared(popup, sel, "display")).toBe("-webkit-box");
      expect(declared(popup, sel, "-webkit-box-orient")).toBe("vertical");
      expect(declared(popup, sel, "-webkit-line-clamp")).toBe("2");
      expect(declared(popup, sel, "overflow")).toBe("hidden");
    }
  });

  it("P3-22: 12.5 px is gone: the hint, the filter buttons and Compare are 13 px", () => {
    expect(declared(base, ".hint", "font-size")).toBe("13px");
    expect(declared(popup, ".filter-btn", "font-size")).toBe("13px");
    expect(declared(popup, ".compare-table", "font-size")).toBe("13px");
    const sizes = both.flatMap((r) => Object.entries(r.decls)).filter(([p]) => p === "font-size" || p === "font").map(([, v]) => v);
    expect(sizes.filter((v) => /\b12\.5px/.test(v))).toEqual([]);
  });

  it("P3-26: figures line up in tables, and a finding title is balanced", () => {
    expect(declared(base, ".data-table", "font-variant-numeric")).toBe("tabular-nums");
    expect(declared(popup, ".compare-table", "font-variant-numeric")).toBe("tabular-nums");
    expect(declared(popup, ".finding-title", "text-wrap")).toBe("balance");
  });
});

describe("a11y #17: the side panel at 200 % (160 CSS px)", () => {
  it("the finding and verdict heads wrap, and a finding title takes a line of its own below 9em", () => {
    expect(declared(popup, ".finding-head", "flex-wrap")).toBe("wrap");
    expect(declared(popup, ".verdict-head", "flex-wrap")).toBe("wrap");
    expect(declared(popup, ".finding-title", "flex")).toBe("1 1 9em");
  });

  it("a row puts its value under its key below 300 px", () => {
    expect(declared(popup, ".row", "grid-template-columns", "(max-width: 300px)")).toBe("1fr");
    expect(declared(popup, ".row", "gap", "(max-width: 300px)")).toBe("0");
  });

  it("a status label may wrap, and no rule turns that off again", () => {
    expect(declared(base, ".tag", "white-space")).toBe("normal");
    const noWrap = both.filter((r) => r.decls["white-space"] === "nowrap" && r.selectors.some((s) => /\.tag(?![\w-])/.test(s)));
    expect(noWrap.map((r) => r.selectors.join(", "))).toEqual([]);
  });
});

describe("L4: the update and welcome notes below 420 px of height", () => {
  const m = "(max-height: 420px)";

  it("the note puts its parts side by side and wraps them", () => {
    for (const note of [".whats-new", ".onboarding"]) {
      expect(declared(popup, note, "display", m)).toBe("flex");
      expect(declared(popup, note, "flex-wrap", m)).toBe("wrap");
      expect(declared(popup, note, "align-items", m)).toBe("center");
      expect(declared(popup, note, "gap", m)).toBe("4px 12px");
    }
  });

  it("the title, the disclosure and the buttons lose their margins; the gap spaces them", () => {
    for (const part of [":is(.whats-new, .onboarding) > strong", ":is(.whats-new, .onboarding) h2",
      ":is(.whats-new, .onboarding) > details.sub", ":is(.whats-new, .onboarding) > .actions"]) {
      expect(declared(popup, part, "margin", m)).toBe("0");
    }
  });
});

describe("note and verdict titles as h2 (the a11y fixes) keep their look", () => {
  it("a note title looks the same as a strong or as an h2", () => {
    // What the strong had: a block, 2 px under it, the note's size and line height, bold.
    // An h2 gets 1.5em from the browser and line-height 1.3 from base.css: both are undone.
    for (const sel of [":is(.whats-new, .onboarding) > strong", ":is(.whats-new, .onboarding) h2"]) {
      expect(declared(popup, sel, "display")).toBe("block");
      expect(declared(popup, sel, "margin")).toBe("0 0 2px");
      expect(declared(popup, sel, "font-size")).toBe("inherit");
      expect(declared(popup, sel, "line-height")).toBe("inherit");
      expect(declared(popup, sel, "font-weight")).toBe("700");
    }
  });

  it("the verdict title looks the same as a span or as an h2", () => {
    for (const sel of [".verdict-title", ".verdict-head > h2"]) {
      expect(declared(popup, sel, "font-size")).toBe("17px");
      expect(declared(popup, sel, "font-weight")).toBe("700");
      expect(declared(popup, sel, "line-height")).toBe("inherit");
      expect(declared(popup, sel, "margin")).toBe("0");
      expect(declared(popup, sel, "flex")).toBe("1");
    }
  });
});
