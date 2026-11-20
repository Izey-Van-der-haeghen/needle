// Build dev/preview/fixtures/riverside.json from the fictional demo site in
// dev/preview/demo-site: runs the real content.js in jsdom (the test harness)
// and records what the server-side files return. No network, no real sites.
//
//   npx vite-node dev/preview/build-fixture.mjs   (vite-node comes with vitest; it resolves ?raw imports)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadContentScript } from "../../tests/helpers/content-harness.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(HERE, "demo-site");
const ORIGIN = "https://www.riverside-bikes.example";
const URL_ = `${ORIGIN}/repairs/`;
const html = fs.readFileSync(path.join(SITE, "repairs.html"), "utf8");

const page = await loadContentScript(html, {
  url: URL_,
  viewport: { width: 375, height: 700 },
  resourceEntries: [
    { name: `${ORIGIN}/img/workshop-hero.jpg`, initiatorType: "img", encodedBodySize: 412000 },
    { name: `${ORIGIN}/img/IMG_4821.jpg`, initiatorType: "img", encodedBodySize: 96000 }
  ]
});
const onpage = await page.send({ type: "ANALYZE_ONPAGE" });
const rendered = await page.send({ type: "GET_RENDERED" });
const main = await page.send({ type: "GET_MAIN_TEXT" });
page.window.close();

const text = (f) => fs.readFileSync(path.join(SITE, f), "utf8");
const pages = {
  [URL_]: { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "max-age=600", "strict-transport-security": "max-age=31536000", server: "demo" }, text: html },
  [`${ORIGIN}/robots.txt`]: { status: 200, headers: { "content-type": "text/plain" }, text: text("robots.txt") },
  [`${ORIGIN}/sitemap.xml`]: { status: 200, headers: { "content-type": "application/xml" }, text: text("sitemap.xml") }
};

const out = { name: "riverside", url: URL_, title: onpage.title, onpage, rendered, main, pages };
fs.writeFileSync(path.join(HERE, "fixtures", "riverside.json"), JSON.stringify(out, null, 1));
console.log(`Wrote fixtures/riverside.json: ${onpage.headings.length} headings, ${onpage.links.total} links, ${onpage.images.length} images`);
