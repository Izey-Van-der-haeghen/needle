import { readablePageError } from "./errors.js";

export { readablePageError };
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
