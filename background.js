import { runPageSpeed, fetchDataForSeo } from "./lib/offpage.js";
import { fetchSerp } from "./lib/serp.js";
import { checkLinks } from "./lib/link-checker.js";
import { fetchImageSizes } from "./lib/image-sizer.js";
import { cachedCall, cacheKey, clearCache, pageId } from "./lib/cache.js";
import { getSecrets, migrateSecrets, CACHE_PREFIXES_BY_SECRET } from "./lib/settings.js";
import { hasOrigins, ALL_SITES, DATAFORSEO, NEEDS_PERMISSION } from "./lib/permissions.js";
import { UserError, isUnexpected } from "./lib/errors.js";
import { fetchCruxHistory } from "./lib/crux.js";
import { fetchBingPage, BING_ORIGINS } from "./lib/bing.js";

// Content scripts may read chrome.storage by default. Needle's content script
// never needs it, so keep stored API credentials to extension pages only.
function restrictStorage() {
  try { chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" })?.catch?.(() => {}); } catch {}
}
restrictStorage();
chrome.runtime.onStartup?.addListener(restrictStorage);

// A new version must not replay results cached by the old code. A same-version
// reload (development) keeps them, so paid results survive.
chrome.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
  migrateSecrets().catch(() => {});
  if (reason === "update" && previousVersion !== chrome.runtime.getManifest().version) {
    clearCache().catch(() => {});
    // The popup shows "Needle was updated" once, until the user clicks "Got it".
    chrome.storage.local.set({ whatsNew: { from: previousVersion, at: Date.now() } }).catch(() => {});
  }
});

// Keyed results depend on the credentials but their cache key does not: when a key
// changes, drop only the results of that service (a new Bing key keeps paid lookups).
chrome.storage.local.onChanged.addListener((changes) => {
  const prefixes = [...new Set(Object.keys(changes).flatMap((k) => CACHE_PREFIXES_BY_SECRET[k] || []))];
  if (prefixes.length) clearCache(prefixes).catch((e) => console.error("[Needle cache]", e));
});

// ---------------------------------------------------------------------------
// Side panel mode and the right-click menu
// ---------------------------------------------------------------------------

async function applyPanelMode() {
  const { openInSidePanel = false } = await chrome.storage.sync.get("openInSidePanel");
  // Needle opens the panel itself (action.onClicked below), so a click on the
  // toolbar button can also tell an open panel to audit the tab.
  try { await chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: false }); } catch {}
  try { await chrome.action.setPopup({ popup: openInSidePanel ? "" : "popup.html" }); } catch {}
  createMenus(openInSidePanel);
}

/**
 * The menu ids carry the mode ("audit:panel"), so a click can open the side
 * panel at once: Chrome only allows sidePanel.open() while the click is being
 * handled, before any await.
 */
function createMenus(panel) {
  const mode = panel ? "panel" : "popup";
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: `audit:${mode}`, title: "Audit this page with Needle", contexts: ["page"], documentUrlPatterns: ["http://*/*", "https://*/*"] });
    chrome.contextMenus.create({ id: `compare:${mode}`, title: "Compare this link's page with Needle", contexts: ["link"], targetUrlPatterns: ["http://*/*", "https://*/*"] });
  });
}

chrome.runtime.onInstalled.addListener(() => { applyPanelMode(); });
chrome.runtime.onStartup?.addListener(applyPanelMode);
chrome.storage.sync.onChanged.addListener((changes) => { if ("openInSidePanel" in changes) applyPanelMode(); });

/** Side panel mode: open the panel and have it audit this tab. Call it before any await. */
function openPanel(tab) {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch((e) => console.error("[Needle] could not open the side panel", e));
  // A panel that is already open audits the tab now; one that is opening audits it by itself.
  chrome.runtime.sendMessage({ type: "AUDIT_TAB", tabId: tab.id, windowId: tab.windowId }).catch(() => {});
}

// Fires only in side panel mode: in popup mode the toolbar button opens popup.html.
chrome.action.onClicked.addListener((tab) => { if (tab?.id) openPanel(tab); });

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  const [kind, mode] = String(info.menuItemId).split(":");
  if (mode === "panel") openPanel(tab);
  else chrome.action.openPopup({ windowId: tab.windowId }).catch((e) => console.error("[Needle] could not open", e));
  if (kind === "compare" && info.linkUrl) {
    // The open view picks this up (storage.onChanged), or reads it when it starts.
    chrome.storage.local.set({ pendingCompare: { url: info.linkUrl, ts: Date.now() } }).catch(() => {});
  }
});

// Requests a view (popup or side panel) started stop when that view closes:
// each view holds a port named "view:<id>" and sends its id with the request.
const pending = new Map(); // AbortController -> view id
const viewPorts = new Map(); // view id -> port, for progress messages
async function withController(viewId, fn) {
  const ctrl = new AbortController();
  pending.set(ctrl, viewId || "");
  try {
    return await fn(ctrl.signal);
  } finally {
    pending.delete(ctrl);
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith("view:") || !fromExtensionPage(port.sender)) return;
  const viewId = port.name.slice(5);
  viewPorts.set(viewId, port);
  port.onDisconnect.addListener(() => {
    viewPorts.delete(viewId);
    for (const [ctrl, v] of pending) if (v === viewId) ctrl.abort();
  });
});

/** Only Needle's own pages (popup, settings) may use the worker; web pages may not. */
function fromExtensionPage(sender) {
  return sender?.id === chrome.runtime.id && typeof sender.url === "string" &&
    sender.url.startsWith(chrome.runtime.getURL(""));
}

const handlers = {
  async RUN_PSI(msg) {
    const { psiKey } = await getSecrets();
    // Google gives keyless requests no quota, so don't send the URL anywhere without a key.
    if (!psiKey) throw new UserError("PageSpeed Insights needs a free API key. Add one in Settings.");
    // Not tied to one view: two views may share this request, and the result is cached.
    return cachedCall(cacheKey("psi", pageId(msg.url)), () => runPageSpeed(pageId(msg.url), psiKey), { force: !!msg.force });
  },

  async RUN_DFS(msg) {
    const { dfsLogin, dfsPassword } = await getSecrets();
    if (!dfsLogin || !dfsPassword) throw new UserError("Add your DataForSEO login in Settings first.");
    if (!(await hasOrigins(DATAFORSEO))) return { error: NEEDS_PERMISSION, origins: DATAFORSEO };
    const url = pageId(msg.url);
    // Not tied to the popup: a paid lookup finishes and is cached even if the popup closes.
    return cachedCall(
      cacheKey("dfs", `${url}|${msg.locationCode}|${msg.languageCode}`),
      () => fetchDataForSeo(url, dfsLogin, dfsPassword, msg.locationCode, msg.languageCode),
      { force: !!msg.force }
    );
  },

  async RUN_CRUX(msg) {
    const { psiKey } = await getSecrets();
    if (!psiKey) throw new UserError("The trend needs a Google API key. Add one in Settings.");
    const formFactor = msg.formFactor === "DESKTOP" ? "DESKTOP" : "PHONE";
    return cachedCall(cacheKey("crux", `${pageId(msg.url)}|${formFactor}`), () => fetchCruxHistory(pageId(msg.url), psiKey, { formFactor }), { force: !!msg.force });
  },

  async RUN_BING(msg) {
    const { bingKey } = await getSecrets();
    if (!bingKey) throw new UserError("Add your Bing Webmaster Tools API key in Settings first.");
    if (!(await hasOrigins(BING_ORIGINS))) return { error: NEEDS_PERMISSION, origins: BING_ORIGINS };
    return cachedCall(cacheKey("bing", pageId(msg.url)), () => fetchBingPage(pageId(msg.url), bingKey), { force: !!msg.force });
  },

  async FETCH_SERP(msg) {
    const creds = await getSecrets();
    if (!(await hasOrigins(DATAFORSEO))) return { error: NEEDS_PERMISSION, origins: DATAFORSEO };
    const p = msg.params || {};
    return cachedCall(
      cacheKey("serp", `${p.keyword}|${p.locationCode}|${p.languageCode}|${p.device}`),
      () => fetchSerp(p, creds),
      { force: !!msg.force }
    );
  },

  async CHECK_LINKS(msg) {
    if (!(await hasOrigins(ALL_SITES))) return { error: NEEDS_PERMISSION, origins: ALL_SITES };
    // A link to a host that doesn't answer takes up to 16 s: tell the view how far the check is.
    const progress = (done, total) => { try { viewPorts.get(msg.viewId)?.postMessage({ type: "progress", task: "links", done, total }); } catch {} };
    return { data: await withController(msg.viewId, signal => checkLinks(msg.urls || [], signal, msg.pageUrl, progress)) };
  },

  async FETCH_IMAGE_SIZES(msg) {
    if (!(await hasOrigins(ALL_SITES))) return { error: NEEDS_PERMISSION, origins: ALL_SITES };
    return { data: await withController(msg.viewId, signal => fetchImageSizes(msg.urls || [], signal, msg.pageUrl)) };
  }
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!fromExtensionPage(sender)) return false;
  const handler = Object.hasOwn(handlers, msg?.type) ? handlers[msg.type] : null;
  if (!handler) {
    sendResponse({ error: "Unknown message type: " + msg?.type });
    return false;
  }
  handler(msg)
    .then(res => sendResponse(res))
    .catch(e => {
      // Expected problems (no key, quota, network) are shown in the popup; only bugs are logged.
      if (isUnexpected(e)) console.error("[Needle]", e);
      sendResponse({ error: e?.message || String(e) });
    });
  return true;
});
