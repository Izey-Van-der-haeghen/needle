/**
 * Optional host permissions. Needle installs with no access to any website.
 * Features that must reach other sites ask for access the first time they are used.
 */

/** Links, competitor pages and image sizes on other sites. */
export const ALL_SITES = ["https://*/*", "http://*/*"];
/** DataForSEO API (keyword and SERP lookups with the user's own account). */
export const DATAFORSEO = ["https://api.dataforseo.com/*"];

/**
 * @param {string[]} origins
 * @returns {Promise<boolean>}
 */
export async function hasOrigins(origins) {
  try { return await chrome.permissions.contains({ origins }); } catch { return false; }
}

/**
 * Ask for host access. Must be called from a click handler (user gesture).
 * @param {string[]} origins
 * @returns {Promise<boolean>} granted
 */
export async function requestOrigins(origins) {
  try { return await chrome.permissions.request({ origins }); } catch { return false; }
}

/**
 * Give back host access the user no longer wants.
 * @param {string[]} origins
 */
export async function removeOrigins(origins) {
  try { return await chrome.permissions.remove({ origins }); } catch { return false; }
}

/** Error code a background reply carries when a feature lacks its permission. */
export const NEEDS_PERMISSION = "needs-permission";
