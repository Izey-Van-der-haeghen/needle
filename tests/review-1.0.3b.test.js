// The second review round of 24 November 2026: copy, code health and the report.
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { displayUrl, fmtKB, inlineImageLabel } from "../lib/popup-helpers.js";
import { readSettingsFile, isWholeNumber, THEMES } from "../lib/settings.js";
import { computeIndexability } from "../lib/popup-compute.js";
import { collectFindings } from "../lib/findings.js";
import { buildHtmlReport } from "../lib/export.js";
import { CONTEXT_NAME } from "../lib/labels.js";

const lists = { locations: [{ code: 2056 }], languages: [{ code: "fr" }] };

describe("displayUrl", () => {
  it("decodes letters but keeps characters that could make an address read as another", () => {
    expect(displayUrl("https://e.be/r%C3%A9gion")).toBe("https://e.be/région");
    expect(displayUrl("https://e.be/a%E2%80%AEgpj.exe")).toBe("https://e.be/a%E2%80%AEgpj.exe");
    expect(displayUrl("https://e.be/a%E2%80%8Bb")).toBe("https://e.be/a%E2%80%8Bb");
    expect(displayUrl("https://e.be/a%0Ab")).toBe("https://e.be/a%0Ab");
  });
});

describe("readSettingsFile", () => {
  it("skips and counts a known setting of the wrong type", () => {
    const r = readSettingsFile({ theme: "dark", imgMaxKB: 200, openInSidePanel: "yes", dfsLogin: 5 }, lists);
    expect(r.prefs).toEqual({ theme: "dark" });
    expect(r.secrets).toEqual({});
    expect(r.skipped).toBe(3);
  });
  it("ignores keys it doesn't know, without counting them", () => {
    expect(readSettingsFile({ somethingElse: 1, theme: "light" }, lists)).toEqual({ prefs: { theme: "light" }, secrets: {}, skipped: 0 });
  });
  it("shares its rules with the Settings form", () => {
    expect(["1", " 99999 ", "250"].every(isWholeNumber)).toBe(true);
    expect(["0", "100000", "1.5", "", "abc", null].some(isWholeNumber)).toBe(false);
    expect(THEMES).toEqual(["auto", "light", "dark"]);
  });
});

describe("addresses in verdicts read as people write them", () => {
  const op = { url: "https://e.be/fr/accueil", canonical: "https://e.be/r%C3%A9gion", robots: "" };
  const tech = { status: 200, headers: {}, robotsTxt: { ok: true, pathAllowed: { allowed: true } } };
  it("in the indexing verdict", () => {
    expect(computeIndexability(op, tech).issues.map((i) => i.msg).join(" ")).toContain("Canonical points elsewhere: https://e.be/région");
  });
  it("in the finding's explanation", () => {
    const f = collectFindings({ onpage: { ...op, title: "T", description: "D", headings: [], links: { details: [] }, images: [], hreflang: [], schema: [] }, tech, imageRules: {} });
    expect(f.find((x) => x.id === "canonical-elsewhere")?.why).toBe("Google is asked to index https://e.be/région instead.");
  });
});

describe("one size format", () => {
  it("writes inline images with thousands separators, as the image list does", () => {
    expect(inlineImageLabel(`data:image/png;base64,${"A".repeat(4 * 1024 * 1400 / 3)}`)).toContain(fmtKB(1400 * 1024));
    expect(fmtKB(1400 * 1024)).toBe("1,400.0 KB");
  });
});

describe("the report in the popup's words", () => {
  const onpage = {
    url: "https://e.be/", title: "T", description: "D", canonical: "https://e.be/", robots: "", lang: "en", viewport: "width=device-width",
    og: {}, twitter: {}, headings: [{ level: 1, text: "H" }],
    links: { total: 3, internal: 3, external: 0, nofollow: 0, broken: 0, byContext: { nav: 2, main: 1, other: 0 } },
    images: [{ src: "https://e.be/big.jpg", alt: "a", displayedWidth: 800, displayedHeight: 600, context: "main", bytes: 1400 * 1024, naturalWidth: 1600, naturalHeight: 1200 }],
    schema: [], hreflang: [], wordCount: 10, mainContentWordCount: 8, textRatio: 20, externalLinkCount: 0, listCount: 0, tableCount: 0
  };
  const technical = { status: 200, finalUrl: "https://e.be/r%C3%A9gion", headers: {}, robotsTxt: { ok: false, status: 404 }, sitemap: null };
  const doc = new JSDOM(buildHtmlReport({ url: onpage.url, onpage, technical, geo: null, health: null, verdict: null, theme: "light", version: "0.0.0", offpage: null })).window.document;
  const text = doc.body.textContent;

  it("calls a robots.txt that answers 404 'none (everything allowed)', not a warning", () => {
    expect(text).toContain("none (everything allowed)");
    expect(text).not.toContain("HTTP 404");
  });
  it("names link regions as the popup does", () => {
    expect(text).toContain(`In the ${CONTEXT_NAME.nav}`);
    expect(text).toContain(`In the ${CONTEXT_NAME.main}`);
    expect(text).not.toMatch(/\bIn (nav|main)\b/);
  });
  it("shows the final address with its letters, and sizes with thousands separators", () => {
    expect(text).toContain("https://e.be/région");
    expect(text).toContain("1,400.0 KB");
  });
});

describe("explanations show addresses as people read them (steps 3-7, P2-8)", () => {
  const op = { url: "https://e.be/fr/accueil", canonical: "https://e.be/fr/accueil", robots: "", title: "T", description: "D", headings: [], links: { details: [] }, images: [], hreflang: [], schema: [] };
  const tech = { status: 200, redirected: true, finalUrl: "https://e.be/fr/r%C3%A9gion", headers: {}, robotsTxt: { ok: true, pathAllowed: { allowed: true } } };
  it("in the redirect verdict and its finding", () => {
    expect(computeIndexability(op, tech).issues.map((i) => i.msg).join(" ")).toContain("redirects to https://e.be/fr/région");
    expect(collectFindings({ onpage: op, tech, imageRules: {} }).find((f) => f.id === "redirect")?.why).toBe("It ends on https://e.be/fr/région; Google indexes that one.");
  });
  it("in the served-against-rendered canonical finding", () => {
    const raw = { canonical: "https://e.be/fr/r%C3%A9gion" };
    const f = collectFindings({ onpage: op, tech: { status: 200, headers: {}, robotsTxt: { ok: true, pathAllowed: { allowed: true } }, raw }, imageRules: {} });
    expect(f.find((x) => x.id === "canonical-js")?.why).toContain("The server HTML names https://e.be/fr/région;");
  });
});

describe("after the P3 round", () => {
  it("calls weak trust signals what they are: 'missing or weak', since 1 or 2 citations count as too few", () => {
    const eeat = [{ ok: false }, { ok: false }, { ok: false, failText: "too few" }];
    const f = collectFindings({ onpage: { url: "https://e.be/", title: "T", description: "D", headings: [], links: { details: [] }, images: [], hreflang: [], schema: [] }, geo: { eeat }, imageRules: {} });
    expect(f.find((x) => x.id === "eeat")?.title).toBe("3 trust signals missing or weak");
  });
});

describe("the report's HTML", () => {
  it("has no lines of only spaces (html-validate no-trailing-whitespace)", () => {
    const html = buildHtmlReport({ url: "https://e.be/", onpage: { url: "https://e.be/", title: "T", headings: [], links: {}, images: [], schema: [], hreflang: [], og: {}, twitter: {} }, technical: null, geo: null, health: null, verdict: null, theme: "light", version: "0", offpage: null });
    expect(html.split("\n").filter((l) => /^[ \t]+$/.test(l))).toEqual([]);
  });
});

describe("the report's JSON-LD blocks", () => {
  it("are named regions keyboard users can reach, since they scroll", () => {
    const html = buildHtmlReport({ url: "https://e.be/", onpage: { url: "https://e.be/", title: "T", headings: [], links: {}, images: [], hreflang: [], og: {}, twitter: {}, schema: [{ type: "Organization", raw: {} }, { type: "WebSite", raw: {} }] }, technical: null, geo: null, health: null, verdict: null, theme: "light", version: "0", offpage: null });
    const pres = [...new JSDOM(html).window.document.querySelectorAll("#schema pre")];
    expect(pres.map((p) => [p.getAttribute("tabindex"), p.getAttribute("role"), p.getAttribute("aria-label")])).toEqual([["0", "region", "JSON-LD #1: Organization"], ["0", "region", "JSON-LD #2: WebSite"]]);
  });
});
