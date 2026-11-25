// A page whose every text is an HTML injection attempt, for the real popup (tests/helpers/popup-harness.js).
// Page text reaches the popup's innerHTML in many places; each must go through escapeHtml.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { buildHtmlReport } from "../../lib/export.js";
import { analyzeAIAccess, analyzeEEAT, analyzeCitability, aiReadinessScore } from "../../lib/geo.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FX = JSON.parse(readFileSync(path.join(ROOT, "dev/preview/fixtures/riverside.json"), "utf8"));

/** Shown as text, the marker is harmless; parsed as HTML, it makes an element with this attribute. */
export const MARK = "data-needle-xss";
const PAYLOAD = `"'><img src=x onerror=1 ${MARK}>`;
/** The same attempt without spaces, for values that are cut at the first space (a robots.txt line). */
const PAYLOAD_NO_SPACE = `"'><b/${MARK}>`;
/**
 * A Sitemap: value the URL parser keeps as written. An address whose scheme is not http(s) has an opaque
 * path, where < > " and ' are not percent-encoded: new URL('x:"<b>').pathname is '"<b>'.
 */
const RAW_SITEMAP = `x:${PAYLOAD_NO_SPACE}`;

/** Every string gets the payload: in front of text, in the query of an address. Keys stay as they are. */
function hostile(v) {
  if (typeof v === "string") return /^https?:\/\//.test(v) ? `${v}${v.includes("?") ? "&" : "?"}q=${PAYLOAD}` : `${PAYLOAD}${v}`;
  if (Array.isArray(v)) return v.map(hostile);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, hostile(x)]));
  return v;
}

const escapeXml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s) => escapeXml(s).replace(/"/g, "&quot;");
const SITE = new URL(FX.url).origin;

/** What the server answers for the page, robots.txt and the sitemap: injection attempts in every text. */
function hostilePages() {
  const pages = {};
  for (const [url, p] of Object.entries(FX.pages)) {
    const headers = Object.fromEntries(Object.entries(p.headers).map(([k, v]) => [k, k === "content-type" ? v : `${v} ${PAYLOAD}`]));
    let text = p.text;
    const sitemap = url.replace("robots.txt", "sitemap.xml");
    // The first sitemap named is the one the sitemap check reads first, and finds the page in.
    if (url.endsWith("robots.txt")) text = `Sitemap: ${sitemap}?q=${PAYLOAD_NO_SPACE}\nUser-agent: ${PAYLOAD}\nDisallow: /${PAYLOAD}\n\n${text}\nSitemap: ${sitemap}?q=${PAYLOAD}\nSitemap: ${RAW_SITEMAP}\n`;
    else if (url.endsWith("sitemap.xml")) text = text.replace(/<loc>([^<]*)<\/loc>/g, (_, loc) => `<loc>${loc}?q=${escapeXml(PAYLOAD)}</loc>`)
      .replace("</urlset>", `  <url><loc>${FX.url}</loc></url>\n</urlset>`);
    else text = text.replace(/<title>([^<]*)<\/title>/i, (_, t) => `<title>${escapeXml(PAYLOAD)}${t}</title>`)
      .replace(/<h1([^>]*)>/i, (m) => `${m}${escapeXml(PAYLOAD)}`);
    pages[url] = { ...p, headers: { ...headers, "x-robots-tag": `noarchive ${PAYLOAD}` }, text };
  }
  return pages;
}

/** The tab's page as content.js reads it, plus an hreflang alternate the URL parser keeps as written. */
function hostileOnpage() {
  const onpage = hostile(FX.onpage);
  onpage.hreflang.push({ lang: "de", href: `javascript:${PAYLOAD}` });
  return onpage;
}

/** Pages pressed buttons load from other sites: an hreflang alternate and a competitor for Compare. */
const ALTERNATE = `<!doctype html><html lang="${escapeAttr(PAYLOAD)}"><head><title>${escapeXml(PAYLOAD)}</title>
  <link rel="canonical" href="${escapeAttr(`${SITE}/elsewhere/?q=${PAYLOAD}`)}">
  <meta name="robots" content="${escapeAttr(`index ${PAYLOAD}`)}">
  <link rel="alternate" hreflang="${escapeAttr(PAYLOAD)}" href="${escapeAttr(`${FX.url}?q=${PAYLOAD}`)}">
  </head><body><h1>${escapeXml(PAYLOAD)}</h1></body></html>`;
const COMPETITOR = "https://www.rival.example/";
const COMPETITOR_PAGE = `<!doctype html><html lang="${escapeAttr(PAYLOAD)}"><head><title>${escapeXml(PAYLOAD)} Rival Bikes</title>
  <meta name="description" content="${escapeAttr(`${PAYLOAD} Bike repairs while you wait.`)}">
  <meta name="robots" content="${escapeAttr(PAYLOAD)}">
  <link rel="canonical" href="${escapeAttr(`${COMPETITOR}?q=${PAYLOAD}`)}">
  <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": [`${PAYLOAD}LocalBusiness`], name: PAYLOAD }).replace(/</g, "\\u003c")}</script>
  </head><body><h1>${escapeXml(PAYLOAD)} Rival</h1><h2>${escapeXml(PAYLOAD)}</h2><p>${escapeXml(PAYLOAD)} We fix bikes.</p>
  <img src="/a.jpg"></body></html>`;

/**
 * fetch() for the checks the popup runs itself: the hreflang alternates, the http/https/www versions
 * and Compare. Use it with vi.stubGlobal("fetch", hostileFetch). Nothing leaves the test.
 */
export async function hostileFetch(url) {
  const answer = (finalUrl, text, headers = {}) => ({ ok: true, status: 200, url: finalUrl, body: null,
    headers: new Headers({ "content-type": "text/html; charset=utf-8", ...headers }), text: async () => text });
  // Chrome's own error, as for an address fetch() can't load (javascript:, or a version that doesn't answer).
  if (!/^https?:/.test(url) || url === "http://riverside-bikes.example/") throw new TypeError("Failed to fetch");
  // The home page versions all end on one address with the attempt in its query.
  if (/^https?:\/\/(www\.)?riverside-bikes\.example\/$/.test(url)) return answer(`${SITE}/?q=${PAYLOAD}`, "");
  // An alternate redirects, points its canonical elsewhere, and links back with the attempt everywhere.
  if (url.startsWith(SITE)) return answer(`${url}&r=${PAYLOAD}`, ALTERNATE, { "x-robots-tag": `noarchive ${PAYLOAD}` });
  if (url === COMPETITOR) return answer(url, COMPETITOR_PAGE);
  return { ok: false, status: 404, url, body: null, headers: new Headers({ "content-type": "text/html" }), text: async () => "" };
}

/** History as the popup stores it, with page titles and addresses from hostile pages. */
function hostileHistory() {
  const hour = 3600 * 1000;
  return [
    { url: new URL(`https://www.other.example/${PAYLOAD}`).href, title: `${PAYLOAD}Other page`, verdict: "warn", healthScore: 72, previousScore: 80, ts: Date.now() - hour },
    { url: `https://www.third.example/?q=${encodeURIComponent(PAYLOAD)}`, title: PAYLOAD, verdict: "bad", healthScore: null, previousScore: null, ts: Date.now() - 40 * 24 * hour }
  ];
}

/** What the hostile server answers now: set by hostileOptions(), changed by refreshWithOnlyRawSitemap(). */
let served = {};

/** Options for loadPopup: the hostile page in the tab and on the server, hostile history, access to websites. */
export function hostileOptions() {
  served = hostilePages();
  const pageFetchAll = (requests) => (requests || []).map((r) => {
    // Chrome's fetch() refuses a scheme other than http(s): no answer, as lib/page-fetch.js reports it.
    if (!/^https?:/.test(r.url)) return { ok: false, status: 0, url: r.url, error: "Could not connect" };
    const p = served[r.url.replace(/\?.*$/, "")] || served[r.url];
    if (!p) return { ok: false, status: 404, url: r.url, redirected: false, headers: { "content-type": "text/html" }, text: "", truncated: false, ms: 20 };
    return { ok: p.status < 400, status: p.status, url: r.url, redirected: false, headers: p.headers, text: p.text, truncated: false, ms: 40 };
  });
  return {
    allSites: true,
    local: { history: hostileHistory() },
    onpage: hostileOnpage(),
    tabHandlers: { GET_RENDERED: () => hostile(FX.rendered), GET_MAIN_TEXT: () => hostile(FX.main) },
    scripting: async ({ func, args, files }) => [{ result: files ? undefined : func?.name === "pageFetchAll" ? pageFetchAll(args?.[0]) : undefined }]
  };
}

/** The boxes the pressed buttons fill, each with page text from a hostile source. */
export const RESULT_BOXES = ["history-list", "kw-result", "hreflang-cluster", "sitemap-result", "variants-result", "compare-result"];

/** Wait until a check has drawn its result; with escaping broken the result may look odd, so only its structure counts. */
const drawn = (id, selector = "*") => vi.waitFor(() => {
  const box = document.getElementById(id);
  if (!box?.querySelector(selector) || box.querySelector(".loading")) throw new Error(`${id} not drawn`);
}, { timeout: 3000 });

/**
 * Open every tab and every fold, so each renderer has run with the hostile data; then open History,
 * press every check button (the keyword check with the attempt as the phrase) and run Compare against
 * a hostile competitor. Needs hostileOptions() and hostileFetch.
 */
export async function visitEverything() {
  const settle = () => new Promise((r) => setTimeout(r, 30));
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    tab.click();
    await settle();
    document.querySelectorAll("details").forEach((d) => { d.open = true; d.dispatchEvent(new Event("toggle")); });
    await settle();
  }

  document.getElementById("open-history").click();
  await drawn("history-list", ".history-item");
  document.getElementById("close-history").click();

  document.getElementById("kw-input").value = PAYLOAD;
  document.querySelectorAll('button[id$="-check"]').forEach((b) => b.click());
  await drawn("kw-result");
  await drawn("hreflang-cluster", "table");
  await drawn("sitemap-result");
  await drawn("variants-result", "table");

  document.querySelector('.competitor-url[data-idx="0"]').value = COMPETITOR;
  document.getElementById("run-compare").click();
  await drawn("compare-result", ".compare-table");
}

/**
 * The site changes its robots.txt to name one sitemap only: RAW_SITEMAP, which the server check can't read
 * and shows by its path. Press Refresh in the Technical tab and wait until every check of the new audit
 * has answered (the report button is back). Run it after visitEverything(): Refresh empties the result boxes.
 */
export async function refreshWithOnlyRawSitemap() {
  const robotsUrl = Object.keys(served).find((u) => u.endsWith("robots.txt"));
  served[robotsUrl] = { ...served[robotsUrl], text: `User-agent: *\nDisallow: /checkout/\n\nSitemap: ${RAW_SITEMAP}\n` };
  document.querySelector('#panel-technical [data-refresh="onpage"]').click();
  await vi.waitFor(() => {
    if (!document.querySelector("#panel-technical pre.code")?.textContent.includes(`Sitemap: ${RAW_SITEMAP}`)) throw new Error("new robots.txt not drawn");
    if (document.getElementById("export-audit-header").hidden) throw new Error("audit not finished");
  }, { timeout: 3000 });
}

/** The Technical tab's Sitemap card. */
export const sitemapCard = () => [...document.querySelectorAll("#panel-technical .card")].find((c) => c.querySelector("h2")?.textContent === "Sitemap");

/** Elements the page text made: there must be none. */
export const injected = () => [...document.querySelectorAll(`[${MARK}], img[src="x"], [onerror]`)];

/** Needle's downloadable HTML report for the hostile page, parsed: its own escaping, outside the popup. */
export function hostileReport() {
  const onpage = hostile(FX.onpage);
  const robots = hostilePages()[Object.keys(FX.pages).find((u) => u.endsWith("robots.txt"))].text;
  const aiAccess = analyzeAIAccess({ text: robots });
  const eeat = analyzeEEAT(onpage);
  const citability = analyzeCitability(onpage);
  const geo = { aiAccess, eeat, citability, llmsTxt: { summary: { ok: false }, full: { ok: false } }, score: aiReadinessScore(aiAccess, eeat, citability) };
  const html = buildHtmlReport({ url: onpage.url, onpage, technical: null, geo, health: null, verdict: null, theme: "light", version: "0.0.0",
    offpage: { psi: null, psiError: PAYLOAD, dfs: null, dfsError: PAYLOAD } });
  return new DOMParser().parseFromString(html, "text/html");
}
