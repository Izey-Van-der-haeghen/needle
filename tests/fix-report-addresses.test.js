// The report shows addresses as people read them, as the popup does (full check of 25 November 2026, P2-8):
// the image list, the hreflang table, og:url, og:image and twitter:image. Links, image sources and
// the examples under "Fix this first" keep the raw address.
import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { buildHtmlReport } from "../lib/export.js";
import { collectFindings } from "../lib/findings.js";

const photo = "https://e.be/img/%C3%A9%C3%A9n-foto.jpg";
const inline = `data:image/png;base64,${"A".repeat(400)}`;
const onpage = {
  url: "https://e.be/fr/", title: "T", description: "D", canonical: "https://e.be/fr/", robots: "", lang: "fr", viewport: "width=device-width",
  og: { url: "https://e.be/fr/r%C3%A9gion", image: "https://e.be/img/%C3%A9t%C3%A9.jpg" },
  twitter: { image: "https://e.be/img/hiver-%C3%A9t%C3%A9.jpg" },
  headings: [{ level: 1, text: "H" }],
  links: { total: 0, internal: 0, external: 0, nofollow: 0, broken: 0, details: [] },
  images: [
    { src: photo, alt: "", altMissing: true, displayedWidth: 800, displayedHeight: 600, context: "main", naturalWidth: 1600, naturalHeight: 1200, bytes: 90000 },
    { src: inline, alt: "a", displayedWidth: 800, displayedHeight: 600, context: "main", naturalWidth: 1600, naturalHeight: 1200 }
  ],
  schema: [],
  hreflang: [{ lang: "fr-BE", href: "https://e.be/fr/r%C3%A9gion" }, { lang: "nl-BE", href: "https://e.be/nl/regio" }],
  wordCount: 400, mainContentWordCount: 300, textRatio: 20
};
const findings = collectFindings({ onpage, tech: null, imageRules: null });
const doc = new JSDOM(buildHtmlReport({ url: onpage.url, onpage, technical: null, offpage: null, geo: null, health: null, verdict: null, theme: "light", findings })).window.document;

/** The value cell of a label row in the report's tables. */
const cell = (label) => [...doc.querySelectorAll("tbody th")].find((th) => th.textContent === label)?.nextElementSibling;

describe("the report shows addresses with their letters", () => {
  it("in the image list, with an inline image still named by its type and size", () => {
    const names = [...doc.querySelectorAll("#images .img-row span.code")].map((s) => s.textContent);
    expect(names[0]).toBe("https://e.be/img/één-foto.jpg");
    expect(names[1]).toMatch(/^Inline image \(PNG, /);
    // The image itself still loads from the raw address.
    expect(doc.querySelector("#images .img-row img").getAttribute("src")).toBe(photo);
  });

  it("in the hreflang table", () => {
    const urls = [...doc.querySelectorAll("#hreflang tbody td.code")].map((td) => td.textContent);
    expect(urls).toEqual(["https://e.be/fr/région", "https://e.be/nl/regio"]);
  });

  it("in og:url, og:image and twitter:image", () => {
    expect(cell("og:url").textContent).toBe("https://e.be/fr/région");
    expect(cell("og:image").textContent).toBe("https://e.be/img/été.jpg");
    expect(cell("twitter:image").textContent).toBe("https://e.be/img/hiver-été.jpg");
    // The card's picture still loads from the raw address.
    expect(doc.querySelector("#social .card img").getAttribute("src")).toBe("https://e.be/img/%C3%A9t%C3%A9.jpg");
  });
});

describe("the examples under Fix this first keep the raw address", () => {
  it("in the finding and in the report", () => {
    const altFinding = findings.find((f) => f.id === "img-alt");
    expect(altFinding.examples).toEqual([photo]);
    const examples = [...doc.querySelectorAll("#fix-first ul.code li")].map((li) => li.textContent);
    expect(examples).toContain(photo);
    expect(examples).not.toContain("https://e.be/img/één-foto.jpg");
  });
});
