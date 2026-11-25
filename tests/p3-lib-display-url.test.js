// Full check of 25 November 2026, P3-18 and P3-19: displayUrl shows a punycode host readable,
// and keeps %20 and %25 escaped, as Chrome's address bar does.
import { describe, it, expect } from "vitest";
import { displayUrl } from "../lib/popup-helpers.js";

describe("displayUrl and punycode hosts (P3-18)", () => {
  it("shows a host in one script readable", () => {
    expect(displayUrl("https://xn--fietsenhrstel-brssel-i2b04b.example/r%C3%A9parations/"))
      .toBe("https://fietsenhérstel-brüssel.example/réparations/");
    expect(displayUrl("https://www.xn--bcher-kva.example:8080/a?b=1#c")).toBe("https://www.bücher.example:8080/a?b=1#c");
    expect(displayUrl("https://user:pw@XN--BCHER-KVA.example/")).toBe("https://user:pw@bücher.example/");
    expect(displayUrl("//xn--bcher-kva.example/p")).toBe("//bücher.example/p");
  });

  it("keeps a host that could read as another one", () => {
    expect(displayUrl("https://xn--80ak6aa92e.com/login")).toBe("https://xn--80ak6aa92e.com/login");
    expect(displayUrl("https://xn--pple-43d.com/")).toBe("https://xn--pple-43d.com/");
    expect(displayUrl("https://xn--psd.example/")).toBe("https://xn--psd.example/");
  });

  it("decodes only the host, not punycode in the path or the query", () => {
    expect(displayUrl("https://e.example/xn--bcher-kva?q=xn--bcher-kva")).toBe("https://e.example/xn--bcher-kva?q=xn--bcher-kva");
    expect(displayUrl("xn--bcher-kva.example/p")).toBe("xn--bcher-kva.example/p");
  });
});

describe("displayUrl and escapes that would change how an address reads (P3-19)", () => {
  it("keeps %20 escaped, and shows a raw space escaped", () => {
    expect(displayUrl("https://e.be/%C3%A9%C3%A9n-fiets%20herstel/")).toBe("https://e.be/één-fiets%20herstel/");
    expect(displayUrl("https://e.be/a b")).toBe("https://e.be/a%20b");
    expect(displayUrl("https://e.be/a%C2%A0b")).toBe("https://e.be/a%C2%A0b");
  });

  it("keeps %25 escaped, so it never reads as the start of another escape", () => {
    expect(displayUrl("https://e.be/100%25")).toBe("https://e.be/100%25");
    expect(displayUrl("https://e.be/%2541")).toBe("https://e.be/%2541");
    expect(displayUrl("https://e.be/r%C3%A9gion%25%C3%A9")).toBe("https://e.be/région%25é");
  });

  it("still leaves an escape that isn't UTF-8 as written", () => {
    expect(displayUrl("https://e.be/%E9%25r%C3%A9")).toBe("https://e.be/%E9%25ré");
  });
});
