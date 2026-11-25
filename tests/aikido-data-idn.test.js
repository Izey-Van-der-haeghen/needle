// Aikido round of 25 November 2026, finding 8: lib/idn.js reads raw page addresses (hreflang hrefs,
// og:url), so every label it decodes must be capped at 63 characters, and a leading "-" is no
// delimiter (RFC 3492, section 6.2).
import { describe, it, expect } from "vitest";
import { readableLabel, readableHost } from "../lib/idn.js";
import { displayUrl } from "../lib/popup-helpers.js";

describe("a top-level domain longer than a DNS label", () => {
  const longTld = `xn--${"a".repeat(200000)}-`;

  it("is shown as it is, not decoded (it used to throw a RangeError)", () => {
    expect(readableHost(`a.${longTld}`)).toBe(`a.${longTld}`);
    expect(readableHost(`a.${longTld}:8080`)).toBe(`a.${longTld}:8080`);
  });

  it("leaves a page's hreflang href readable, so the On-page tab still renders", () => {
    const href = `https://a.${longTld}/`;
    expect(displayUrl(href)).toBe(href);
    expect(displayUrl(`//a.${longTld}/`)).toBe(`//a.${longTld}/`);
  });

  it("still reads a Cyrillic top-level domain of normal length", () => {
    expect(readableHost("xn--e1afmkfd.xn--p1ai")).toBe("пример.рф");
    expect(readableHost("xn--bcher-kva.example")).toBe("bücher.example");
  });
});

describe("a label that starts with the delimiter", () => {
  it("is not valid punycode, so it stays as it is", () => {
    expect(readableLabel("xn---e1afmkfd")).toBe("xn---e1afmkfd");
    expect(readableLabel("xn---e1afmkfd", true)).toBe("xn---e1afmkfd");
  });

  it("no longer reads like the real address", () => {
    expect(readableHost("xn---e1afmkfd.xn--p1ai")).toBe("xn---e1afmkfd.рф");
    expect(readableHost("xn---e1afmkfd.xn--p1ai")).not.toBe(readableHost("xn--e1afmkfd.xn--p1ai"));
  });

  it("does not change a label with basic letters before the delimiter", () => {
    expect(readableLabel("xn--bcher-kva")).toBe("bücher");
    expect(readableLabel("xn--mnchen-3ya")).toBe("münchen");
  });
});
