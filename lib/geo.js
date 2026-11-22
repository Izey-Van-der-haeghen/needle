import { isAllowedByRobots } from "./robots.js";
import { isArticleLike } from "./image-rules.js";
import { isOrgType, bareType } from "./schema-validator.js";

/**
 * AI crawlers and what a robots.txt Disallow does for each, per the vendors'
 * own crawler pages.
 *   kind "search":   blocking keeps the site out of that AI's answers and citations.
 *   kind "training": blocking only opts out of model training; answers are unaffected.
 *   kind "user":     a fetch the user asked for. OpenAI and Perplexity say robots.txt may not apply;
 *                    Anthropic says its bots follow it (honoursRobots), so blocking Claude-User keeps
 *                    the site out of Claude's answers.
 * Only blocks that keep the site out of answers count against AI visibility (keepsOutOfAnswers).
 */
export const AI_BOTS = [
  { ua: "OAI-SearchBot", vendor: "OpenAI", kind: "search", purpose: "ChatGPT search results and citations" },
  { ua: "ChatGPT-User", vendor: "OpenAI", kind: "user", purpose: "Pages a ChatGPT user asks it to visit" },
  { ua: "GPTBot", vendor: "OpenAI", kind: "training", purpose: "Training OpenAI models" },
  { ua: "Claude-SearchBot", vendor: "Anthropic", kind: "search", purpose: "Claude search results" },
  { ua: "Claude-User", vendor: "Anthropic", kind: "user", honoursRobots: true, purpose: "Pages fetched to answer a Claude user's question. Anthropic says its bots follow robots.txt" },
  { ua: "ClaudeBot", vendor: "Anthropic", kind: "training", purpose: "Training Anthropic models" },
  { ua: "PerplexityBot", vendor: "Perplexity", kind: "search", purpose: "Perplexity search index and citations" },
  { ua: "Perplexity-User", vendor: "Perplexity", kind: "user", purpose: "Pages a Perplexity user asks it to visit" },
  // A robots.txt token, not a crawler: Googlebot fetches. It controls Gemini training and
  // grounding in Gemini apps and Vertex AI; Google Search and AI Overviews are not affected.
  { ua: "Google-Extended", vendor: "Google", kind: "control", purpose: "Whether Google may use the site to train and ground Gemini (Gemini apps, Vertex AI). Not a crawler; Google Search and AI Overviews are not affected" },
  { ua: "Applebot", vendor: "Apple", kind: "search", purpose: "Search in Spotlight, Siri and Safari" },
  { ua: "Applebot-Extended", vendor: "Apple", kind: "training", purpose: "Training Apple's AI models" },
  { ua: "Amzn-SearchBot", vendor: "Amazon", kind: "search", purpose: "Amazon search and Alexa answers" },
  { ua: "Amazonbot", vendor: "Amazon", kind: "training", purpose: "Improving Amazon products, may train AI models" },
  { ua: "Meta-WebIndexer", vendor: "Meta", kind: "search", purpose: "Meta AI search answers" },
  { ua: "Meta-ExternalAgent", vendor: "Meta", kind: "training", purpose: "Training Meta AI models" },
  { ua: "DuckAssistBot", vendor: "DuckDuckGo", kind: "search", purpose: "DuckDuckGo's AI-assisted answers, which cite their sources" },
  { ua: "CCBot", vendor: "Common Crawl", kind: "training", purpose: "Common Crawl dataset, used to train many models" },
  { ua: "Bytespider", vendor: "ByteDance", kind: "training", purpose: "Training ByteDance models" }
];

/** Does blocking this bot keep the site out of that AI's answers (not only out of training)? */
export const keepsOutOfAnswers = (bot) => bot.kind === "search" || bot.honoursRobots === true;

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
    blockedSearchCount: blocked.filter(keepsOutOfAnswers).length,
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

/** @param {Set<string>} [skip] properties whose values are not walked */
function* walkSchema(node, skip) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const n of node) yield* walkSchema(n, skip); return; }
  yield node;
  for (const [k, v] of Object.entries(node)) if (v && typeof v === "object" && !skip?.has(k)) yield* walkSchema(v, skip);
}

// Properties that name another party: an employer, school, client, brand or topic.
// An organisation found there is not the one that runs the page.
const MENTION_PROPS = new Set(["about", "mentions", "worksFor", "alumniOf", "memberOf", "affiliation",
  "sourceOrganization", "sponsor", "funder", "brand", "manufacturer", "itemReviewed"]);

function typesOf(obj) {
  const t = obj?.["@type"];
  return [].concat(t || []).filter((x) => typeof x === "string").map(bareType);
}

/**
 * The author the page's schema names, where Google reads it: in @graph, in mainEntity or in an
 * Article inside a WebPage, also when the author is a reference ({"@id": …}) to a Person node
 * elsewhere on the page (Yoast writes it that way). Authors of things the page only mentions
 * or reviews don't count.
 * @param {Array<{raw: Object}>} schema - the page's JSON-LD nodes
 * @returns {string} the author's name (several joined with ", "), or ""
 */
export function schemaAuthor(schema) {
  const text = (v) => (typeof v === "string" ? v.trim() : "");
  const byId = new Map();
  for (const s of schema || []) {
    for (const node of walkSchema(s.raw)) {
      const id = node["@id"];
      if (typeof id === "string" && text(node.name) && !byId.has(id)) byId.set(id, text(node.name));
    }
  }
  const nameOf = (a) => (typeof a === "string" ? a.trim() : text(a?.name) || byId.get(a?.["@id"]) || "");
  for (const s of schema || []) {
    for (const node of walkSchema(s.raw, MENTION_PROPS)) {
      if (!node.author) continue;
      const name = [].concat(node.author).map(nameOf).filter(Boolean).join(", ");
      if (name) return name;
    }
  }
  return "";
}

/**
 * A page's date as the page wrote it. "2026-11-21T00:00:00+01:00" is 21 November: converting it to
 * UTC first (toISOString) would make it 20 November. Other formats are shown as written.
 * @param {string|number} v
 * @returns {string} YYYY-MM-DD, or the value as written
 */
export function dateAsWritten(v) {
  // JSON-LD may write {"@value": "2026-11-21", "@type": "Date"}.
  const first = Array.isArray(v) ? v[0] : v;
  const raw = first && typeof first === "object" ? first["@value"] ?? "" : first;
  const s = String(raw ?? "").trim();
  if (/^0000-00-00/.test(s)) return ""; // WordPress writes this for "no date"
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})(?!\d)/);
  if (iso) return iso[1];
  // Anything else ("05/11/2026", "2026-11", "Winter 2026") is shown as written: reading it as a date
  // would guess the day order or the timezone.
  return s;
}

/**
 * E-E-A-T signals: author, dates, outbound sources, organisation entity.
 * @param {Object} d - on-page data
 * @returns {Array<{label: string, ok: boolean, value: string, hint: string|null}>}
 */
export function analyzeEEAT(d) {
  const signals = [];
  // A byline and dates belong on articles. A home, category, product or tool page needs none, so
  // there they are information only ("not scored"), not something missing.
  const article = isArticleLike(d);

  const authorFound = schemaAuthor(d.schema) || d.authorMeta || d.authorByline || null;
  signals.push({
    label: "Author byline",
    ok: !!authorFound,
    value: authorFound || "not detected",
    hint: !authorFound ? 'Name the author on the page, or add <meta name="author"> or Article.author in schema' : null,
    ...(!authorFound && !article ? { info: true } : {})
  });

  let publishedDate = null;
  let modifiedDate = null;
  // The page's own dates: top-level blocks and their main entity (an Article inside a WebPage),
  // not the dates of things the page only mentions.
  d.schema?.forEach(s => {
    for (const obj of walkSchema(s.raw, MENTION_PROPS)) {
      if (obj.datePublished) publishedDate = publishedDate || obj.datePublished;
      if (obj.dateModified) modifiedDate = modifiedDate || obj.dateModified;
    }
  });
  publishedDate = publishedDate || d.publishedMeta;
  modifiedDate = modifiedDate || d.modifiedMeta;
  signals.push({
    label: "Published date",
    ok: !!publishedDate,
    value: publishedDate ? dateAsWritten(publishedDate) : "not detected",
    hint: !publishedDate ? "Add Article.datePublished in schema or article:published_time" : null,
    ...(!publishedDate && !article ? { info: true } : {})
  });
  signals.push({
    label: "Modified date",
    ok: !!modifiedDate,
    value: modifiedDate ? dateAsWritten(modifiedDate) : "not detected",
    hint: !modifiedDate ? "Add Article.dateModified in schema or article:modified_time" : null,
    ...(!modifiedDate && !article ? { info: true } : {})
  });

  const ext = d.externalLinkCount || 0;
  signals.push({
    label: "External citations",
    ok: ext >= 3,
    value: `${ext} external link${ext === 1 ? "" : "s"}`,
    hint: ext < 3 ? "Link to the sources behind your figures and claims" : null
  });

  // The site's own entity: an employer (worksFor) or a client (sourceOrganization) doesn't count,
  // also when it is a separate @graph node that the mention points to by @id.
  const mentioned = new Set();
  for (const s of d.schema || []) {
    for (const node of walkSchema(s.raw)) {
      for (const k of MENTION_PROPS) for (const v of [].concat(node[k] || [])) if (v?.["@id"]) mentioned.add(v["@id"]);
    }
  }
  const isOwnCandidate = (node) => !(node["@id"] && mentioned.has(node["@id"]));
  let orgFound = null;
  for (const s of d.schema || []) {
    for (const node of walkSchema(s.raw, MENTION_PROPS)) {
      if (typesOf(node).some(isOrgType) && isOwnCandidate(node)) { orgFound = node; break; }
    }
    if (orgFound) break;
  }
  // A personal site describes a Person (often as a ProfilePage's mainEntity), not an Organization.
  // A Person found only as author or creator also counts: a guest author and the owner writing on
  // their own site look the same in schema, and leaving the owner out would be a false alarm.
  let personFound = null;
  if (!orgFound) {
    for (const s of d.schema || []) {
      for (const node of walkSchema(s.raw, MENTION_PROPS)) {
        if (typesOf(node).includes("Person") && isOwnCandidate(node)) { personFound = node; break; }
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

// A question mark in any script (？ ؟ and the Greek ;), or a heading that starts with a question
// word in Needle's languages (English, Dutch, French, German, Spanish, Italian).
const QUESTION_MARK = /[?？؟]|[\u0370-\u03FF\u1F00-\u1FFF][^;]*[;\u037E]\s*$/u;
const QUESTION_WORD = /^(what|how|why|when|where|who|which|is|are|does|do|can|wat|hoe|waarom|wanneer|waar|wie|welke|welk|kan|kun|kunt|moet|comment|pourquoi|quand|où|qui|quel|quelle|quels|quelles|combien|est-ce|peut-on|was|warum|wann|wo|wer|welche|welcher|welches|kann|qué|cómo|por qué|cuándo|dónde|quién|cuál|cuánto|cosa|perché|quando|chi|quale|quanto)(\s|$)/iu;
/** Is a heading phrased as a question? */
export const isQuestion = (text) => { const t = String(text || "").trim(); return QUESTION_MARK.test(t) || QUESTION_WORD.test(t); };

/**
 * How easy the page is to quote: question headings, lists, tables.
 * @param {Object} d - on-page data
 * @returns {Array<{label: string, ok: boolean, info?: boolean, value: string, hint: string|null}>}
 *   info: shown for information only, not a problem and not in the score
 */
export function analyzeCitability(d) {
  const checks = [];

  const headings = d.headings || [];
  const questionHeadings = headings.filter(h => isQuestion(h.text));
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

  // Most pages need no table: shown for information, never amber, not in the score.
  const tables = d.tableCount || 0;
  checks.push({
    label: "Data tables",
    ok: tables >= 1,
    info: true,
    value: `${tables} table${tables === 1 ? "" : "s"}`,
    hint: null
  });

  return checks;
}

// Points the AI readiness score loses per item. AI_SCORE_NOTE explains them in the AI tab and the report.
const COST = { blockedSearchBot: 10, trustSignal: 5, quotable: 4 };

/** How the AI readiness score is made, in words. */
export const AI_SCORE_NOTE = `Each blocked AI search bot costs ${COST.blockedSearchBot} points, each missing trust signal ${COST.trustSignal} and each missing quotable structure ${COST.quotable} (data tables don't count). Blocking training bots doesn't affect answers.`;

/**
 * Combine the GEO checks into one 0–100 AI readiness score. Of the bots, only
 * blocked search-type AI bots cost points; llms.txt and FAQ schema are not inputs,
 * because Google says neither is needed for AI features.
 * @param {ReturnType<typeof analyzeAIAccess>} aiAccess
 * @param {Array<{ok: boolean}>} eeat
 * @param {Array<{ok: boolean}>} citability
 * @returns {{score: number, level: "good"|"warn"|"bad"}}
 */
export function aiReadinessScore(aiAccess, eeat, citability) {
  let score = 100;
  score -= (aiAccess.blockedSearchCount || 0) * COST.blockedSearchBot;
  score -= eeat.filter(s => !s.ok && !s.info).length * COST.trustSignal;
  score -= citability.filter(c => !c.ok && !c.info).length * COST.quotable;
  score = Math.max(0, Math.min(100, score));
  return { score, level: score >= 80 ? "good" : score >= 50 ? "warn" : "bad" };
}
