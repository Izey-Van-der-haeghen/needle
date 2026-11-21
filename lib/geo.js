import { isAllowedByRobots } from "./robots.js";
import { isOrgType } from "./schema-validator.js";

/**
 * AI crawlers and what a robots.txt Disallow does for each, per the vendors'
 * own crawler pages.
 *   kind "search":   blocking keeps the site out of that AI's answers and citations.
 *   kind "training": blocking only opts out of model training; answers are unaffected.
 *   kind "user":     a fetch the user asked for; the vendor says robots.txt may not apply.
 * Only "search" blocks count against AI visibility.
 */
export const AI_BOTS = [
  { ua: "OAI-SearchBot", vendor: "OpenAI", kind: "search", purpose: "ChatGPT search results and citations" },
  { ua: "ChatGPT-User", vendor: "OpenAI", kind: "user", purpose: "Pages a ChatGPT user asks it to visit" },
  { ua: "GPTBot", vendor: "OpenAI", kind: "training", purpose: "Training OpenAI models" },
  { ua: "Claude-SearchBot", vendor: "Anthropic", kind: "search", purpose: "Claude search results" },
  { ua: "Claude-User", vendor: "Anthropic", kind: "user", purpose: "Pages fetched to answer a Claude user's question" },
  { ua: "ClaudeBot", vendor: "Anthropic", kind: "training", purpose: "Training Anthropic models" },
  { ua: "PerplexityBot", vendor: "Perplexity", kind: "search", purpose: "Perplexity search index and citations" },
  { ua: "Perplexity-User", vendor: "Perplexity", kind: "user", purpose: "Pages a Perplexity user asks it to visit" },
  // A robots.txt token, not a crawler: Googlebot fetches. It controls Gemini training and
  // grounding in Gemini apps and Vertex AI; Google Search and AI Overviews are not affected.
  { ua: "Google-Extended", vendor: "Google", kind: "control", purpose: "Whether Google may use the site to train and ground Gemini (Gemini apps, Vertex AI). Not a crawler; Google Search and AI Overviews are not affected" },
  { ua: "Applebot-Extended", vendor: "Apple", kind: "training", purpose: "Training Apple's AI models" },
  { ua: "Amzn-SearchBot", vendor: "Amazon", kind: "search", purpose: "Amazon search and Alexa answers" },
  { ua: "Amazonbot", vendor: "Amazon", kind: "training", purpose: "Improving Amazon products, may train AI models" },
  { ua: "Meta-WebIndexer", vendor: "Meta", kind: "search", purpose: "Meta AI search answers" },
  { ua: "Meta-ExternalAgent", vendor: "Meta", kind: "training", purpose: "Training Meta AI models" },
  { ua: "CCBot", vendor: "Common Crawl", kind: "training", purpose: "Common Crawl dataset, used to train many models" },
  { ua: "Bytespider", vendor: "ByteDance", kind: "training", purpose: "Training ByteDance models" }
];

/**
 * Which AI bots robots.txt allows to fetch this page.
 * @param {{text?: string}|null} robotsTxt
 * @param {string} [path="/"] - the page's path and query, as for the Googlebot verdict
 * @returns {{bots: Array<{ua: string, vendor: string, kind: string, purpose: string, allowed: boolean, rule: string|null}>,
 *            blockedCount: number, blockedSearchCount: number, totalCount: number}}
 */
export function analyzeAIAccess(robotsTxt, path = "/") {
  const text = robotsTxt?.text || "";
  const bots = AI_BOTS.map(bot => {
    const check = isAllowedByRobots(text, path || "/", bot.ua);
    return { ...bot, allowed: check.allowed, rule: check.rule };
  });
  const blocked = bots.filter(b => !b.allowed);
  return {
    // Cloudflare's managed robots.txt: its AI Crawl Control can also turn bots away at the
    // network level (HTTP 403), which a browser can't see.
    cloudflareManaged: /BEGIN Cloudflare Managed/i.test(text),
    bots,
    blockedCount: blocked.length,
    blockedSearchCount: blocked.filter(b => b.kind === "search").length,
    totalCount: bots.length
  };
}

/**
 * Is a fetched file real, or the site's HTML page served for a missing URL
 * (a "soft 404")?
 * @param {{ok?: boolean, headers?: Record<string,string>, text?: string}} r
 */
export function isRealTextFile(r) {
  if (!r || !r.ok) return false;
  if (/html/i.test(r.headers?.["content-type"] || "")) return false;
  return !/^\s*</.test(r.text || "");
}

/**
 * Probe /llms.txt and /llms-full.txt. Information only: Google says no special
 * file is needed for AI features, so it does not affect the score.
 * @param {string} origin - protocol + host, no trailing slash
 * @param {(requests: Array<{url: string, maxBytes?: number}>) => Promise<Array<Object>>} fetcher
 * @returns {Promise<{summary: {ok: boolean, size?: number, status?: number, error?: string},
 *                    full: {ok: boolean, size?: number, status?: number, error?: string}}>}
 */
export async function fetchLlmsTxt(origin, fetcher) {
  const [summary, full] = await fetcher([
    { url: `${origin}/llms.txt`, maxBytes: 64 * 1024 },
    { url: `${origin}/llms-full.txt`, maxBytes: 64 * 1024 }
  ]);
  const read = (r) => {
    if (isRealTextFile(r)) {
      const len = parseInt(r.headers?.["content-length"], 10);
      return { ok: true, size: Number.isFinite(len) ? len : (r.truncated ? null : (r.text || "").length) };
    }
    if (r?.status) return { ok: false, status: r.status };
    return { ok: false, error: r?.error || "Could not fetch" };
  };
  return { summary: read(summary), full: read(full) };
}

function* walkSchema(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const n of node) yield* walkSchema(n); return; }
  yield node;
  for (const v of Object.values(node)) if (v && typeof v === "object") yield* walkSchema(v);
}

function typesOf(obj) {
  const t = obj?.["@type"];
  return Array.isArray(t) ? t : t ? [t] : [];
}

/**
 * E-E-A-T signals: author, dates, outbound sources, organisation entity.
 * @param {Object} d - on-page data
 * @returns {Array<{label: string, ok: boolean, value: string, hint: string|null}>}
 */
export function analyzeEEAT(d) {
  const signals = [];

  // The author may sit deeper, as Google reads it: in @graph, mainEntity or an Article inside a WebPage.
  let authorFound = null;
  for (const s of d.schema || []) {
    for (const node of walkSchema(s.raw)) {
      if (!node.author) continue;
      const a = node.author;
      authorFound = typeof a === "string" ? a
        : Array.isArray(a) ? a.map(x => (typeof x === "string" ? x : x?.name)).filter(Boolean).join(", ")
        : a.name || null;
      if (authorFound) break;
    }
    if (authorFound) break;
  }
  authorFound = authorFound || d.authorMeta || d.authorByline || null;
  signals.push({
    label: "Author byline",
    ok: !!authorFound,
    value: authorFound || "not detected",
    hint: !authorFound ? 'Name the author on the page, or add <meta name="author"> or Article.author in schema' : null
  });

  let publishedDate = null;
  let modifiedDate = null;
  d.schema?.forEach(s => {
    const obj = s.raw || {};
    if (obj.datePublished) publishedDate = publishedDate || obj.datePublished;
    if (obj.dateModified) modifiedDate = modifiedDate || obj.dateModified;
  });
  publishedDate = publishedDate || d.publishedMeta;
  modifiedDate = modifiedDate || d.modifiedMeta;
  const fmtDate = (v) => {
    const dt = new Date(v);
    return Number.isNaN(dt.getTime()) ? String(v) : dt.toISOString().slice(0, 10);
  };
  signals.push({
    label: "Published date",
    ok: !!publishedDate,
    value: publishedDate ? fmtDate(publishedDate) : "not detected",
    hint: !publishedDate ? "Add Article.datePublished in schema or article:published_time" : null
  });
  signals.push({
    label: "Modified date",
    ok: !!modifiedDate,
    value: modifiedDate ? fmtDate(modifiedDate) : "not detected",
    hint: !modifiedDate ? "Add Article.dateModified in schema or article:modified_time" : null
  });

  const ext = d.externalLinkCount || 0;
  signals.push({
    label: "External citations",
    ok: ext >= 3,
    value: `${ext} external link${ext === 1 ? "" : "s"}`,
    hint: ext < 3 ? "Link to the sources behind your figures and claims" : null
  });

  let orgFound = null;
  for (const s of d.schema || []) {
    for (const node of walkSchema(s.raw)) {
      if (typesOf(node).some(isOrgType)) { orgFound = node; break; }
    }
    if (orgFound) break;
  }
  // A personal site describes a Person (often as a ProfilePage's mainEntity), not an Organization.
  let personFound = null;
  if (!orgFound) {
    for (const s of d.schema || []) {
      for (const node of walkSchema(s.raw)) {
        if (typesOf(node).includes("Person")) { personFound = node; break; }
      }
      if (personFound) break;
    }
  }
  if (personFound) {
    const personSameAs = [].concat(personFound.sameAs || []).filter(Boolean);
    signals.push({
      label: "Person entity",
      ok: personSameAs.length > 0,
      value: personSameAs.length ? `${personSameAs.length} sameAs link${personSameAs.length === 1 ? "" : "s"}` : "no sameAs",
      hint: personSameAs.length ? null : "Add sameAs links (LinkedIn, GitHub, your profiles) to your Person schema"
    });
    return signals;
  }
  const sameAs = [].concat(orgFound?.sameAs || []).filter(Boolean);
  const hasOrgLogo = !!orgFound?.logo;
  signals.push({
    label: "Organization entity",
    ok: !!orgFound && sameAs.length > 0 && hasOrgLogo,
    value: !orgFound ? "no Organization schema"
      : `${hasOrgLogo ? "logo" : "no logo"} · ${sameAs.length ? `${sameAs.length} sameAs link${sameAs.length === 1 ? "" : "s"}` : "no sameAs"}`,
    hint: !orgFound ? "Add Organization schema with name, url, logo and sameAs (your social profiles)"
      : !sameAs.length ? "Add sameAs links (LinkedIn, Wikipedia, social profiles) to your Organization schema"
      : !hasOrgLogo ? "Add a logo to your Organization schema"
      : null
  });

  return signals;
}

/**
 * How easy the page is to quote: question headings, lists, tables.
 * @param {Object} d - on-page data
 * @returns {Array<{label: string, ok: boolean, value: string, hint: string|null}>}
 */
export function analyzeCitability(d) {
  const checks = [];

  const headings = d.headings || [];
  const questionHeadings = headings.filter(h => /\?|^(what|how|why|when|where|who|which|is|are|does|do|can)\s/i.test(h.text || ""));
  checks.push({
    label: "Question-based headings",
    ok: questionHeadings.length >= 2,
    value: `${questionHeadings.length} of ${headings.length}`,
    hint: questionHeadings.length < 2 ? "Phrase some headings as the questions people ask, and answer them right below" : null
  });

  const lists = d.listCount || 0;
  checks.push({
    label: "Lists in the content",
    ok: lists >= 1,
    value: `${lists} list${lists === 1 ? "" : "s"} outside menus`,
    hint: lists === 0 ? "Steps, options and key facts are easier to quote as a list" : null
  });

  const tables = d.tableCount || 0;
  checks.push({
    label: "Data tables",
    ok: tables >= 1,
    value: `${tables} table${tables === 1 ? "" : "s"}`,
    hint: null
  });

  return checks;
}

/**
 * Combine the GEO checks into one 0–100 AI readiness score. Only blocks of
 * search-type AI bots cost points; llms.txt and FAQ schema are not inputs,
 * because Google says neither is needed for AI features.
 * @param {ReturnType<typeof analyzeAIAccess>} aiAccess
 * @param {Array<{ok: boolean}>} eeat
 * @param {Array<{ok: boolean}>} citability
 * @returns {{score: number, level: "good"|"warn"|"bad"}}
 */
export function aiReadinessScore(aiAccess, eeat, citability) {
  let score = 100;
  score -= (aiAccess.blockedSearchCount || 0) * 10;
  score -= eeat.filter(s => !s.ok).length * 5;
  score -= citability.filter(c => !c.ok).length * 4;
  score = Math.max(0, Math.min(100, score));
  return { score, level: score >= 80 ? "good" : score >= 50 ? "warn" : "bad" };
}
