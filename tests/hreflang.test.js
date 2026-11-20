import { describe, it, expect } from "vitest";
import { validateHreflang } from "../lib/hreflang.js";

const find = (issues, substr) => issues.find((i) => i.msg.includes(substr));

describe("validateHreflang — input handling", () => {
  it("returns [] for empty array, null, undefined", () => {
    expect(validateHreflang([])).toEqual([]);
    expect(validateHreflang(null)).toEqual([]);
    expect(validateHreflang(undefined)).toEqual([]);
  });
});

describe("validateHreflang — BCP-47 format", () => {
  it("accepts language-only codes (en, nl, de)", () => {
    const issues = validateHreflang([
      { lang: "en", href: "https://e.com/en" },
      { lang: "nl", href: "https://e.com/nl" },
      { lang: "de", href: "https://e.com/de" },
      { lang: "x-default", href: "https://e.com/" },
    ]);
    expect(find(issues, "Invalid hreflang")).toBeUndefined();
  });

  it("accepts language-region codes (en-US, nl-BE, fr-FR)", () => {
    const issues = validateHreflang([
      { lang: "en-US", href: "https://e.com/en-us" },
      { lang: "nl-BE", href: "https://e.com/nl-be" },
      { lang: "fr-FR", href: "https://e.com/fr-fr" },
      { lang: "x-default", href: "https://e.com/" },
    ]);
    expect(find(issues, "Invalid hreflang")).toBeUndefined();
  });

  it("accepts language-script-region codes (zh-Hans-CN)", () => {
    const issues = validateHreflang([
      { lang: "zh-Hans-CN", href: "https://e.com/zh-hans-cn" },
      { lang: "x-default", href: "https://e.com/" },
    ]);
    expect(find(issues, "Invalid hreflang")).toBeUndefined();
  });

  it("accepts x-default as a special token", () => {
    const issues = validateHreflang([
      { lang: "x-default", href: "https://e.com/" },
    ]);
    expect(find(issues, "Invalid hreflang")).toBeUndefined();
  });

  it("flags underscore separators (nl_BE) — common copy-paste mistake from CMS exports", () => {
    const issues = validateHreflang([{ lang: "nl_BE", href: "https://e.com" }]);
    const err = find(issues, "Invalid hreflang");
    expect(err?.level).toBe("error");
    expect(err?.msg).toContain("nl_BE");
  });

  it("flags region words instead of ISO codes (en-belgium)", () => {
    const issues = validateHreflang([{ lang: "en-belgium", href: "https://e.com" }]);
    expect(find(issues, "Invalid hreflang")?.level).toBe("error");
  });

  it("accepts any letter case, like Google (NL, en-us, nl-BE)", () => {
    for (const lang of ["NL", "en-us", "nl-BE", "zh-Hant-TW"]) {
      expect(find(validateHreflang([{ lang, href: "https://e.com/" }]), "Invalid hreflang"), lang).toBeUndefined();
    }
  });

  it("flags UK as a region (use GB) and numeric regions Google ignores (es-419)", () => {
    expect(find(validateHreflang([{ lang: "en-UK", href: "https://e.com/" }]), "Invalid hreflang region")?.hint).toMatch(/GB/);
    expect(find(validateHreflang([{ lang: "es-419", href: "https://e.com/" }]), "Invalid hreflang")?.level).toBe("error");
  });

  it("rejects look-alike letters outside ASCII", () => {
    expect(find(validateHreflang([{ lang: "en-\u212Aa", href: "https://e.com/" }]), "Invalid hreflang")?.level).toBe("error");
  });

  it("treats nl-BE and nl-be as the same tag when checking duplicates", () => {
    const dup = find(validateHreflang([{ lang: "nl-BE", href: "https://e.com/a" }, { lang: "nl-be", href: "https://e.com/b" }]), "Duplicate");
    expect(dup?.msg).toContain('"nl-BE" / "nl-be" (2×)');
  });

  it("flags empty lang", () => {
    const issues = validateHreflang([{ lang: "", href: "https://e.com" }]);
    expect(find(issues, "Invalid hreflang")?.level).toBe("error");
  });
});

describe("validateHreflang — duplicates", () => {
  it("flags exact duplicate lang values", () => {
    const issues = validateHreflang([
      { lang: "en", href: "https://e.com/en1" },
      { lang: "en", href: "https://e.com/en2" },
      { lang: "x-default", href: "https://e.com/" },
    ]);
    const dup = find(issues, "Duplicate hreflang");
    expect(dup?.level).toBe("error");
    expect(dup?.msg).toContain('"en"');
    expect(dup?.msg).toContain("2×");
  });

  it("reports duplicate count when same value appears 3+ times", () => {
    const issues = validateHreflang([
      { lang: "nl-BE", href: "https://e.com/1" },
      { lang: "nl-BE", href: "https://e.com/2" },
      { lang: "nl-BE", href: "https://e.com/3" },
    ]);
    expect(find(issues, "Duplicate hreflang")?.msg).toContain("3×");
  });

  it("treats distinct case variants as separate entries (does not silently dedupe)", () => {
    const issues = validateHreflang([
      { lang: "en-GB", href: "https://e.com/gb" },
      { lang: "en-US", href: "https://e.com/us" },
    ]);
    expect(find(issues, "Duplicate hreflang")).toBeUndefined();
  });
});

describe("validateHreflang — x-default", () => {
  it("warns when x-default is missing", () => {
    const issues = validateHreflang([
      { lang: "en", href: "https://e.com/en" },
      { lang: "nl", href: "https://e.com/nl" },
    ]);
    expect(find(issues, "x-default")?.level).toBe("warn");
  });

  it("no warning when x-default is present", () => {
    const issues = validateHreflang([
      { lang: "en", href: "https://e.com/en" },
      { lang: "x-default", href: "https://e.com/" },
    ]);
    expect(find(issues, "x-default")).toBeUndefined();
  });
});

describe("validateHreflang — self-reference", () => {
  it("warns when none of the hreflangs points back to currentUrl", () => {
    const issues = validateHreflang(
      [
        { lang: "en", href: "https://example.com/en" },
        { lang: "nl", href: "https://example.com/nl" },
        { lang: "x-default", href: "https://example.com/" },
      ],
      "https://example.com/fr"
    );
    expect(find(issues, "self-referencing")?.level).toBe("warn");
  });

  it("no warning when current URL is included", () => {
    const issues = validateHreflang(
      [
        { lang: "en", href: "https://example.com/en" },
        { lang: "fr", href: "https://example.com/fr" },
        { lang: "x-default", href: "https://example.com/" },
      ],
      "https://example.com/fr"
    );
    expect(find(issues, "self-referencing")).toBeUndefined();
  });

  it("normalizes trailing slashes when matching self-reference", () => {
    const issues = validateHreflang(
      [
        { lang: "en", href: "https://example.com/en/" },
        { lang: "x-default", href: "https://example.com/" },
      ],
      "https://example.com/en"
    );
    expect(find(issues, "self-referencing")).toBeUndefined();
  });

  it("does not emit a self-reference warning when currentUrl is omitted", () => {
    const issues = validateHreflang([
      { lang: "en", href: "https://example.com/en" },
      { lang: "x-default", href: "https://example.com/" },
    ]);
    expect(find(issues, "self-referencing")).toBeUndefined();
  });

  it("resolves relative hrefs against currentUrl for self-reference matching", () => {
    const issues = validateHreflang(
      [
        { lang: "en", href: "/en" },
        { lang: "x-default", href: "/" },
      ],
      "https://example.com/en"
    );
    expect(find(issues, "self-referencing")).toBeUndefined();
  });
});

describe("validateHreflang — protocol mismatch", () => {
  it("warns on mixed http/https", () => {
    const issues = validateHreflang([
      { lang: "en", href: "https://example.com/en" },
      { lang: "nl", href: "http://example.com/nl" },
      { lang: "x-default", href: "https://example.com/" },
    ]);
    expect(find(issues, "Mixed http/https")?.level).toBe("warn");
  });

  it("no warning when all targets use the same protocol", () => {
    const issues = validateHreflang([
      { lang: "en", href: "https://example.com/en" },
      { lang: "nl", href: "https://example.com/nl" },
      { lang: "x-default", href: "https://example.com/" },
    ]);
    expect(find(issues, "Mixed http/https")).toBeUndefined();
  });
});

describe("validateHreflang — relative URLs", () => {
  it("flags relative URLs as errors (Google needs full URLs) and reports the count", () => {
    const issues = validateHreflang(
      [
        { lang: "en", href: "/en" },
        { lang: "nl", href: "/nl" },
        { lang: "fr", href: "https://example.com/fr" },
        { lang: "x-default", href: "/" },
      ],
      "https://example.com/"
    );
    const rel = find(issues, "not fully qualified");
    expect(rel?.level).toBe("error");
    expect(rel?.msg).toContain("3");
  });

  it("flags protocol-relative URLs (//example.com/foo) too", () => {
    const issues = validateHreflang(
      [
        { lang: "en", href: "//example.com/en" },
        { lang: "x-default", href: "//example.com/" },
      ],
      "https://example.com/"
    );
    expect(find(issues, "not fully qualified")?.msg).toContain("2");
  });

  it("does not flag fully-qualified URLs", () => {
    const issues = validateHreflang([
      { lang: "en", href: "https://example.com/en" },
      { lang: "x-default", href: "https://example.com/" },
    ]);
    expect(find(issues, "not fully qualified")).toBeUndefined();
  });
});

describe("validateHreflang — issue shape contract", () => {
  it("every issue has a level and msg field", () => {
    const issues = validateHreflang([
      { lang: "nl_BE", href: "http://example.com/nl" },
      { lang: "nl_BE", href: "/nl-fr" },
    ]);
    issues.forEach((issue) => {
      expect(issue.level).toMatch(/^(error|warn|info)$/);
      expect(typeof issue.msg).toBe("string");
      expect(issue.msg.length).toBeGreaterThan(0);
    });
  });
});
