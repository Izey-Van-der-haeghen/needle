import { describe, it, expect, vi, beforeAll } from "vitest";

// background.js registers listeners on import; capture them with a chrome mock.
let onMessage;
let onConnect;
let onMenuClick;
let onActionClick;
const EXT = "chrome-extension://abc/";
beforeAll(async () => {
  const area = () => ({ get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}), onChanged: { addListener: vi.fn() } });
  globalThis.chrome = {
    runtime: {
      id: "abc",
      getURL: (p) => EXT + p,
      getManifest: () => ({ version: "1.0.0" }),
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onMessage: { addListener: (fn) => { onMessage = fn; } },
      onConnect: { addListener: (fn) => { onConnect = fn; } },
      sendMessage: vi.fn(async () => {})
    },
    storage: { local: area(), sync: area() },
    permissions: { contains: vi.fn(async () => false) },
    contextMenus: { onClicked: { addListener: (fn) => { onMenuClick = fn; } }, removeAll: vi.fn(), create: vi.fn() },
    sidePanel: { setPanelBehavior: vi.fn(async () => {}), open: vi.fn(async () => {}) },
    action: { setPopup: vi.fn(async () => {}), openPopup: vi.fn(async () => {}), onClicked: { addListener: (fn) => { onActionClick = fn; } } }
  };
  await import("../background.js");
});

const send = (msg, sender) => new Promise((resolve) => {
  const async = onMessage(msg, sender, resolve);
  if (!async) resolve("__no_answer__");
});

describe("background message security", () => {
  it("ignores messages from web pages (content scripts)", async () => {
    const res = await send({ type: "CHECK_LINKS", urls: ["http://192.168.1.1/"] }, { id: "abc", url: "https://evil.example/", tab: { id: 1 } });
    expect(res).toBe("__no_answer__");
  });

  it("ignores messages from other extensions", async () => {
    expect(await send({ type: "POPUP_CLOSING" }, { id: "other", url: "chrome-extension://other/popup.html" })).toBe("__no_answer__");
  });

  it("answers Needle's own pages, and asks for site access before checking links", async () => {
    const res = await send({ type: "CHECK_LINKS", urls: ["https://e.com/"] }, { id: "abc", url: EXT + "popup.html" });
    expect(res).toMatchObject({ error: "needs-permission" });
  });

  it("does not run a paid lookup without credentials", async () => {
    const res = await send({ type: "RUN_DFS", url: "https://e.com/", locationCode: 2840, languageCode: "en" }, { id: "abc", url: EXT + "popup.html" });
    expect(res.error).toMatch(/DataForSEO login/);
  });

  it("ignores message types that are not Needle's own handlers", async () => {
    const res = await send({ type: "constructor" }, { id: "abc", url: EXT + "popup.html" });
    expect(res.error).toMatch(/Unknown message type/);
  });

  it("answers a missing API key in the popup without logging an error in chrome://extensions", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const popup = { id: "abc", url: EXT + "popup.html" };
    try {
      for (const type of ["RUN_PSI", "RUN_CRUX", "RUN_BING", "RUN_DFS"]) {
        const res = await send({ type, url: "https://e.com/", locationCode: 2840, languageCode: "en" }, popup);
        expect(res.error, type).toMatch(/Settings/);
      }
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("side panel and right-click menu", () => {
  it("opens the side panel synchronously, inside the click, and asks it to audit the tab", () => {
    chrome.sidePanel.open.mockClear();
    onMenuClick({ menuItemId: "audit:panel" }, { id: 7, windowId: 3 });
    // Called before any await: Chrome refuses sidePanel.open() once the click is over.
    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ windowId: 3 });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "AUDIT_TAB", tabId: 7, windowId: 3 });
  });

  it("opens the popup in popup mode and hands over the link to compare under its own key", () => {
    chrome.action.openPopup.mockClear();
    chrome.storage.local.set.mockClear();
    onMenuClick({ menuItemId: "compare:popup", linkUrl: "https://rival.example/page" }, { id: 7, windowId: 3 });
    expect(chrome.action.openPopup).toHaveBeenCalledWith({ windowId: 3 });
    const [arg] = chrome.storage.local.set.mock.calls.at(-1);
    expect(arg.pendingCompare.url).toBe("https://rival.example/page");
    expect(arg.popupState).toBeUndefined();
  });

  it("the toolbar button in side panel mode opens the panel at once", () => {
    chrome.sidePanel.open.mockClear();
    onActionClick({ id: 9, windowId: 4 });
    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ windowId: 4 });
  });
});

describe("closing a view stops only that view's work", () => {
  it("aborts the requests of the view whose port closed, not those of another view", async () => {
    chrome.permissions.contains.mockResolvedValue(true);
    const signals = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn((url, opts) => new Promise((resolve, reject) => {
      signals.push(opts.signal);
      opts.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    try {
      const popup = { id: "abc", url: EXT + "popup.html" };
      const listeners = [];
      const port = (name) => ({ name, sender: popup, onDisconnect: { addListener: (fn) => listeners.push([name, fn]) } });
      onConnect(port("view:A"));
      onConnect(port("view:B"));
      const a = send({ type: "FETCH_IMAGE_SIZES", urls: ["https://img.example/a.jpg"], pageUrl: "https://e.com/", viewId: "A" }, popup);
      const b = send({ type: "FETCH_IMAGE_SIZES", urls: ["https://img.example/b.jpg"], pageUrl: "https://e.com/", viewId: "B" }, popup);
      await vi.waitFor(() => expect(signals.length).toBe(2));
      listeners.find(([n]) => n === "view:A")[1]();
      await a;
      expect(signals.filter((s) => s.aborted).length).toBe(1);
      listeners.find(([n]) => n === "view:B")[1]();
      await b;
    } finally {
      globalThis.fetch = realFetch;
      chrome.permissions.contains.mockResolvedValue(false);
    }
  });
});

describe("changing an API key", () => {
  it("drops only that service's saved results: a new Bing key keeps paid DataForSEO lookups", async () => {
    const listener = chrome.storage.local.onChanged.addListener.mock.calls[0][0];
    const now = Date.now();
    chrome.storage.local.get.mockResolvedValueOnce({ _cache: {
      "dfs::https://e.com/|2840|en": { data: 1, ts: now }, "bing::https://e.com/": { data: 2, ts: now }, "onpage::https://e.com/": { data: 3, ts: now }
    } });
    chrome.storage.local.set.mockClear();
    listener({ bingKey: { newValue: "new" } });
    await vi.waitFor(() => expect(chrome.storage.local.set).toHaveBeenCalled());
    expect(Object.keys(chrome.storage.local.set.mock.calls.at(-1)[0]._cache).sort()).toEqual(["dfs::https://e.com/|2840|en", "onpage::https://e.com/"]);
  });
});
