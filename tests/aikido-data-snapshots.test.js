// Aikido round of 25 November 2026, finding 9: the page writes the text in each snapshot and its own
// URL (history.replaceState), and the store keeps two snapshots for each of 200 pages in Chrome's
// 10 MB. Both are cut, so the store stays small however long a page makes them, and a cut text
// keeps a fingerprint of all of it, so an edit after the cut still reads as a change.
import { describe, it, expect } from "vitest";
import { snapshotOf, recordSnapshot, clipText, snapText } from "../lib/changes.js";
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
  it("cuts a 3 MB title to 200 characters: its start, an ellipsis, its length and a fingerprint", () => {
    const snap = snapshotOf({ title: "T".repeat(3e6) }, null);
    expect(snap.title).toMatch(/^T{150,}… \(3000000 characters, [0-9a-z]+\)$/);
    expect(Array.from(snap.title)).toHaveLength(200);
    expect(storedBytes("u", snap)).toBeLessThan(2048);
  });

  it("cuts every text field, so the whole store fits beside the 4 MB cache", () => {
    // "<" is the worst case: Chrome writes it as \u003C, six bytes.
    const snap = snapshotOf(hostilePage("<".repeat(3e6)), { status: 200, headers: { "x-robots-tag": "<".repeat(3e6) } });
    for (const f of TEXT_FIELDS) expect(Array.from(snap[f]).length, f).toBeLessThanOrEqual(200);
    const one = storedBytes("https://e.com/", { snap, ts: Date.now(), prev: snap, prevTs: Date.now() });
    expect(one * 200).toBeLessThan(4 * 1024 * 1024);
  });

  it("counts code points, not UTF-16 units, and never splits an emoji", () => {
    const emoji = "\u{1F6B2}";
    expect(clipText(emoji.repeat(200))).toBe(emoji.repeat(200));
    expect(clipText(emoji.repeat(201))).toBe(`${emoji.repeat(200)}…`);
    expect(clipText("a".repeat(200))).toBe("a".repeat(200));
    expect(clipText(null)).toBe("");
    expect(snapText(emoji.repeat(200))).toBe(emoji.repeat(200));
    const cut = snapText(emoji.repeat(201));
    expect(cut).toMatch(/^(\u{1F6B2})+… \(201 characters, [0-9a-z]+\)$/u);
    expect(Array.from(cut)).toHaveLength(200);
    expect(snapText(null)).toBe("");
  });

  it("keeps short text as it is", () => {
    const snap = snapshotOf({ title: "Fietsen", description: "D", headings: [{ level: 1, text: "H" }], lang: "nl" }, null);
    expect(snap).toMatchObject({ title: "Fietsen", description: "D", h1: "H", lang: "nl", canonical: "", robots: "" });
  });
});

describe("the snapshot store", () => {
  it("stays under 4.2 MB, as Chrome counts it, however long a page makes its URL and text", () => {
    // The worst case: 200 URLs and every text field at 200 code points of "<" (six bytes each, and
    // not cut), and two snapshots for each URL.
    const lt = "<".repeat(200);
    const page = { title: lt, description: lt, canonical: lt, robots: lt, lang: lt, headings: [{ level: 1, text: lt }], schema: [{ type: lt }] };
    const tech = { status: 200, headers: { "x-robots-tag": lt } };
    let store = {};
    for (let i = 0; i < 200; i++) {
      const url = "<".repeat(197) + String(i).padStart(3, "0");
      store = recordSnapshot(store, url, snapshotOf(page, tech, 0), i).store;
      store = recordSnapshot(store, url, snapshotOf(page, tech, 50), i + 1000).store;
    }
    expect(Object.keys(store)).toHaveLength(200);
    expect(Object.values(store).every((e) => e.prev)).toBe(true);
    expect(storedBytes("snapshots", store)).toBeLessThan(4.2e6);
  });

  it("keeps a 2 MB URL as a short key, and still finds it again", () => {
    const url = `https://evil.example/?q=${"a".repeat(2 * 1024 * 1024)}`;
    let r = recordSnapshot({}, url, snapshotOf({ title: "One" }, null), 1);
    r = recordSnapshot(r.store, url, snapshotOf({ title: "Two" }, null), 2);
    expect(r.changes.map((c) => c.field)).toEqual(["title"]);
    expect(storedBytes("snapshots", r.store)).toBeLessThan(2048);
  });

  it("keeps two long URLs that differ only after the cut apart", () => {
    const base = `https://shop.example/?${"p=1&".repeat(60)}`;
    let r = recordSnapshot({}, `${base}a`, snapshotOf({ title: "A" }, null), 1);
    r = recordSnapshot(r.store, `${base}b`, snapshotOf({ title: "B" }, null), 2);
    expect(Object.keys(r.store)).toHaveLength(2);
    expect(r.changes).toEqual([]);
  });

  it("keeps a URL of 200 characters or fewer as it is", () => {
    const url = `https://e.com/${"a".repeat(186)}`;
    expect(Object.keys(recordSnapshot({}, url, snapshotOf({ title: "A" }, null), 1).store)).toEqual([url]);
  });
});

describe("an edit after the first 200 characters", () => {
  const changed = (before, after) => {
    const r = recordSnapshot({}, "https://e.com/", snapshotOf(before, null), 1);
    return recordSnapshot(r.store, "https://e.com/", snapshotOf(after, null), 2).changes.map((c) => c.field);
  };
  const canon = `https://shop.example/category/sub/product-name-that-is-long?${"p=1&".repeat(40)}`;
  const desc = "Bikes for town and country, with free delivery in Belgium and the Netherlands. ".repeat(4);

  it("still reads as a change: the end of a long canonical, meta description or joined H1", () => {
    expect(changed({ canonical: `${canon}variant=red` }, { canonical: `${canon}variant=blue` })).toEqual(["canonical"]);
    // The same length: only the fingerprint tells them apart.
    expect(changed({ description: `${desc}Order now.` }, { description: `${desc}Order Now.` })).toEqual(["description"]);
    const h1s = (last) => ({ headings: [{ level: 1, text: "A".repeat(190) }, { level: 1, text: last }] });
    expect(changed(h1s("Second heading one"), h1s("Second heading two"))).toEqual(["h1"]);
  });

  it("doesn't read as a change when nothing changed", () => {
    expect(changed({ canonical: `${canon}x`, description: desc }, { canonical: `${canon}x`, description: desc })).toEqual([]);
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
