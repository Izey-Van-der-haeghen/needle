// Loads the real options.html and options.js (the Settings page) into the jsdom of a test file
// (// @vitest-environment jsdom), with a chrome stub. No network: stub fetch in the test.
// One Settings page per test file: options.js is a module and runs once.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Paths, not URL objects: in a jsdom test the global URL is jsdom's, which node:fs refuses.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f) => readFileSync(path.join(ROOT, f), "utf8");

/**
 * @param {Object} [opts]
 * @param {Object} [opts.local] - chrome.storage.local data (keys, popupState, history …)
 * @param {Object} [opts.sync] - more chrome.storage.sync data
 * @param {boolean} [opts.allowed] - Chrome grants the host access Settings asks for (DataForSEO, Bing)
 * @returns {Promise<{storage: Object}>} the stubbed chrome.storage, once options.js has finished loading
 */
export async function loadOptions({ local = {}, sync = {}, allowed = true } = {}) {
  history.replaceState(null, "", "/options.html");
  document.documentElement.innerHTML = read("options.html").replace(/^[\s\S]*?<html[^>]*>/i, "").replace(/<\/html>[\s\S]*$/i, "").replace(/<script[\s\S]*?<\/script>/gi, "");
  globalThis.matchMedia = window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const area = (seed) => {
    const data = clone(seed) || {};
    const pick = (keys) => {
      if (keys == null) return clone(data);
      if (typeof keys === "string") keys = [keys];
      if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, clone(data[k])]));
      return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, k in data ? clone(data[k]) : d]));
    };
    return { get: async (k) => pick(k), set: async (o) => { Object.assign(data, clone(o)); },
      remove: async (ks) => { [].concat(ks).forEach((k) => delete data[k]); }, clear: async () => {} };
  };
  const listener = () => ({ addListener() {}, removeListener() {} });
  globalThis.chrome = window.chrome = {
    runtime: { id: "test", getURL: (p) => `${location.origin}/${p}`, getManifest: () => JSON.parse(read("manifest.json")) },
    storage: { local: area(local), sync: area({ theme: "light", ...sync }) },
    permissions: { contains: async () => allowed, request: async () => allowed, remove: async () => true, onAdded: listener(), onRemoved: listener() },
    commands: { getAll: async () => [] },
    tabs: { create: async () => ({ id: 2 }) }
  };
  (0, eval)(read("theme-boot.js"));
  // options.js ends with a top-level await that fills the form: the import resolves once it is done.
  await import(pathToFileURL(path.join(ROOT, "options.js")).href);
  return { storage: globalThis.chrome.storage };
}
