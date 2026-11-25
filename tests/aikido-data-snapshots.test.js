// Aikido round of 25 November 2026, finding 9: the page writes the text in each snapshot, and the
// store keeps two snapshots for each of 200 pages in Chrome's 10 MB. The text fields are cut, so
// the store stays small however long a page makes them.
import { describe, it, expect } from "vitest";
import { snapshotOf, recordSnapshot, clipText } from "../lib/changes.js";
import { storedBytes } from "../lib/cache.js";

const TEXT_FIELDS = ["title", "description", "h1", "canonical", "robots", "lang", "xRobotsTag", "schemaTypes"];

/** A page whose every text field is `text`. */
function hostilePage(text) {
  return {
    title: text, description: text, canonical: text, robots: text, lang: text,
    headings: Array.from({ length: 50 }, () => ({ level: 1, text: text.slice(0, 200) })),
    schema: [{ type: text }, { type: `${text}2` }]
  };
}

describe("a snapshot of a page with megabytes of text", () => {
  it("cuts a 3 MB title to 200 characters and an ellipsis", () => {
    const snap = snapshotOf({ title: "T".repeat(3e6) }, null);
    expect(snap.title).toBe(`${"T".repeat(200)}…`);
    expect(storedBytes("u", snap)).toBeLessThan(2048);
  });

  it("cuts every text field, so the whole store fits beside the 4 MB cache", () => {
    // "<" is the worst case: Chrome writes it as \u003C, six bytes.
    const snap = snapshotOf(hostilePage("<".repeat(3e6)), { status: 200, headers: { "x-robots-tag": "<".repeat(3e6) } });
    for (const f of TEXT_FIELDS) expect(Array.from(snap[f]).length, f).toBeLessThanOrEqual(201);
    const one = storedBytes("https://e.com/", { snap, ts: Date.now(), prev: snap, prevTs: Date.now() });
    expect(one * 200).toBeLessThan(4 * 1024 * 1024);
  });

  it("counts code points, not UTF-16 units, and never splits an emoji", () => {
    const emoji = "\u{1F6B2}";
    expect(clipText(emoji.repeat(200))).toBe(emoji.repeat(200));
    expect(clipText(emoji.repeat(201))).toBe(`${emoji.repeat(200)}…`);
    expect(clipText("a".repeat(200))).toBe("a".repeat(200));
    expect(clipText(null)).toBe("");
  });

  it("keeps short text as it is", () => {
    const snap = snapshotOf({ title: "Fietsen", description: "D", headings: [{ level: 1, text: "H" }], lang: "nl" }, null);
    expect(snap).toMatchObject({ title: "Fietsen", description: "D", h1: "H", lang: "nl", canonical: "", robots: "" });
  });
});

describe("snapshots from before the cut", () => {
  const long = "Long title ".repeat(40);
  const url = "https://e.com/";

  it("set a new baseline instead of reporting the cut title as a change", () => {
    const before = { ...snapshotOf({ title: long }, null), title: long, v: 2 };
    const r = recordSnapshot({ [url]: { snap: before, ts: 1, prev: null, prevTs: null } }, url, snapshotOf({ title: long }, null), 2);
    expect(r.changes).toEqual([]);
  });

  it("are dropped for every page at once, so an oversized one doesn't hold storage", () => {
    const hostile = { ...snapshotOf({ title: "x" }, null), title: "x".repeat(3e6), v: 2 };
    const store = { "https://evil.example/": { snap: hostile, ts: 1, prev: hostile, prevTs: 0 } };
    const r = recordSnapshot(store, url, snapshotOf({ title: "Fietsen" }, null), 2);
    expect(Object.keys(r.store)).toEqual([url]);
  });

  it("keep snapshots of this version for other pages", () => {
    const now = snapshotOf({ title: "A" }, null);
    let r = recordSnapshot({}, "https://e.com/a", now, 1);
    r = recordSnapshot(r.store, "https://e.com/b", snapshotOf({ title: "B" }, null), 2);
    expect(Object.keys(r.store).sort()).toEqual(["https://e.com/a", "https://e.com/b"]);
  });
});
