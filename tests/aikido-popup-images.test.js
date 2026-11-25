// @vitest-environment jsdom
// The page picks the images the popup shows: its og:image, its twitter:image and its content images.
// An <img> may carry the browser's cookies and had no address check, so a public page could make Needle
// send a GET to a router or NAS on the user's network (http://192.168.1.1/…?reboot). An image whose address,
// as written, is on that network is not loaded unless the audited page is there too, and no preview sends a
// Referer. Not covered (an accepted risk, see canPreview in popup.js): a public address that redirects there.
import { it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPopup } from "./helpers/popup-harness.js";

// A path, not a URL object: in a jsdom test the global URL is jsdom's, which node:fs refuses.
const FX = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../dev/preview/fixtures/riverside.json"), "utf8"));
const hero = FX.onpage.images.find((i) => i.context === "main");
const ROUTER = "http://192.168.1.1/cgi-bin/reboot?now=1";
const NAS = "http://localhost:5000/api/delete?all=1";
const PUBLIC_IMG = hero.src;
const onpage = {
  og: { ...FX.onpage.og, image: ROUTER },
  twitter: { ...FX.onpage.twitter, image: NAS },
  images: [...FX.onpage.images, { ...hero, domIndex: 10, src: `${ROUTER}&img=1` }]
};

const imgs = () => [...document.querySelectorAll("img")];
const socialCards = () => [...document.querySelectorAll(".social-card")];
const thumbs = () => [...document.querySelectorAll("#image-list .image-item")];

it("loads no page-chosen image on the user's network from a public page, and sends no Referer", async () => {
  const { chrome, tab } = await loadPopup({ panel: true, onpage });
  await vi.waitFor(() => expect(thumbs().length).toBeGreaterThan(1));

  // Nothing points at the router or the NAS.
  expect(imgs().map((i) => i.getAttribute("src")).filter((s) => /192\.168\.|localhost/.test(s))).toEqual([]);
  // Both social previews say why there is no image; the og:image is still reported as set.
  expect(socialCards().map((c) => c.querySelector(".social-empty")?.textContent)).toEqual(["Local-network address, not loaded", "Local-network address, not loaded"]);
  expect(document.querySelector(".social-card img")).toBeNull();
  // The local thumbnail is an empty box, and its row says why in text everyone gets (not only on hover);
  // the public one still loads, and its row says nothing of the kind.
  const local = thumbs().find((li) => li.querySelector(".item-title").title === `${ROUTER}&img=1`);
  expect(local.querySelector("img")).toBeNull();
  expect(local.querySelector("span.thumb").getAttribute("aria-hidden")).toBe("true");
  expect(local.querySelector(".item-body").textContent).toContain("no preview: local-network address");
  const pub = thumbs().find((li) => li.querySelector(".item-title").title === PUBLIC_IMG);
  expect(pub.querySelector("img.thumb").getAttribute("src")).toBe(PUBLIC_IMG);
  expect(pub.textContent).not.toContain("no preview");
  // Every image the popup loads sends no Referer.
  expect(imgs().length).toBeGreaterThan(0);
  expect(imgs().filter((i) => i.getAttribute("referrerpolicy") !== "no-referrer").map((i) => i.outerHTML)).toEqual([]);

  // The side panel moves to a page on the user's own network: its own images are its own, and load.
  Object.assign(tab, { id: 2, url: "http://192.168.1.1/status.html" });
  chrome.tabs.onActivated._all.forEach((f) => f({ tabId: 2, windowId: 1 }));
  await vi.waitFor(() => expect(document.querySelector(".social-card img")?.getAttribute("src")).toBe(ROUTER), { timeout: 3000 });
  expect(socialCards().map((c) => c.querySelector("img")?.getAttribute("src"))).toEqual([ROUTER, NAS]);
  await vi.waitFor(() => expect(thumbs().find((li) => li.querySelector(".item-title").title === `${ROUTER}&img=1`)?.querySelector("img.thumb")).toBeTruthy());
  expect(document.getElementById("image-list").textContent).not.toContain("no preview");
  expect(imgs().filter((i) => i.getAttribute("referrerpolicy") !== "no-referrer").map((i) => i.outerHTML)).toEqual([]);
});
