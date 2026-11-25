// @vitest-environment jsdom
// The downloaded HTML report, Aikido follow-up:
// - it drew every page-chosen image (content images, og:image, twitter:image) without the local-address
//   check the popup has, so opening a report of a public page could send a GET, with cookies, to a router
//   or NAS on the reader's network. It follows the popup's rule now (mayLoadPageImage), sends no Referer,
//   and loads no address that is neither a web address nor an inline image (file://server/ on Windows);
// - a Googlebot verdict that ran out of time ({allowed: null}) read as "blocked"; it says "not checked".
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildHtmlReport, LOCAL_NOT_LOADED, LOCAL_NO_THUMB } from "../lib/export.js";

const FX = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../dev/preview/fixtures/riverside.json"), "utf8"));
const hero = FX.onpage.images.find((i) => i.context === "main");
const ROUTER = "http://192.168.1.1/cgi-bin/reboot?now=1";
const NAS = "http://localhost:5000/api/delete?all=1";
const SHARE = "file://files.example/share/a.png";
const INLINE = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
const PUBLIC_IMG = hero.src;
const onpage = {
  ...FX.onpage,
  og: { ...FX.onpage.og, image: ROUTER },
  twitter: { ...FX.onpage.twitter, image: NAS },
  images: [hero, { ...hero, domIndex: 10, src: `${ROUTER}&img=1` }, { ...hero, domIndex: 11, src: SHARE }, { ...hero, domIndex: 12, src: INLINE }]
};
const report = (url, over = {}) => new DOMParser().parseFromString(buildHtmlReport({ url, onpage, technical: null, offpage: null, geo: null, health: null, verdict: null, theme: "light", ...over }), "text/html");
const srcs = (doc) => [...doc.querySelectorAll("img")].map((i) => i.getAttribute("src"));
const rowOf = (doc, label) => [...doc.querySelectorAll("#images .img-row")].find((r) => r.querySelector(".code").textContent === label);

it("draws no page-chosen image on the reader's network from a public page, and sends no Referer", () => {
  const doc = report(FX.url);
  // The public and the inline image load; the router, the NAS and the file share don't.
  expect(srcs(doc).sort()).toEqual([INLINE, PUBLIC_IMG].sort());
  // Every image the report loads sends no Referer.
  expect([...doc.querySelectorAll("img")].filter((i) => i.getAttribute("referrerpolicy") !== "no-referrer").map((i) => i.outerHTML)).toEqual([]);
  // The local content image's row says why, in the popup's words; the file share's row only has no picture.
  const local = rowOf(doc, `${ROUTER}&img=1`);
  expect(local.querySelector("img")).toBeNull();
  expect(local.textContent).toContain(LOCAL_NO_THUMB);
  expect(local.querySelector(".thumb-empty").getAttribute("aria-hidden")).toBe("true");
  expect(rowOf(doc, SHARE).querySelector("img")).toBeNull();
  expect(rowOf(doc, SHARE).textContent).not.toContain(LOCAL_NO_THUMB);
  expect(rowOf(doc, hero.src).textContent).not.toContain(LOCAL_NO_THUMB);
  // Both social previews say why there is no image, in the popup's words.
  const cards = [...doc.querySelectorAll("#social .card")];
  expect(cards.map((c) => c.querySelector("img"))).toEqual([null, null]);
  expect(cards.map((c) => c.textContent.includes(LOCAL_NOT_LOADED))).toEqual([true, true]);
});

it("draws the images of a page on the reader's own network, which are that page's own", () => {
  const doc = report("http://192.168.1.1/status.html");
  expect(srcs(doc)).toEqual(expect.arrayContaining([PUBLIC_IMG, `${ROUTER}&img=1`, INLINE, ROUTER, NAS]));
  expect(srcs(doc)).not.toContain(SHARE);
  expect(doc.body.textContent).not.toContain(LOCAL_NO_THUMB);
  expect(doc.body.textContent).not.toContain(LOCAL_NOT_LOADED);
});

it("says 'not checked' for a Googlebot verdict that ran out of time, never 'blocked'", () => {
  const technical = { status: 200, finalUrl: FX.url, headers: {}, robotsTxt: { ok: true, status: 200, sitemaps: [], pathAllowed: { allowed: null, rule: null, unchecked: true } }, sitemap: { ok: true } };
  const doc = report(FX.url, { technical });
  const googlebot = [...doc.querySelectorAll("#technical tr")].find((tr) => tr.querySelector("th")?.textContent === "This URL for Googlebot");
  expect(googlebot.querySelector("td").textContent.replace(/\s+/g, " ").trim()).toBe("not checked too many rules to check in time");
  expect(googlebot.querySelector(".tag").className).toBe("tag neutral");
  // The two verdicts it does have are unchanged.
  const verdictOf = (pathAllowed) => [...report(FX.url, { technical: { ...technical, robotsTxt: { ...technical.robotsTxt, pathAllowed } } }).querySelectorAll("#technical tr")]
    .find((tr) => tr.querySelector("th")?.textContent === "This URL for Googlebot").querySelector("td").textContent.replace(/\s+/g, " ").trim();
  expect(verdictOf({ allowed: true, rule: null })).toBe("✓ allowed");
  expect(verdictOf({ allowed: false, rule: "Disallow: /" })).toBe("✗ blocked Disallow: /");
});
