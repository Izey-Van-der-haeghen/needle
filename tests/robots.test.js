import { describe, it, expect } from "vitest";
import { isAllowedByRobots } from "../lib/robots.js";

describe("isAllowedByRobots", () => {
  it("allows everything when robots.txt is empty", () => {
    const r = isAllowedByRobots("", "/foo");
    expect(r.allowed).toBe(true);
  });

  it("allows everything when no groups match", () => {
    const txt = `User-agent: Googlebot\nDisallow: /\n`;
    const r = isAllowedByRobots(txt, "/foo", "*");
    expect(r.allowed).toBe(true);
  });

  it("respects User-agent: * default", () => {
    const txt = `User-agent: *\nDisallow: /private/\n`;
    expect(isAllowedByRobots(txt, "/private/foo").allowed).toBe(false);
    expect(isAllowedByRobots(txt, "/public").allowed).toBe(true);
  });

  it("specific UA wins over wildcard", () => {
    const txt = `User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /\n`;
    expect(isAllowedByRobots(txt, "/foo", "GPTBot").allowed).toBe(true);
    expect(isAllowedByRobots(txt, "/foo", "*").allowed).toBe(false);
  });

  it("longest-match wins: Allow beats shorter Disallow", () => {
    const txt = `User-agent: *\nDisallow: /admin/\nAllow: /admin/public/\n`;
    expect(isAllowedByRobots(txt, "/admin/secret").allowed).toBe(false);
    expect(isAllowedByRobots(txt, "/admin/public/page").allowed).toBe(true);
  });

  it("$ end-of-URL anchor", () => {
    const txt = `User-agent: *\nDisallow: /*.pdf$\n`;
    expect(isAllowedByRobots(txt, "/file.pdf").allowed).toBe(false);
    expect(isAllowedByRobots(txt, "/file.pdf?utm=x").allowed).toBe(true);
  });

  it("wildcard * in middle of path", () => {
    const txt = `User-agent: *\nDisallow: /private/*/secret\n`;
    expect(isAllowedByRobots(txt, "/private/abc/secret").allowed).toBe(false);
    expect(isAllowedByRobots(txt, "/private/abc/public").allowed).toBe(true);
  });

  it("comments are ignored", () => {
    const txt = `# comment\nUser-agent: *  # inline\nDisallow: /x  # inline\n`;
    expect(isAllowedByRobots(txt, "/x/y").allowed).toBe(false);
  });

  it("UA matching is case-insensitive", () => {
    const txt = `User-agent: gptbot\nDisallow: /\n`;
    expect(isAllowedByRobots(txt, "/foo", "GPTBot").allowed).toBe(false);
  });
});

describe("isAllowedByRobots — RFC 9309 details", () => {
  it("reads ? literally: Disallow: /*? blocks URLs with a query string only", () => {
    const txt = "User-agent: *\nDisallow: /*?\n";
    expect(isAllowedByRobots(txt, "/page").allowed).toBe(true);
    expect(isAllowedByRobots(txt, "/page?sort=asc").allowed).toBe(false);
  });

  it("merges groups for the same user agent", () => {
    const txt = "User-agent: *\nDisallow: /a/\n\nUser-agent: *\nDisallow: /b/\n";
    expect(isAllowedByRobots(txt, "/a/x").allowed).toBe(false);
    expect(isAllowedByRobots(txt, "/b/x").allowed).toBe(false);
  });

  it("uses the Googlebot group for Googlebot, not *", () => {
    const txt = "User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /\n";
    expect(isAllowedByRobots(txt, "/page", "googlebot").allowed).toBe(true);
  });

  it("lets Allow win a tie of equal length", () => {
    const txt = "User-agent: *\nDisallow: /page\nAllow: /page\n";
    expect(isAllowedByRobots(txt, "/page").allowed).toBe(true);
  });

  it("matches wildcards in linear time, so a hostile rule can't freeze the extension", () => {
    const rule = "/" + "*a".repeat(30) + "b";
    const txt = `User-agent: *\nDisallow: ${rule}\n`;
    const t0 = performance.now();
    isAllowedByRobots(txt, "/" + "a".repeat(5000));
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe("percent-encoding (RFC 9309 2.2.2)", () => {
  it("matches a rule with non-ASCII characters against the encoded path, and the other way round", () => {
    expect(isAllowedByRobots("User-agent: *\nDisallow: /café", "/caf%C3%A9").allowed).toBe(false);
    expect(isAllowedByRobots("User-agent: *\nDisallow: /caf%c3%a9", "/caf%C3%A9").allowed).toBe(false);
    expect(isAllowedByRobots("User-agent: *\nDisallow: /%7Euser", "/~user/page").allowed).toBe(false);
  });

  it("keeps reserved characters encoded, so /a%2Fb is not /a/b", () => {
    expect(isAllowedByRobots("User-agent: *\nDisallow: /a/b", "/a%2Fb").allowed).toBe(true);
  });

  it("reports the rule as written in robots.txt", () => {
    expect(isAllowedByRobots("User-agent: *\nDisallow: /café", "/caf%C3%A9").rule).toBe("Disallow: /café");
  });
});
