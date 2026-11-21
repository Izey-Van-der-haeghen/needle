/**
 * An expected problem the user can act on (no API key, quota reached, login
 * rejected, site not reachable). Shown in the UI, never logged as an error.
 */
export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = "UserError";
  }
}

/** Is this a bug worth logging, rather than an expected problem or a network hiccup? */
export function isUnexpected(e) {
  if (!e || e instanceof UserError || e.name === "UserError") return false;
  if (e.name === "AbortError" || e.name === "TimeoutError") return false;
  if (e instanceof TypeError && /fetch|network|load failed/i.test(e.message || "")) return false;
  return true;
}

/**
 * What to show for an error. The browser's own network texts ("Failed to fetch") mean nothing
 * to a reader, so they become plain words; any other message is shown as it is.
 * @param {unknown} e
 * @param {{network?: string, timeout?: string}} [words]
 */
export function readableError(e, { network = "Could not connect. Check the internet connection and try again.", timeout = "It took too long. Try again." } = {}) {
  const msg = e?.message || "";
  if (e?.name === "AbortError" || e?.name === "TimeoutError" || /timed out|timeout/i.test(msg)) return timeout;
  if (/failed to fetch|networkerror|load failed|network error/i.test(msg)) return network;
  return msg || network;
}

/**
 * Plain words for why Needle can't read a tab. Chrome's own texts ("Frame with ID 0 is
 * showing error page", "Cannot access contents of url") mean nothing to a reader.
 * @param {string} [raw] - Chrome's error message
 * @returns {string}
 */
export function readablePageError(raw = "") {
  if (/showing error page/i.test(raw)) return "The tab shows an error page instead of the website: no internet connection, or the site didn't answer. Reload the page, then try again.";
  if (/cannot be scripted/i.test(raw)) return "Chrome doesn't let extensions read the Chrome Web Store.";
  if (/Cannot access|permission|activeTab/i.test(raw)) return "Needle may not read this tab yet. Click the Needle button in the toolbar on this tab, or allow access to websites.";
  if (/No tab with id|No frame with id|tab was closed/i.test(raw)) return "The tab was closed or changed. Open the page again, then try again.";
  return "The page didn't answer. Reload it, then try again.";
}
