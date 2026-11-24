/**
 * Settings storage.
 *
 * API credentials live in chrome.storage.local only: they stay on this device
 * and are never synced to the user's Google account. Preferences (theme,
 * default market) use chrome.storage.sync so they follow the user.
 */

export const SECRET_KEYS = ["dfsLogin", "dfsPassword", "psiKey", "bingKey"];
/** Cached results that depend on each secret, dropped when that secret changes. */
export const CACHE_PREFIXES_BY_SECRET = {
  dfsLogin: ["dfs::", "serp::"],
  dfsPassword: ["dfs::", "serp::"],
  psiKey: ["psi::", "crux::"],
  bingKey: ["bing::"]
};
export const PREF_KEYS = ["defaultLocation", "defaultLanguage", "imgMaxKB", "imgWidth", "imgHeight", "imgMode"];

/** Default market for SERP and keyword lookups when the page's domain gives no hint. */
export const DEFAULT_LOCATION = 2840; // United States
export const DEFAULT_LANGUAGE = "en";

/**
 * Move credentials an older version stored in chrome.storage.sync to
 * chrome.storage.local, then delete them from sync. Safe to call often.
 */
export async function migrateSecrets() {
  const synced = await chrome.storage.sync.get(SECRET_KEYS);
  const found = SECRET_KEYS.filter(k => synced[k]);
  if (!found.length) return;
  const local = await chrome.storage.local.get(SECRET_KEYS);
  const toSet = {};
  for (const k of found) if (!local[k]) toSet[k] = synced[k];
  if (Object.keys(toSet).length) await chrome.storage.local.set(toSet);
  await chrome.storage.sync.remove(found);
}

/** @returns {Promise<{dfsLogin?: string, dfsPassword?: string, psiKey?: string}>} */
export async function getSecrets() {
  await migrateSecrets();
  return chrome.storage.local.get(SECRET_KEYS);
}

/** @param {{dfsLogin?: string, dfsPassword?: string, psiKey?: string}} values */
export async function setSecrets(values) {
  const clean = {};
  for (const k of SECRET_KEYS) if (k in values) clean[k] = String(values[k] || "").trim();
  await chrome.storage.local.set(clean);
}

/** @returns {Promise<{defaultLocation: number, defaultLanguage: string}>} */
export async function getPrefs() {
  const p = await chrome.storage.sync.get(PREF_KEYS);
  return {
    defaultLocation: parseInt(p.defaultLocation, 10) || DEFAULT_LOCATION,
    defaultLanguage: p.defaultLanguage || DEFAULT_LANGUAGE
  };
}

/** Image size rules from Settings (see lib/image-rules.js). */
export async function getImageRules() {
  const { normaliseImageRules } = await import("./image-rules.js");
  return normaliseImageRules(await chrome.storage.sync.get(["imgMaxKB", "imgWidth", "imgHeight", "imgMode"]));
}

/**
 * Saved popup state without the country and language picked per website: "Clear history" also
 * forgets which sites the user audited there (the privacy policy says so).
 * @param {Object} state - popupState
 * @returns {Object} a copy
 */
export function withoutSiteChoices(state) {
  const rest = { ...(state || {}) };
  for (const k of SITE_CHOICE_KEYS) delete rest[k];
  return rest;
}

/** The popupState keys that name a website: "Clear history" forgets them too. */
export const SITE_CHOICE_KEYS = ["marketByHost", "serpMarketByHost"];
