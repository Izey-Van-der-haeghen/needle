import { isContentImage } from "./image-rules.js";
/**
 * "What changed since the last audit": a small snapshot of the fields people
 * edit and break, kept per URL on this device.
 */

const SNAPSHOT_FIELDS = [
  ["title", "Title"],
  ["description", "Meta description"],
  ["h1", "H1"],
  ["canonical", "Canonical"],
  ["robots", "Robots meta"],
  ["lang", "Language"],
  ["status", "HTTP status"],
  ["xRobotsTag", "X-Robots-Tag"],
  ["schemaTypes", "Structured data types"],
  ["hreflangCount", "Hreflang links"],
  ["headingCount", "Headings"],
  ["wordCount", "Words in the main content"],
  ["imagesWithoutAlt", "Images without alt"],
  ["score", "Checklist score"]
];

const MAX_URLS = 200;

// 2: robots metas carry their crawler's name (googlebot:, bingbot:), and heading text is what the
// page shows. A snapshot from before reads differently without anything having changed.
const SNAPSHOT_VERSION = 2;

/**
 * @param {Object} onpage
 * @param {Object|null} tech
 * @param {number|null} score
 * @returns {Record<string, string|number>}
 */
export function snapshotOf(onpage, tech, score = null) {
  const h1 = (onpage.headings || []).filter((h) => h.level === 1 && !h.hidden).map((h) => h.text).join(" | ");
  return {
    v: SNAPSHOT_VERSION,
    title: onpage.title || "",
    description: onpage.description || "",
    h1,
    canonical: onpage.canonical || "",
    robots: onpage.robots || "",
    lang: onpage.lang || "",
    status: tech?.status || null,
    xRobotsTag: tech?.headers?.["x-robots-tag"] || "",
    schemaTypes: [...new Set((onpage.schema || []).map((s) => s.type).filter(Boolean))].sort().join(", "),
    hreflangCount: (onpage.hreflang || []).length,
    headingCount: (onpage.headings || []).length,
    wordCount: onpage.mainContentWordCount ?? onpage.wordCount ?? 0,
    imagesWithoutAlt: (onpage.images || []).filter((i) => isContentImage(i) && (i.altMissing ?? !i.alt)).length,
    score
  };
}

/** Small word-count and score moves are noise, not changes. */
function meaningful(field, a, b) {
  if (a === b) return false;
  if (a == null || b == null) return a !== b && !(field === "status" && (a == null || b == null));
  if (field === "wordCount") return Math.abs(a - b) >= Math.max(20, 0.1 * Math.max(a, b));
  if (field === "score") return Math.abs(a - b) >= 3;
  return true;
}

/**
 * @param {Record<string, any>} before
 * @param {Record<string, any>} after
 * @returns {Array<{field: string, label: string, before: any, after: any}>}
 */
export function diffSnapshots(before, after) {
  if (!before || !after) return [];
  return SNAPSHOT_FIELDS
    .filter(([f]) => meaningful(f, before[f], after[f]))
    .map(([field, label]) => ({ field, label, before: before[field], after: after[field] }));
}

/**
 * Record a new snapshot and return what changed. The store keeps, per URL, the
 * latest snapshot and the one before the last change, so reopening the popup
 * keeps showing the most recent change.
 * @param {Record<string, any>} store - {[url]: {snap, ts, prev, prevTs}}
 * @param {string} id - URL without #fragment
 * @param {Record<string, any>} snap
 * @param {number} now
 * @returns {{store: Record<string, any>, changes: Array, since: number|null}}
 */
export function recordSnapshot(store, id, snap, now) {
  const next = { ...(store || {}) };
  const entry = next[id];
  let result;
  if (!entry || entry.snap?.v !== snap.v) {
    next[id] = { snap, ts: now, prev: null, prevTs: null };
    result = { changes: [], since: null };
  } else {
    const fresh = diffSnapshots(entry.snap, snap);
    if (fresh.length) {
      next[id] = { snap, ts: now, prev: entry.snap, prevTs: entry.ts };
      result = { changes: fresh, since: entry.ts };
    } else {
      // Keep the baseline: small steps below the noise threshold add up to a change in the end.
      next[id] = { ...entry, seen: now };
      result = { changes: entry.prev ? diffSnapshots(entry.prev, entry.snap) : [], since: entry.prevTs };
    }
  }
  const ids = Object.keys(next);
  if (ids.length > MAX_URLS) {
    ids.sort((a, b) => (next[a].seen || next[a].ts) - (next[b].seen || next[b].ts)).slice(0, ids.length - MAX_URLS).forEach((k) => delete next[k]);
  }
  return { store: next, ...result };
}
