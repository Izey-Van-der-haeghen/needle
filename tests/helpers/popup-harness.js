// Loads the real popup.html, theme-boot.js and popup.js into the jsdom of a test file
// (// @vitest-environment jsdom), with a chrome stub adapted from dev/preview/chrome-stub.js
// and the demo fixture. No network. One popup per test file: popup.js is a module and runs once.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Paths, not URL objects: in a jsdom test the global URL is jsdom's, which node:fs refuses.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f) => readFileSync(path.join(ROOT, f), "utf8");

/**
 * @param {{panel?: boolean, activeTab?: string|null, local?: Object}} [opts] - panel: behave as the side panel;
 *   activeTab: a tab saved from an earlier visit ("technical", "ai" …); local: more chrome.storage.local data;
 *   onpage: fields to change in the demo page's ANALYZE_ONPAGE answer;
 *   unreadable: a Chrome error text, to act as a tab Needle can't read (no internet, the Web Store …)
 * @returns {Promise<{markedBeforePopupJs: boolean, storage: Object}>} whether theme-boot.js marked the side
 *   panel, and the stubbed chrome.storage (to read what the popup saved)
 */
export async function loadPopup({ panel = false, activeTab = null, local = {}, onpage = {}, unreadable = "" } = {}) {
  history.replaceState(null, "", "/popup.html");
  const inner = read("popup.html").replace(/^[\s\S]*?<html[^>]*>/i, "").replace(/<\/html>[\s\S]*$/i, "").replace(/<script[\s\S]*?<\/script>/gi, "");
  document.documentElement.innerHTML = inner;
  globalThis.matchMedia = window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  globalThis.requestAnimationFrame ??= (f) => setTimeout(f, 0);
  // jsdom has no canvas; Needle measures snippet widths with one.
  HTMLCanvasElement.prototype.getContext = () => ({ font: "", measureText: (t) => ({ width: String(t).length * 8 }) });

  const FX = JSON.parse(read("dev/preview/fixtures/riverside.json"));
  const MANIFEST = JSON.parse(read("manifest.json"));
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const later = (fn) => new Promise((res, rej) => setTimeout(() => { try { res(clone(fn())); } catch (e) { rej(e); } }, 0));
  const listeners = () => { const s = new Set(); return { addListener: (f) => s.add(f), removeListener: (f) => s.delete(f), hasListener: (f) => s.has(f), _all: s }; };
  const area = (seed) => {
    const data = clone(seed) || {};
    const pick = (keys) => {
      if (keys == null) return clone(data);
      if (typeof keys === "string") keys = [keys];
      if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, clone(data[k])]));
      return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, k in data ? clone(data[k]) : d]));
    };
    return { get: async (k) => pick(k), set: async (o) => { Object.assign(data, clone(o)); }, remove: async (ks) => { [].concat(ks).forEach((k) => delete data[k]); }, clear: async () => {}, setAccessLevel: async () => {}, onChanged: listeners() };
  };
  const TAB = { id: 1, windowId: 1, url: FX.url, title: FX.title, active: true };
  const tabHandlers = { ANALYZE_ONPAGE: () => ({ ...FX.onpage, ...onpage }), GET_RENDERED: () => FX.rendered, GET_MAIN_TEXT: () => FX.main };
  globalThis.chrome = window.chrome = {
    runtime: { id: "test", getURL: (p) => `${location.origin}/${p}`, getManifest: () => clone(MANIFEST), openOptionsPage() {},
      sendMessage: (m) => later(() => ({ error: "test: " + m?.type })), onMessage: listeners(), onInstalled: listeners(), onStartup: listeners() },
    tabs: { query: async () => [clone(TAB)], get: async () => clone(TAB),
      sendMessage: (_i, m) => (unreadable ? Promise.reject(new Error("Could not establish connection. Receiving end does not exist.")) : later(() => (tabHandlers[m?.type] || (() => undefined))(m))), create: async () => ({ id: 2 }), update: async () => clone(TAB), onActivated: listeners(), onUpdated: listeners() },
    windows: { getCurrent: async () => ({ id: 1 }) },
    scripting: { executeScript: () => (unreadable ? Promise.reject(new Error(unreadable)) : later(() => [{ result: undefined }])) },
    storage: { local: area({ popupState: { onboardingDismissed: true, ...(activeTab ? { activeTab } : {}) }, ...local }), sync: area({ theme: "light" }), onChanged: listeners() },
    permissions: { contains: async () => false, request: async () => false, remove: async () => true, onAdded: listeners(), onRemoved: listeners() },
    extension: { getViews: ({ type } = {}) => (type === "popup" && !panel ? [window] : []) },
    commands: { getAll: async () => [] },
    i18n: { getMessage: () => "", getUILanguage: () => "en" },
    action: { setPopup: async () => {}, openPopup: async () => {} },
    sidePanel: { setPanelBehavior: async () => {}, open: async () => {} },
    contextMenus: { create() {}, removeAll: (cb) => cb && cb(), onClicked: listeners() }
  };
  (0, eval)(read("theme-boot.js"));
  const markedBeforePopupJs = document.documentElement.classList.contains("side-panel");
  await import(pathToFileURL(path.join(ROOT, "popup.js")).href);
  // Wait until the On-page tab shows something (an audit, a notice or an error), at most 3 s.
  for (let t = 0; t < 300 && !document.querySelector("#panel-onpage > *:not(.loading)"); t++) await new Promise((r) => setTimeout(r, 10));
  return { markedBeforePopupJs, storage: globalThis.chrome.storage };
}
