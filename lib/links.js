/** Public links for Needle. */

export const REPO_URL = "https://github.com/Izey-Van-der-haeghen/needle";

/**
 * The Chrome Web Store page, but only when Needle was installed from the store:
 * then its extension ID is the store ID. A copy loaded unpacked has another ID,
 * so it gets no store link (null).
 * @returns {Promise<string|null>}
 */
export async function storeUrl() {
  try {
    const self = await chrome.management?.getSelf?.();
    if (self?.installType === "normal") return `https://chromewebstore.google.com/detail/${chrome.runtime.id}`;
  } catch {}
  return null;
}
