// Image checks from the rules and edge-case reviews of 1.0.2 (22 November 2026).
import { describe, it, expect } from "vitest";
import { loadContentScript, html } from "./helpers/content-harness.js";
import { collectFindings } from "../lib/findings.js";
import { isArticleLike, imagePreviewSetting, discoverCheck, isSvgSource, isContentImage, normaliseImageRules } from "../lib/image-rules.js";
import { hasUncleanFilename } from "../lib/popup-helpers.js";

const BASE = "https://www.example.be";

// jsdom never loads images. Each <img> says what Chrome would report through data-* attributes:
// data-nw / data-nh = naturalWidth/Height (density-corrected, as Chrome gives them),
// data-cur = currentSrc, data-complete="false" = still loading.
const stubImages = (dpr) => (w) => {
  w.devicePixelRatio = dpr;
  const P = w.HTMLImageElement.prototype;
  Object.defineProperty(P, "naturalWidth", { get() { return Number(this.dataset.nw || 0); } });
  Object.defineProperty(P, "naturalHeight", { get() { return Number(this.dataset.nh || 0); } });
  Object.defineProperty(P, "complete", { get() { return this.dataset.complete !== "false"; } });
  Object.defineProperty(P, "currentSrc", { get() { return this.dataset.cur || ""; } });
};

async function analyzeImages(body, { dpr = 1, head = "", ...options } = {}) {
  const page = await loadContentScript(html(body, head), { url: `${BASE}/nl-be/page/`, setup: stubImages(dpr), ...options });
  try { return await page.send({ type: "ANALYZE_ONPAGE" }); } finally { page.window.close(); }
}
const rect = (w, h, y = 100) => `data-test-rect="0,${y},${w},${h}"`;

describe("blurry images: the loaded file's real width, not the density-corrected naturalWidth", () => {
  it("a 500 px file in an 800 px box is blurry when sizes is omitted (100vw)", async () => {
    // No sizes on a 1366 px viewport: the browser takes 500w and reports naturalWidth 1366.
    const d = await analyzeImages(`<img src="/s-300.jpg" srcset="/s-300.jpg 300w, /s-500.jpg 500w" alt="s" width="800" height="500" ${rect(800, 500)} data-cur="${BASE}/s-500.jpg" data-nw="1366" data-nh="854">`);
    expect(d.images[0]).toMatchObject({ naturalWidth: 500, upscaled: true });
  });

  it("an 800w file stretched to 1200 px is blurry, also when sizes matches the box", async () => {
    // sizes="1200px" and the largest file is 800w: Chrome reports naturalWidth 1200 (800 / (800/1200)).
    const d = await analyzeImages(`<img src="/t-800.jpg" srcset="/t-400.jpg 400w, /t-800.jpg 800w" sizes="1200px" alt="t" width="1200" height="600" ${rect(1200, 600)} data-cur="${BASE}/t-800.jpg" data-nw="1200" data-nh="600">`);
    expect(d.images[0]).toMatchObject({ naturalWidth: 800, upscaled: true });
  });

  it("a 2x file chosen for a 2x screen is not blurry, and neither is a file as wide as its box", async () => {
    const twoX = await analyzeImages(`<img src="/b.jpg" srcset="/b.jpg 1x, /b@2x.jpg 2x" alt="b" width="300" height="200" ${rect(300, 200)} data-cur="${BASE}/b@2x.jpg" data-nw="300" data-nh="200">`, { dpr: 2 });
    expect(twoX.images[0]).toMatchObject({ naturalWidth: 600, upscaled: false });
    const plain = await analyzeImages(`<img src="/f.jpg" alt="f" width="600" height="400" ${rect(600, 400)} data-nw="600" data-nh="400">`);
    expect(plain.images[0].upscaled).toBe(false);
  });
});

describe("art direction: only the srcset the browser picked from counts as smaller sizes", () => {
  const picture = (sourceSet, current) => `<picture><source media="(max-width: 600px)" srcset="${sourceSet}">` +
    `<img src="/d-1280.jpg" srcset="/d-320.jpg 320w, /d-1280.jpg 1280w" sizes="300px" alt="d" width="300" height="200" ${rect(300, 200)} data-cur="${BASE}/${current}" data-nw="300" data-nh="200"></picture>`;
  const phone = { viewport: { width: 375, height: 667 }, media: { "(max-width: 600px)": true } };

  it("on a phone, the img's own desktop srcset is not a smaller version of the mobile crop", async () => {
    // The mobile crop exists only at 640w; the 320w file belongs to the desktop crop.
    const d = await analyzeImages(picture("/m-640.jpg 640w", "m-640.jpg"), phone);
    expect(d.images[0]).toMatchObject({ naturalWidth: 640, downscaled: false });
  });

  it("on a desktop, a <source> for phones doesn't count either", async () => {
    const d = await analyzeImages(`<picture><source media="(max-width: 600px)" srcset="/m-320.jpg 320w"><img src="/d-640.jpg" srcset="/d-640.jpg 640w, /d-1280.jpg 1280w" sizes="300px" alt="d" width="300" height="200" ${rect(300, 200)} data-cur="${BASE}/d-640.jpg" data-nw="300" data-nh="200"></picture>`);
    expect(d.images[0]).toMatchObject({ naturalWidth: 640, downscaled: false });
  });

  it("still flags a file much larger than shown when the picked srcset has a smaller one that would do", async () => {
    const d = await analyzeImages(picture("/m-320.jpg 320w, /m-1280.jpg 1280w", "m-1280.jpg"), phone);
    expect(d.images[0]).toMatchObject({ naturalWidth: 1280, downscaled: true });
  });
});

describe("lazy images that have loaded: the file shown is the image", () => {
  const gif = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

  it("lazysizes keeps data-srcset after load: src and the file size are the loaded file's", async () => {
    const d = await analyzeImages(`<img class="lazyloaded" src="${gif}" data-srcset="/l-320.jpg 320w, /l-1600.jpg 1600w" srcset="/l-320.jpg 320w, /l-1600.jpg 1600w" sizes="800px" alt="l" width="800" height="500" ${rect(800, 500)} data-cur="${BASE}/l-1600.jpg" data-nw="800" data-nh="500">`,
      { dpr: 2, resourceEntries: [{ name: `${BASE}/l-1600.jpg`, initiatorType: "img", encodedBodySize: 180000 }] });
    expect(d.images[0]).toMatchObject({ src: `${BASE}/l-1600.jpg`, bytes: 180000, naturalWidth: 1600, loaded: true });
  });

  it("WP Rocket keeps data-lazy-src (the full original) after load: src is the srcset file shown", async () => {
    const d = await analyzeImages(`<img src="/full.jpg" data-lazy-src="/full.jpg" srcset="/full-768.jpg 768w, /full.jpg 1600w" sizes="768px" alt="w" width="768" height="512" ${rect(768, 512)} data-cur="${BASE}/full-768.jpg" data-nw="768" data-nh="512">`);
    expect(d.images[0]).toMatchObject({ src: `${BASE}/full-768.jpg`, naturalWidth: 768 });
  });

  it("while a placeholder is shown, the data-src URL is still the image", async () => {
    const d = await analyzeImages(`<img class="lazyload" src="${gif}" data-src="/photo.jpg" alt="p" width="600" height="400" ${rect(600, 400)} data-cur="${gif}" data-nw="1" data-nh="1">`);
    expect(d.images[0]).toMatchObject({ src: `${BASE}/photo.jpg`, loaded: false, upscaled: false });
  });
});

describe("SVG without .svg in its URL", () => {
  it("is not judged on pixels, and doesn't count as a content photo", async () => {
    const d = await analyzeImages(`<img src="/logo?format=svg" alt="logo" width="600" height="300" ${rect(600, 300)} data-nw="150" data-nh="75">` +
      `<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" alt="mark" width="600" height="300" ${rect(600, 300)} data-nw="150" data-nh="75">`);
    expect(d.images.map((i) => [i.format, i.upscaled, i.downscaled])).toEqual([["svg", false, false], ["svg", false, false]]);
    expect(d.images.filter(isContentImage)).toEqual([]);
  });

  it("knows a vector URL from a PNG rendition of one", () => {
    expect(isSvgSource("https://cdn.example.com/logo?format=svg")).toBe(true);
    expect(isSvgSource("https://cdn.example.com/img/logo.SVG?v=3")).toBe(true);
    expect(isSvgSource("https://upload.example.org/thumb/a/ab/Logo.svg/200px-Logo.svg.png")).toBe(false);
    expect(isSvgSource("https://cdn.svg.example/photo.jpg")).toBe(false);
    // A result saved before format knew these URLs still leaves them out of the photos.
    expect(isContentImage({ src: "https://cdn.example.com/logo?fm=svg", format: "unknown", context: "main", displayedWidth: 600, displayedHeight: 300 })).toBe(false);
  });
});

describe("width and height reserved in CSS", () => {
  it("an aspect-ratio or an inline width and height reserve space; width alone or height:auto doesn't", async () => {
    const d = await analyzeImages(
      `<img class="ratio" src="/a.jpg" alt="a" ${rect(400, 225)}>` +
      `<img style="aspect-ratio: 4 / 3; width: 100%" src="/b.jpg" alt="b" ${rect(400, 300)}>` +
      `<img style="width: 400px; height: 300px" src="/c.jpg" alt="c" ${rect(400, 300)}>` +
      `<img style="width: 100%; height: auto" src="/d.jpg" alt="d" ${rect(400, 300)}>` +
      `<img width="400" src="/e.jpg" alt="e" ${rect(400, 300)}>` +
      `<img src="/f.jpg" alt="f" ${rect(400, 300)}>`,
      { head: "<style>.ratio { aspect-ratio: 16 / 9; width: 100%; }</style>" });
    expect(d.images.map((i) => i.missingDims)).toEqual([false, false, false, true, true, true]);
  });
});

describe("file size over the limit", () => {
  const heavy = { src: "https://e.com/hero-fiets.jpg", alt: "a", context: "main", displayedWidth: 800, displayedHeight: 500, bytes: 250 * 1024 };
  it("is low: Google sets no file-size target, the limit is the team's own", () => {
    const f = collectFindings({ onpage: { url: "https://e.com/", canonical: "https://e.com/", images: [heavy] } });
    expect(f.find((x) => x.id === "img-heavy")).toMatchObject({ severity: "low", title: "1 image over 100 KB" });
  });
  it("still follows the limit set in Settings", () => {
    const f = collectFindings({ onpage: { url: "https://e.com/", canonical: "https://e.com/", images: [heavy] }, imageRules: normaliseImageRules({ imgMaxKB: "300" }) });
    expect(f.some((x) => x.id === "img-heavy")).toBe(false);
  });
});

describe("camera file names", () => {
  it.each([
    ["IMG_20231105_123456.jpg", true], ["PXL_20231105_123456789.jpg", true], ["PXL_20231105_123456789.MP.jpg", true],
    ["IMG-20231105-WA0001.jpg", true], ["IMG_20231105_123456_HDR.jpg", true], ["DSCF1234.JPG", true], ["DJI_0001.jpg", true],
    ["GOPR1234.jpg", true], ["IMG_4512~2.jpg", true],
    ["fiets-herstel-gent.jpg", false], ["iphone-15.jpg", false], ["img-2-bike-repair.jpg", false], ["image-2-bike-repair-steps.png", false]
  ])("%s unclear: %s", (name, unclear) => {
    expect(hasUncleanFilename(`https://a.com/${name}`)).toBe(unclear);
  });
});

describe("Discover: articles only, and large previews allowed", () => {
  const wide = { src: "https://e.com/hero.jpg", alt: "a", context: "main", naturalWidth: 1600, naturalHeight: 900, displayedWidth: 800, displayedHeight: 450, aboveFold: true, domIndex: 0 };
  const narrow = { ...wide, naturalWidth: 600, naturalHeight: 400, displayedWidth: 600, displayedHeight: 400 };
  const article = { "@context": "https://schema.org", "@type": "BlogPosting", headline: "x" };
  const page = (over = {}) => ({ url: "https://e.com/blog/x/", canonical: "https://e.com/blog/x/", images: [wide], schema: [{ type: "BlogPosting", raw: article }], robots: "", og: {}, ...over });
  const lead = (input) => collectFindings(input).find((f) => f.id === "img-lead");

  it("knows an article by its schema type, a WebPage's mainEntity or og:type", () => {
    expect(isArticleLike({ og: { type: " Article " } })).toBe(true);
    expect(isArticleLike({ schema: [{ type: "NewsArticle", raw: {} }] })).toBe(true);
    expect(isArticleLike({ schema: [{ type: "https://schema.org/TechArticle", raw: {} }] })).toBe(true);
    expect(isArticleLike({ schema: [{ type: "WebPage", raw: { "@type": "WebPage", mainEntity: { "@type": "Article" } } }] })).toBe(true);
    expect(isArticleLike({ og: { type: "website" }, schema: [{ type: "ContactPage", raw: {} }, { type: "Organization", raw: {} }] })).toBe(false);
    // Microdata lists every card on a blog index, so it doesn't make the page an article.
    expect(isArticleLike({ og: { type: "website" }, schema: [], microdataTypes: ["BlogPosting"] })).toBe(false);
  });

  it("skips pages that aren't articles: a contact page's 600 px photo is no Discover problem", () => {
    const contact = page({ images: [narrow], schema: [{ type: "ContactPage", raw: {} }], og: { type: "website" } });
    expect(lead({ onpage: contact })).toBeUndefined();
    expect(discoverCheck([narrow], contact)).toBeNull();
  });

  it("on an article, a narrow main image is flagged, and the fix names max-image-preview when it's missing", () => {
    const f = lead({ onpage: page({ images: [narrow] }) });
    expect(f).toMatchObject({ severity: "low", title: "Main image is only 600 px wide" });
    expect(f.fix).toMatch(/max-image-preview:large/);
    expect(lead({ onpage: page({ images: [narrow], robots: "max-image-preview:large" }) }).fix).toBe("Use a main image of at least 1200 px wide.");
  });

  it("a wide image without max-image-preview:large is flagged", () => {
    expect(lead({ onpage: page() })).toMatchObject({ severity: "low", title: "Large image previews aren't turned on", why: expect.stringMatching(/doesn't set it/) });
    expect(lead({ onpage: page({ robots: "index, follow, max-image-preview:standard" }) }).why).toMatch(/sets max-image-preview:standard/);
  });

  it("passes with max-image-preview:large in the meta tag or the header, or with AMP", () => {
    expect(lead({ onpage: page({ robots: "index, follow, max-image-preview:large" }) })).toBeUndefined();
    expect(lead({ onpage: page(), tech: { status: 200, headers: { "x-robots-tag": "max-image-preview:large" } } })).toBeUndefined();
    expect(lead({ onpage: page({ amp: true }) })).toBeUndefined();
  });

  it("reads max-image-preview the way Google does: its own rules only, the most restrictive wins", () => {
    expect(imagePreviewSetting("max-image-preview : large", "")).toBe("large");
    expect(imagePreviewSetting("max-image-preview:large", "bingbot: max-image-preview:none")).toBe("large");
    expect(imagePreviewSetting("max-image-preview:large", "googlebot: max-image-preview:standard")).toBe("standard");
    // An agent prefix holds across commas until the next one.
    expect(imagePreviewSetting("", "otherbot: noindex, max-image-preview:none")).toBe("");
    expect(imagePreviewSetting("", "")).toBe("");
  });

  it("content.js tells an AMP page, or one with an AMP version, from a plain one", async () => {
    const withAmp = await analyzeImages("<p>x</p>", { head: '<link rel="amphtml" href="/blog/x/amp/">' });
    const plain = await analyzeImages("<p>x</p>");
    expect([withAmp.amp, plain.amp]).toEqual([true, false]);
  });
});
