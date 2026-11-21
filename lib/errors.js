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
