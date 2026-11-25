// @vitest-environment jsdom
// The new rules in popup.css reach the popup's own markup. The update note, the verdict and the social
// cards come from the real popup.js. The note and verdict titles may become h2 (the a11y fixes): the
// same rules must reach them then, so each title is also tried as an h2.
import { it, expect, beforeAll, vi } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";
import { readRules } from "./helpers/css-rules.js";

const popup = readRules("popup.css");

/** Every value that a rule matching el gives prop, in this media query (or outside any), in source order. */
const valuesFor = (el, prop, media = null) =>
  popup.filter((r) => r.media === media && prop in r.decls && r.selectors.some((s) => el.matches(s))).map((r) => r.decls[prop]);

/** A copy of box in <main>, with its child at index replaced by a tagName element with the same class and text. */
function copyWith(box, index, tagName, className = box.className) {
  const copy = box.cloneNode(true);
  copy.className = className;
  const old = copy.children[index];
  const el = document.createElement(tagName);
  el.className = old.className;
  el.textContent = old.textContent;
  old.replaceWith(el);
  document.querySelector("main").append(copy);
  return { copy, el };
}

beforeAll(async () => {
  // After an update: the update note shows, above the verdict.
  await loadPopup({ local: { whatsNew: { from: "1.0.0", at: 1 } } });
  await vi.waitFor(() => expect(document.querySelector("#verdict-slot .verdict-head")).not.toBeNull());
});

it("the note title rule reaches the update note's title, and an h2 in the update or welcome note", () => {
  const note = document.querySelector(".whats-new");
  const looksLikeTitle = (el) => {
    expect(valuesFor(el, "font-size")).toContain("inherit");
    expect(valuesFor(el, "line-height")).toContain("inherit");
    expect(valuesFor(el, "margin")).toContain("0 0 2px");
  };
  looksLikeTitle(note.children[0]);
  looksLikeTitle(copyWith(note, 0, "h2").el);
  looksLikeTitle(copyWith(note, 0, "h2", "notice onboarding").el);
  looksLikeTitle(copyWith(note, 0, "strong", "notice onboarding").el);
});

it("L4: below 420 px of height the compact layout reaches every part of the note", () => {
  const m = "(max-height: 420px)";
  const note = document.querySelector(".whats-new");
  // The title, "What's new" and the buttons: each loses its margin.
  const parts = (box) => {
    expect(valuesFor(box, "display", m)).toContain("flex");
    expect(box.children).toHaveLength(3);
    for (const part of box.children) expect(valuesFor(part, "margin", m)).toContain("0");
  };
  parts(note);
  parts(copyWith(note, 0, "h2").copy);
  parts(copyWith(note, 0, "h2", "notice onboarding").copy);
});

it("the verdict title rule reaches the verdict's title, also as an h2", () => {
  const head = document.querySelector("#verdict-slot .verdict-head");
  const title = head.querySelector(":scope > .verdict-title, :scope > h2");
  const index = [...head.children].indexOf(title);
  const looksLikeTitle = (el) => {
    expect(valuesFor(el, "font-size").at(-1)).toBe("17px");
    expect(valuesFor(el, "line-height")).toContain("inherit");
    expect(valuesFor(el, "margin")).toContain("0");
  };
  looksLikeTitle(title);
  looksLikeTitle(copyWith(head, index, "h2").el);
  // An h2 without the class, too.
  const bare = copyWith(head, index, "h2").el;
  bare.removeAttribute("class");
  looksLikeTitle(bare);
});

it("P3-21: the two-line clamp reaches both social titles and the description, not the host", () => {
  const bodies = [...document.querySelectorAll(".social-body")];
  expect(bodies).toHaveLength(2);
  const clamped = bodies.map((b) => [...b.children].filter((c) => valuesFor(c, "-webkit-line-clamp").includes("2")).map((c) => c.tagName));
  expect(clamped).toEqual([["STRONG", "DIV"], ["STRONG"]]);
});

it("P3-17: --pages counts the page columns of a Compare table, and the metric column is 30 %", () => {
  // The markup of renderCompareMulti in popup.js: a header cell for the metric, one per page; rows start with a th.
  for (const pages of [2, 3, 4]) {
    const table = document.createElement("table");
    table.className = "compare-table";
    table.innerHTML = `<thead><tr><th scope="col"><span class="visually-hidden">Metric</span></th>${'<th scope="col">Page</th>'.repeat(pages)}</tr></thead>
      <tbody><tr><th scope="row">Words</th>${"<td>1,234</td>".repeat(pages)}</tr></tbody>`;
    document.querySelector("main").append(table);
    // The later rules are also the more specific ones, so the last value is the one that applies.
    expect(valuesFor(table, "--pages").at(-1)).toBe(String(pages));
    expect(valuesFor(table.rows[0].cells[0], "width")).toContain("30%");
    expect(valuesFor(table.rows[1].cells[0], "width")).toContain("30%");
  }
});
