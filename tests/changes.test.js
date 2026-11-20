import { describe, it, expect } from "vitest";
import { snapshotOf, diffSnapshots, recordSnapshot } from "../lib/changes.js";

const page = (over = {}) => ({ title: "Old title", description: "D", headings: [{ level: 1, text: "H" }], canonical: "https://e.com/", robots: "", lang: "en", schema: [{ type: "Article" }], hreflang: [], mainContentWordCount: 500, images: [], ...over });

describe("change tracking", () => {
  it("reports what changed, ignoring small word-count moves", () => {
    const a = snapshotOf(page(), { status: 200, headers: {} }, 80);
    const b = snapshotOf(page({ title: "New title", mainContentWordCount: 505 }), { status: 200, headers: {} }, 81);
    expect(diffSnapshots(a, b)).toEqual([{ field: "title", label: "Title", before: "Old title", after: "New title" }]);
  });

  it("keeps showing the last change when the page is audited again without changes", () => {
    const a = snapshotOf(page(), null, 80);
    const b = snapshotOf(page({ robots: "noindex" }), null, 40);
    let r = recordSnapshot({}, "https://e.com/", a, 1000);
    expect(r.changes).toEqual([]);
    r = recordSnapshot(r.store, "https://e.com/", b, 2000);
    expect(r.changes.map((c) => c.field)).toEqual(["robots", "score"]);
    expect(r.since).toBe(1000);
    r = recordSnapshot(r.store, "https://e.com/", b, 3000);
    expect(r.changes.map((c) => c.field)).toEqual(["robots", "score"]);
    expect(r.since).toBe(1000);
  });

  it("does not count a failed server check as a status change", () => {
    expect(diffSnapshots(snapshotOf(page(), { status: 200, headers: {} }), snapshotOf(page(), null))).toEqual([]);
  });
});
