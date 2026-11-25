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
// 3: text fields and the URL are cut (snapText), so a long one from before would read as changed.
const SNAPSHOT_VERSION = 3;

// The audited page controls the text fields and its own URL (history.replaceState), and the store
// keeps two snapshots for each of MAX_URLS pages in Chrome's 10 MB, beside the 4 MB cache. Each is
// cut to TEXT_MAX code points, and Chrome counts "<", U+2028 and U+2029 as six bytes each
// (\uXXXX). So the worst case is 200 x (URL + 2 x 8 fields) x 200 x 6 bytes, plus the field
// names: 4.2 MB (tests/aikido-data-snapshots.test.js builds it).
const TEXT_MAX = 200;

/** Code points in `text`: a surrogate pair is one. */
function countPoints(text) {
  let n = text.length;
  for (let i = 0; i < text.length - 1; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { n--; i++; }
    }
  }
  return n;
}

/** A 32-bit FNV-1a fingerprint of `text` in base 36: it tells texts apart, it isn't secret. */
function fingerprint(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/**
 * Text cut at TEXT_MAX code points, with "…" when something was cut. 200 is also where content.js
 * cuts a heading.
 * @param {*} s
 * @returns {string}
 */
export function clipText(s) {
  const text = String(s ?? "");
  if (text.length <= TEXT_MAX) return text;
  // Only the start is split into code points (at most two units each): splitting all of a 3 MB
  // title would make millions of strings.
  const points = Array.from(text.slice(0, 2 * TEXT_MAX + 1));
  return points.length > TEXT_MAX ? `${points.slice(0, TEXT_MAX).join("")}…` : text;
}

/**
 * Page text as a snapshot keeps it: at most TEXT_MAX code points in all. Longer text keeps its
 * start, then "…", its length and a fingerprint of all of it, so an edit after the cut (the end of a
 * long meta description or canonical) still reads as a change.
 * @param {*} s
 * @returns {string}
 */
export function snapText(s) {
  const text = String(s ?? "");
  if (text.length <= TEXT_MAX) return text;
  const points = countPoints(text);
  if (points <= TEXT_MAX) return text;
  const tail = ` (${points} characters, ${fingerprint(text)})`;
  const head = TEXT_MAX - 1 - tail.length;
  return `${Array.from(text.slice(0, 2 * head)).slice(0, head).join("")}…${tail}`;
}

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
    title: snapText(onpage.title),
    description: snapText(onpage.description),
    h1: snapText(h1),
    canonical: snapText(onpage.canonical),
    robots: snapText(onpage.robots),
    lang: snapText(onpage.lang),
    status: tech?.status || null,
    xRobotsTag: snapText(tech?.headers?.["x-robots-tag"]),
    schemaTypes: snapText([...new Set((onpage.schema || []).map((s) => s.type).filter(Boolean))].sort().join(", ")),
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
 * @param {Record<string, any>} store - {[snapText(url)]: {snap, ts, prev, prevTs}}
 * @param {string} url - without #fragment; stored cut like the text (snapText)
 * @param {Record<string, any>} snap
 * @param {number} now
 * @returns {{store: Record<string, any>, changes: Array, since: number|null}}
 */
export function recordSnapshot(store, url, snap, now) {
  const id = snapText(url);
  const next = { ...(store || {}) };
  // A snapshot from another version is never compared again. Drop them all at once: one from
  // before the cut could hold megabytes of a page's text.
  for (const k of Object.keys(next)) if (k !== id && next[k]?.snap?.v !== snap.v) delete next[k];
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
