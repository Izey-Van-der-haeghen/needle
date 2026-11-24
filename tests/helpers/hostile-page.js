// A page whose every text is an HTML injection attempt, for the real popup (tests/helpers/popup-harness.js).
// Page text reaches the popup's innerHTML in many places; each must go through escapeHtml.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildHtmlReport } from "../../lib/export.js";
import { analyzeAIAccess, analyzeEEAT, analyzeCitability, aiReadinessScore } from "../../lib/geo.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FX = JSON.parse(readFileSync(path.join(ROOT, "dev/preview/fixtures/riverside.json"), "utf8"));

/** Shown as text, the marker is harmless; parsed as HTML, it makes an element with this attribute. */
export const MARK = "data-needle-xss";
const PAYLOAD = `"'><img src=x onerror=1 ${MARK}>`;

/** Every string gets the payload: in front of text, in the query of an address. Keys stay as they are. */
function hostile(v) {
  if (typeof v === "string") return /^https?:\/\//.test(v) ? `${v}${v.includes("?") ? "&" : "?"}q=${PAYLOAD}` : `${PAYLOAD}${v}`;
  if (Array.isArray(v)) return v.map(hostile);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, hostile(x)]));
  return v;
}

const escapeXml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** What the server answers for the page, robots.txt and the sitemap: injection attempts in every text. */
function hostilePages() {
  const pages = {};
  for (const [url, p] of Object.entries(FX.pages)) {
    const headers = Object.fromEntries(Object.entries(p.headers).map(([k, v]) => [k, k === "content-type" ? v : `${v} ${PAYLOAD}`]));
    let text = p.text;
    if (url.endsWith("robots.txt")) text = `User-agent: ${PAYLOAD}\nDisallow: /${PAYLOAD}\n\n${text}\nSitemap: ${url.replace("robots.txt", "sitemap.xml")}?q=${PAYLOAD}\n`;
    else if (url.endsWith("sitemap.xml")) text = text.replace(/<loc>([^<]*)<\/loc>/g, (_, loc) => `<loc>${loc}?q=${escapeXml(PAYLOAD)}</loc>`);
    else text = text.replace(/<title>([^<]*)<\/title>/i, (_, t) => `<title>${escapeXml(PAYLOAD)}${t}</title>`)
      .replace(/<h1([^>]*)>/i, (m) => `${m}${escapeXml(PAYLOAD)}`);
    pages[url] = { ...p, headers: { ...headers, "x-robots-tag": `noarchive ${PAYLOAD}` }, text };
  }
  return pages;
}

/** Options for loadPopup: the hostile page in the tab and on the server, with access to websites. */
export function hostileOptions() {
  const pages = hostilePages();
  const pageFetchAll = (requests) => (requests || []).map((r) => {
    const p = pages[r.url.replace(/\?.*$/, "")] || pages[r.url];
    if (!p) return { ok: false, status: 404, url: r.url, redirected: false, headers: { "content-type": "text/html" }, text: "", truncated: false, ms: 20 };
    return { ok: p.status < 400, status: p.status, url: r.url, redirected: false, headers: p.headers, text: p.text, truncated: false, ms: 40 };
  });
  return {
    allSites: true,
    onpage: hostile(FX.onpage),
    tabHandlers: { GET_RENDERED: () => hostile(FX.rendered), GET_MAIN_TEXT: () => hostile(FX.main) },
    scripting: async ({ func, args, files }) => [{ result: files ? undefined : func?.name === "pageFetchAll" ? pageFetchAll(args?.[0]) : undefined }]
  };
}

/** Open every tab and every fold, so each renderer has run with the hostile data. */
export async function visitEverything() {
  const settle = () => new Promise((r) => setTimeout(r, 30));
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    tab.click();
    await settle();
    document.querySelectorAll("details").forEach((d) => { d.open = true; d.dispatchEvent(new Event("toggle")); });
    await settle();
  }
}

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
