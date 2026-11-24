/**
 * A run button that works once at a time: while `run` runs, the button stays focusable but
 * ignores clicks (aria-disabled, styled as busy in base.css), so a second click doesn't start
 * it again.
 * @param {HTMLElement} btn
 * @param {(...args: any[]) => any} run
 * @returns {(...args: any[]) => Promise<void>} the click handler
 */
export function whileBusy(btn, run) {
  return async (...args) => {
    if (btn.getAttribute("aria-disabled") === "true") return;
    btn.setAttribute("aria-disabled", "true");
    try { await run(...args); } finally { btn.removeAttribute("aria-disabled"); }
  };
}
