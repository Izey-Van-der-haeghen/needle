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
