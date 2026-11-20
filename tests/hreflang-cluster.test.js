import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { checkHreflangCluster } from "../lib/hreflang-cluster.js";

const parse = (html) => new JSDOM(html).window.document;
const pages = {
  "https://e.com/fr": { status: 200, html: '<link rel="canonical" href="https://e.com/fr"><link rel="alternate" hreflang="en" href="https://e.com/en"><link rel="alternate" hreflang="fr" href="https://e.com/fr">' },
  "https://e.com/de": { status: 200, html: '<meta name="robots" content="noindex"><link rel="canonical" href="https://e.com/">' },
  "https://e.com/nl": { status: 301, url: "https://e.com/nl/", html: "" }
};
const load = async (url) => ({ url: pages[url]?.url || url, ...pages[url] });

describe("checkHreflangCluster", () => {
  it("checks status, canonical, noindex and return links of each alternate", async () => {
    const rows = await checkHreflangCluster("https://e.com/en#x", [
      { lang: "en", href: "https://e.com/en" }, { lang: "fr", href: "https://e.com/fr" },
      { lang: "de", href: "https://e.com/de" }, { lang: "nl", href: "https://e.com/nl" }
    ], load, parse);
    const by = Object.fromEntries(rows.map((r) => [r.lang, r]));
    expect(Object.keys(by)).toEqual(["fr", "de", "nl"]);
    expect(by.fr).toMatchObject({ selfCanonical: true, returnLink: true, problems: [] });
    expect(by.de.problems).toEqual(["canonical points elsewhere", "noindex", "no hreflang link back to this page"]);
    expect(by.nl.problems[0]).toBe("answers HTTP 301");
  });
});
