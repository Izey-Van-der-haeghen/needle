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
/** The theme choices in Settings. */
export const THEMES = ["auto", "light", "dark"];

export const PREF_KEYS = ["defaultLocation", "defaultLanguage", "imgMaxKB", "imgWidth", "imgHeight", "imgMode"];

/** Default market for SERP and keyword lookups when the page's domain gives no hint. */
export const DEFAULT_LOCATION = 2840; // United States
const DEFAULT_LANGUAGE = "en";

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

/**
 * The popupState keys that hold the country and language picked per website: "Clear history" forgets
 * them too. Other inputs that name a website are kept: the addresses typed in Compare (which has its
 * own Clear button) and the domain typed in SERP's "Find my site".
 */
export const SITE_CHOICE_KEYS = ["marketByHost", "serpMarketByHost"];

/** A whole number from 1 to 99999, as the image fields in Settings take (spaces around it allowed). */
export function isWholeNumber(v) {
  return /^[1-9]\d{0,4}$/.test(String(v ?? "").trim());
}

/**
 * What a settings file may set, value by value, with the same checks as the Settings form: a
 * country or language Needle offers, whole numbers from 1, an image size with both numbers in the
 * file (never mixed with what is stored), and known choices. Anything else is skipped and counted.
 * @param {*} payload - the file's settings; anything but an object holds none
 * @param {{locations: Array<{code: number}>, languages: Array<{code: string}>}} lists
 * @returns {{prefs: Object, secrets: Object, skipped: number}}
 */
export function readSettingsFile(payload, { locations, languages }) {
  const prefs = {};
  const secrets = {};
  let skipped = 0;
  // "settings" as a string, a number, true or a list holds no settings: nothing to read.
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { prefs, secrets, skipped };
  // A known setting of the wrong type (a number where the form saves text) is skipped and counted too.
  const take = (keys, type, into) => {
    for (const k of keys) {
      if (!(k in payload)) continue;
      if (typeof payload[k] === type) into[k] = payload[k];
      else skipped++;
    }
  };
  take([...PREF_KEYS, "theme", "csvSeparator"], "string", prefs);
  take(["popupShortcuts", "openInSidePanel"], "boolean", prefs);
  take(SECRET_KEYS, "string", secrets);
  const drop = (k) => { delete prefs[k]; skipped++; };
  if ("defaultLocation" in prefs && !locations.some((l) => String(l.code) === prefs.defaultLocation)) drop("defaultLocation");
  if ("defaultLanguage" in prefs && !languages.some((l) => String(l.code) === prefs.defaultLanguage)) drop("defaultLanguage");
  const whole = isWholeNumber;
  if ("imgMaxKB" in prefs && prefs.imgMaxKB !== "" && !whole(prefs.imgMaxKB)) drop("imgMaxKB");
  if ("imgWidth" in prefs || "imgHeight" in prefs) {
    const both = (prefs.imgWidth === "" && prefs.imgHeight === "") || (whole(prefs.imgWidth) && whole(prefs.imgHeight));
    if (!both) { delete prefs.imgWidth; delete prefs.imgHeight; skipped++; }
  }
  if ("imgMode" in prefs && !["exact", "ratio"].includes(prefs.imgMode)) drop("imgMode");
  if ("theme" in prefs && !THEMES.includes(prefs.theme)) drop("theme");
  if ("csvSeparator" in prefs && ![",", ";"].includes(prefs.csvSeparator)) drop("csvSeparator");
  return { prefs, secrets, skipped };
}
