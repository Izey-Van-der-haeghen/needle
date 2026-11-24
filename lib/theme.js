/**
 * Theme for the popup, the settings page and the HTML report.
 *
 * Saved preference: "auto" (follow the system), "light" or "dark".
 * The resolved value goes on <html data-theme>. The preference is mirrored in
 * localStorage so theme-boot.js can apply it before the first paint (no light
 * flash for dark-mode users); chrome.storage.sync stays the source of truth.
 */

const STORAGE_KEY = "theme";
const MIRROR_KEY = "needle-theme";
const PREF_QUERY = "(prefers-color-scheme: dark)";

const THEMES = ["auto", "light", "dark"];

function resolveTheme(saved) {
  if (saved === "dark" || saved === "light") return saved;
  try {
    return matchMedia(PREF_QUERY).matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

function applyTheme(resolved) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolved;
}

function mirror(saved) {
  try { localStorage.setItem(MIRROR_KEY, saved); } catch {}
}

let mqlListener = null;

/**
 * Read the saved preference, apply it, and follow system changes in auto mode.
 * @returns {Promise<"auto"|"light"|"dark">}
 */
export async function initTheme() {
  const { [STORAGE_KEY]: saved = "auto" } = await chrome.storage.sync.get(STORAGE_KEY);
  applyTheme(resolveTheme(saved));
  mirror(saved);
  try {
    const mql = matchMedia(PREF_QUERY);
    if (mqlListener) mql.removeEventListener("change", mqlListener);
    mqlListener = (e) => {
      chrome.storage.sync.get(STORAGE_KEY).then(({ [STORAGE_KEY]: cur = "auto" }) => {
        if (cur === "auto") applyTheme(e.matches ? "dark" : "light");
      });
    };
    mql.addEventListener("change", mqlListener);
  } catch {}
  return saved;
}

/**
 * Save and apply a preference.
 * @param {string} value
 * @returns {Promise<"auto"|"light"|"dark">}
 */
export async function setTheme(value) {
  const normalised = THEMES.includes(value) ? value : "auto";
  await chrome.storage.sync.set({ [STORAGE_KEY]: normalised });
  applyTheme(resolveTheme(normalised));
  mirror(normalised);
  return normalised;
}
