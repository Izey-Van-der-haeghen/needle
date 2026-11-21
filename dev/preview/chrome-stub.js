/*
 * Preview harness: stands in for the chrome.* APIs so popup.html and
 * options.html run in a normal browser tab, on the fictional demo page in
 * fixtures/riverside.json. serve.js injects this classic script first in <head>.
 *
 * Query parameters:
 *   theme=light|dark|auto   saved theme (default light)
 *   access=0|1              optional site access granted (default 0)
 *   panel=1                 behave as the side panel instead of the popup
 *   welcome=1               show the first-run welcome note
 *   whatsnew=1              show "Needle was updated" (as after an update from 1.0.0)
 *   delay=<ms>              latency of every message (default 150)
 *
 * The preview never fabricates PageSpeed or DataForSEO results: those buttons
 * answer the way the real extension does without an API key or login.
 */
(() => {
  const q = new URLSearchParams(location.search);
  const DELAY = Math.max(0, Number(q.get("delay") ?? 150) || 0);
  const getSync = (url) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, false);
    xhr.send();
    return xhr.status === 200 ? xhr.responseText : null;
  };
  const FX = JSON.parse(getSync("/__preview/fixtures/riverside.json"));
  const MANIFEST = JSON.parse(getSync("/manifest.json"));
  const MESSAGES = JSON.parse(getSync("/_locales/en/messages.json"));
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const later = (fn) => new Promise((resolve, reject) => setTimeout(() => { try { resolve(clone(fn())); } catch (e) { reject(e); } }, DELAY));
  const listeners = () => { const s = new Set(); return { addListener: (f) => s.add(f), removeListener: (f) => s.delete(f), hasListener: (f) => s.has(f), _all: s }; };

  // ----- storage -----
  const globalOnChanged = listeners();
  function area(name, seed) {
    const data = clone(seed) || {};
    const onChanged = listeners();
    const pick = (keys) => {
      if (keys == null) return clone(data);
      if (typeof keys === "string") keys = [keys];
      if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, clone(data[k])]));
      return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, k in data ? clone(data[k]) : d]));
    };
    const emit = (changes) => { onChanged._all.forEach((f) => f(changes, name)); globalOnChanged._all.forEach((f) => f(changes, name)); };
    return {
      get: async (keys) => pick(keys),
      set: async (obj) => { const ch = {}; for (const [k, v] of Object.entries(obj)) { ch[k] = { oldValue: data[k], newValue: clone(v) }; data[k] = clone(v); } emit(ch); },
      remove: async (keys) => { const ch = {}; [].concat(keys).forEach((k) => { if (k in data) { ch[k] = { oldValue: data[k] }; delete data[k]; } }); emit(ch); },
      clear: async () => { Object.keys(data).forEach((k) => delete data[k]); },
      setAccessLevel: async () => {},
      onChanged
    };
  }
  const local = area("local", { popupState: { onboardingDismissed: q.get("welcome") !== "1" }, ...(q.get("whatsnew") === "1" ? { whatsNew: { from: "1.0.0", at: Date.now() } } : {}) });
  const sync = area("sync", { theme: q.get("theme") || "light" });

  // ----- the demo page as the active tab -----
  const TAB = { id: 1, windowId: 1, url: FX.url, title: FX.title, active: true };
  let access = q.get("access") === "1";

  function pageFetchAll(requests) {
    return (requests || []).map((r) => {
      const p = FX.pages[r.url];
      if (!p) return { ok: false, status: 404, url: r.url, redirected: false, headers: { "content-type": "text/html" }, text: "<!doctype html><title>Not found</title>", truncated: false, ms: 20 };
      const max = r.maxBytes || 3 * 1024 * 1024;
      return { ok: p.status < 400, status: p.status, url: r.url, redirected: false, headers: p.headers, text: (p.text || "").slice(0, max), truncated: (p.text || "").length > max, ms: 40 };
    });
  }

  const tabHandlers = {
    ANALYZE_ONPAGE: () => FX.onpage,
    GET_RENDERED: () => FX.rendered,
    GET_MAIN_TEXT: () => FX.main,
    HIGHLIGHT: () => ({ ok: true }),
    HIGHLIGHT_LINKS: () => ({ ok: true, matched: FX.onpage.links.total }),
    UNHIGHLIGHT_LINKS: () => ({ ok: true }),
    HIGHLIGHT_HEADINGS: () => ({ ok: true, count: FX.onpage.headings.length }),
    UNHIGHLIGHT_HEADINGS: () => ({ ok: true }),
    UNHIGHLIGHT_ISSUES: () => ({ ok: true })
  };

  const runtimeHandlers = {
    RUN_PSI: () => ({ error: "PageSpeed Insights needs a free API key. Add one in Settings." }),
    RUN_DFS: () => ({ error: "Add your DataForSEO login in Settings first." }),
    FETCH_SERP: () => ({ error: "Add your DataForSEO login in Settings first." }),
    CHECK_LINKS: () => (access ? { data: FX.onpage.links.details.filter((l) => /^https?:/.test(l.href)).map((l) => ({ url: l.href, status: 200, kind: "ok", finalUrl: l.href, ms: 80 })) } : { error: "needs-permission" }),
    FETCH_IMAGE_SIZES: () => (access ? { data: {} } : { error: "needs-permission" }),
    POPUP_CLOSING: () => ({ ok: true })
  };

  window.chrome = {
    runtime: {
      id: "needle-preview",
      lastError: undefined,
      getURL: (p) => `${location.origin}/${String(p).replace(/^\//, "")}`,
      getManifest: () => clone(MANIFEST),
      openOptionsPage: () => window.open("/options.html", "_blank"),
      sendMessage: (msg) => later(() => (runtimeHandlers[msg?.type] || (() => ({ error: "Unknown message type" })))(msg)),
      onMessage: listeners(),
      onInstalled: listeners(),
      onStartup: listeners()
    },
    tabs: {
      query: async () => [clone(TAB)],
      sendMessage: (_id, msg) => later(() => (tabHandlers[msg?.type] || (() => undefined))(msg)),
      create: async (o) => { window.open(o.url, "_blank"); return { id: 2 }; },
      update: async () => clone(TAB),
      onActivated: listeners(),
      onUpdated: listeners()
    },
    scripting: {
      executeScript: ({ func, args, files }) => later(() => [{ result: files ? undefined : func?.name === "pageFetchAll" ? pageFetchAll(args?.[0]) : undefined }])
    },
    storage: { local, sync, onChanged: globalOnChanged },
    permissions: {
      contains: async () => access,
      request: async () => { access = true; return true; },
      remove: async () => { access = false; return true; },
      onAdded: listeners(),
      onRemoved: listeners()
    },
    extension: { getViews: ({ type } = {}) => (type === "popup" && q.get("panel") !== "1" ? [window] : []) },
    commands: { getAll: async () => [{ name: "_execute_action", shortcut: "⌥⇧N" }] },
    i18n: { getMessage: (k) => MESSAGES[k]?.message || "", getUILanguage: () => "en" },
    action: { setPopup: async () => {}, openPopup: async () => {} },
    sidePanel: { setPanelBehavior: async () => {}, open: async () => {} },
    contextMenus: { create: () => {}, removeAll: (cb) => cb && cb(), onClicked: listeners() }
  };
})();
