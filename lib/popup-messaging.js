/**
 * Send a runtime message to the service worker, with one retry after a short
 * backoff in case the worker is still starting. A reply of `{error}` is thrown.
 * @param {Object} msg
 * @param {number} [retries=1]
 * @returns {Promise<any>}
 */
export async function sendWithRetry(msg, retries = 1) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await chrome.runtime.sendMessage(msg);
      if (res !== undefined) {
        if (res && typeof res === "object" && res.error && Object.keys(res).length <= 2) throw new Error(res.error);
        return res;
      }
    } catch (e) {
      if (i === retries || !/Receiving end|Could not establish/i.test(e?.message || "")) throw e;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error("The extension's background worker did not answer.");
}

/**
 * Make sure content.js runs in the tab. Needle has no content script on every
 * page: it injects this one only after the user opens the popup (activeTab).
 * content.js guards itself, so injecting it again is harmless.
 * @param {number} tabId
 */
export async function ensureContentScript(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
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

/**
 * Send a message to the tab's content script, injecting it first when needed.
 * A reply of `{__error}` means the script ran but failed; that is thrown as is,
 * without re-injecting.
 * @param {number} tabId
 * @param {Object} msg
 * @returns {Promise<any>}
 * @throws {Error} when the page can't be read (chrome:// pages, the Web Store, PDFs...)
 */
export async function safeSendTabMessage(tabId, msg) {
  let res;
  try {
    res = await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    try {
      await ensureContentScript(tabId);
      res = await chrome.tabs.sendMessage(tabId, msg);
    } catch (e2) {
      const err = new Error(readablePageError(e2?.message));
      err.cause = e2;
      // The side panel offers "Allow access" for this case.
      err.noAccess = /Cannot access|permission|activeTab/i.test(e2?.message || "");
      throw err;
    }
  }
  if (res && typeof res === "object" && res.__error) throw new Error(res.__error);
  return res;
}
