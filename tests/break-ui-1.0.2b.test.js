// Full check of 1.0.2, Break UI round on 877648d.
import { describe, it, expect } from "vitest";
import { noConnection } from "../lib/link-checker.js";
import { dateAsWritten } from "../lib/geo.js";
import { inlineImageLabel } from "../lib/popup-helpers.js";
import { formatAge } from "../lib/cache.js";
import { compareExportFilename } from "../lib/compare-export.js";
import { computeIndexability } from "../lib/popup-compute.js";

describe("Break UI round", () => {
  it("links to one host that hangs are not 'no internet connection'", () => {
    const dead = (url) => ({ url, kind: "timeout", status: 0 });
    expect(noConnection(["https://booking.example/a", "https://booking.example/b", "https://booking.example/c"].map(dead))).toBe(false);
    expect(noConnection(["https://a.example/", "https://b.example/", "https://c.example/"].map(dead))).toBe(true);
  });

  it("an array of dates shows its first; WordPress's zero date is no date", () => {
    expect(dateAsWritten(["2026-11-21", "2026-11-22"])).toBe("2026-11-21");
    expect(dateAsWritten([{ "@value": "2026-11-20" }])).toBe("2026-11-20");
    expect(dateAsWritten("0000-00-00 00:00:00")).toBe("");
  });

  it("an inline image is named by its type and size, not its base64", () => {
    const src = "data:image/png;base64," + "A".repeat(4096);
    expect(inlineImageLabel(src)).toBe("Inline image (PNG, 3.0 KB)");
    expect(inlineImageLabel("data:image/svg+xml,%3Csvg%3E%3C/svg%3E")).toBe("Inline image (SVG, 11 bytes)"); // "<svg></svg>"; under 1 KB: bytes (P3-20)
  });

  it("a result saved a moment ago says 'just now'", () => {
    expect(formatAge(400)).toBe("just now");
    expect(formatAge(12_000)).toBe("12s ago");
  });

  it("the Compare file name keeps accented words readable", () => {
    expect(compareExportFilename([{ isMe: true, url: "https://www.example.be/" }], "entretien vélo électrique", "csv")).toContain("entretien-velo-electrique");
  });

  it("the verdict's hint for a passed unavailable_after date doesn't talk about noindex", () => {
    const v = computeIndexability({ url: "https://e.com/", canonical: "https://e.com/", robots: "index, follow, unavailable_after: 2025-06-30T23:59:59+02:00" }, { status: 200, headers: {}, robotsTxt: { ok: true, pathAllowed: { allowed: true } } });
    const issue = v.issues.find((i) => /unavailable_after/.test(i.msg));
    expect(v.level).toBe("bad");
    expect(issue.hint).toBe("Remove unavailable_after from the robots meta tag, or set a later date.");
  });
});
