import { CACHE_MAX_ENTRIES, CACHE_MAX_BYTES } from "./constants.js";
import { withStoreLock } from "./store-lock.js";

/** How long each kind of result stays fresh. */
export const TTL = {
  onpage: 5 * 60 * 1000,
  technical: 15 * 60 * 1000,
  rendered: 15 * 60 * 1000,
  psi: 60 * 60 * 1000,
  dfs: 60 * 60 * 1000,
  compare: 15 * 60 * 1000,
  serp: 30 * 60 * 1000,
  linkcheck: 60 * 60 * 1000,
  llms: 60 * 60 * 1000,
  crux: 12 * 60 * 60 * 1000,
  bing: 6 * 60 * 60 * 1000
};

const DEFAULT_TTL = 5 * 60 * 1000;

/** Has a cache entry outlived its TTL? */
export const isExpired = (key, ts, now = Date.now()) => now - ts > (TTL[String(key).split("::")[0]] || DEFAULT_TTL);

/**
 * Build a cache key from a type and an identifier.
 * @param {string} type - one of the TTL keys
 * @param {string} id - URL, or keyword|location|language|device for SERP
 * @returns {string}
 */
export function cacheKey(type, id) {
  return `${type}::${id}`;
}

/**
 * Cache identifier for a page URL: no #fragment, which never reaches a server.
 * @param {string} url
 */
export function pageId(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  } catch {
    return String(url || "");
  }
}

/**
 * Read a cache entry if it is still fresh.
 * @param {string} key
 * @returns {Promise<{data: *, age: number, ts: number}|null>}
 */
export async function getCache(key) {
  const { _cache = {} } = await chrome.storage.local.get("_cache");
  const entry = _cache[key];
  if (!entry || isExpired(key, entry.ts)) return null;
  return { data: entry.data, age: Date.now() - entry.ts, ts: entry.ts };
}

const PAID_PREFIXES = ["dfs::", "serp::"];
const isPaid = (key) => PAID_PREFIXES.some((p) => key.startsWith(p));

/**
 * Keep the newest fresh entries (paid ones first), at most CACHE_MAX_ENTRIES and about
 * CACHE_MAX_BYTES of JSON, so the cache can't fill Chrome's storage quota.
 * @param {Record<string, {data: *, ts: number}>} cache
 * @param {number} [maxBytes]
 * @returns {Record<string, {data: *, ts: number}>}
 */
const utf8 = new TextEncoder();

export function pruneCache(cache, maxBytes = CACHE_MAX_BYTES, keepKey = null) {
  const kept = [];
  let bytes = 0;
  const entries = Object.entries(cache)
    // Expired entries would otherwise hold storage quota until newer ones push them out.
    .filter(([k, v]) => !isExpired(k, v.ts))
    // The entry just written first, then paid results: free ones (a side panel following
    // tabs) must not push them out.
    .sort((a, b) => ((b[0] === keepKey) - (a[0] === keepKey)) || (isPaid(b[0]) - isPaid(a[0])) || b[1].ts - a[1].ts);
  for (const [k, v] of entries) {
    if (kept.length >= CACHE_MAX_ENTRIES) break;
    // Chrome's quota counts UTF-8 bytes: Japanese text takes three per character.
    const size = utf8.encode(k + JSON.stringify(v)).length;
    if (kept.length && bytes + size > maxBytes) continue; // the first one (the entry just written) always stays
    bytes += size;
    kept.push([k, v]);
  }
  return Object.fromEntries(kept);
}

let writeQueue = Promise.resolve();
/**
 * Write a result. The popup, the side panel and the worker all write the cache,
 * so each write holds a lock shared by every Needle page (and a queue within one).
 * Error replies are never cached: callers pass only successful data.
 * @param {string} key
 * @param {*} data - serialisable
 * @returns {Promise<void>}
 */
export function setCache(key, data) {
  writeQueue = writeQueue.then(() => withStoreLock("cache", async () => {
    const { _cache = {} } = await chrome.storage.local.get("_cache");
    _cache[key] = { data, ts: Date.now() };
    await chrome.storage.local.set({ _cache: pruneCache(_cache, CACHE_MAX_BYTES, key) });
  })).catch(e => { console.error("[Needle cache]", e); });
  return writeQueue;
}

/**
 * Clear the cache, or only the entries whose key starts with one of the prefixes.
 * @param {string|string[]} [prefix]
 */
export async function clearCache(prefix) {
  const all = prefix == null;
  const prefixes = all ? [] : [].concat(prefix);
  if (!all && !prefixes.length) return; // an empty list clears nothing, never everything
  await withStoreLock("cache", async () => {
    if (all) {
      await chrome.storage.local.set({ _cache: {} });
      return;
    }
    const { _cache = {} } = await chrome.storage.local.get("_cache");
    const filtered = Object.fromEntries(Object.entries(_cache).filter(([k]) => !prefixes.some((p) => k.startsWith(p))));
    await chrome.storage.local.set({ _cache: filtered });
  });
}

const inflight = new Map();
/**
 * Run `run` once per key at a time: identical calls made while it is pending
 * share its promise, so a double click or a reopened popup never pays twice.
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} run
 * @returns {Promise<T>}
 */
export function shareInflight(key, run) {
  if (!inflight.has(key)) inflight.set(key, run().finally(() => inflight.delete(key)));
  return inflight.get(key);
}

/**
 * Cached, de-duplicated call: return a fresh cache hit, otherwise run once and
 * cache the result (errors propagate and are not cached).
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} run
 * @param {{force?: boolean}} [opts] - force skips the cache read, not the in-flight share
 * @returns {Promise<{data: T, age: number}>}
 */
export async function cachedCall(key, run, { force = false } = {}) {
  if (!force) {
    const hit = await getCache(key);
    if (hit) return { data: hit.data, age: hit.age };
  }
  const data = await shareInflight(key, run);
  await setCache(key, data);
  return { data, age: 0 };
}

/**
 * Short human-readable age.
 * @param {number} ms
 * @returns {string} e.g. "30s ago", "5 min ago", "2 h ago"
 */
export function formatAge(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}
