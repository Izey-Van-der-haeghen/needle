// Runs the real content.js inside jsdom, the way Chrome injects it into a tab,
// so tests can talk to it with the same messages the popup sends.
// Usage, polyfills and their limits: tests/helpers/README.md.
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
// ?raw keeps content.js in Vitest's module graph, so watch mode re-runs on edits.
import source from "../../content.js?raw";

// vm.Script gives classic-script semantics, which window.eval does not: top-level
// const/let land in the window's global scope, so a second run throws like a
// second injection into the same world in Chrome. Stack traces name content.js.
const contentScript = new vm.Script(source, {
  filename: fileURLToPath(new URL("../../content.js", import.meta.url))
});

const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop"; // 32 letters a-p, like a real id
const ORIGIN = `chrome-extension://${EXTENSION_ID}`;
// What a content script receives as `sender` when the popup calls chrome.tabs.sendMessage.
const POPUP_SENDER = { id: EXTENSION_ID, url: `${ORIGIN}/popup.html`, origin: ORIGIN };
const NO_RESPONSE_MS = 2000;

/**
 * Load `html` into a fresh jsdom window, install the chrome stub and polyfills,
 * then run content.js as Chrome would at document_idle.
 *
 * @param {string} html
 * @param {object} [options]
 * @param {string} [options.url] page URL (location.href)
 * @param {{width?: number, height?: number}} [options.viewport] window.innerWidth/innerHeight
 * @param {Record<string, (msg: object) => any>} [options.runtimeHandlers] chrome.runtime.sendMessage replies by msg.type; other types get no answer (undefined)
 * @param {object[]} [options.resourceEntries] PerformanceResourceTiming-like objects for performance.getEntriesByType("resource")
 * @param {Record<string, boolean>} [options.media] media queries that match, e.g. { "(prefers-reduced-motion: reduce)": true }
 * @param {(window: Window) => void} [options.setup] runs before the page parses, e.g. to stub image properties
 * @returns {Promise<{window: Window, document: Document, send: (msg: object) => Promise<any>, reinject: () => void}>}
 */
export async function loadContentScript(html, options = {}) {
  const {
    url = "https://www.example.be/nl-be/page/",
    viewport: { width = 1366, height = 768 } = {},
    runtimeHandlers = {},
    resourceEntries = [],
    media = {},
    setup = null
  } = options;

  const dom = new JSDOM(html, {
    url,
    pretendToBeVisual: true,
    // "dangerously" turns on scripting, so <noscript> parses as text as it does in
    // Chrome. Any inline page <script> in the HTML runs too (fixtures have none).
    runScripts: "dangerously",
    beforeParse: (window) => {
      installPolyfills(window, { width, height, resourceEntries, media });
      // Tests set what jsdom can't do itself, such as a loaded image's file or the screen density.
      if (setup) setup(window);
    }
  });
  const { window } = dom;
  // run_at: document_idle. Chrome injects somewhere between DOMContentLoaded and
  // just after load; the latest point is the deterministic one.
  if (window.document.readyState !== "complete") {
    await new Promise((done) => window.addEventListener("load", done, { once: true }));
  }

  const listeners = [];
  window.chrome = chromeStub(window, listeners, runtimeHandlers);
  // Same as chrome.scripting.executeScript({ files: ["content.js"] }) into this world.
  const reinject = () => contentScript.runInContext(dom.getInternalVMContext());
  reinject();

  return {
    window,
    document: window.document,
    send: (message) => dispatch(window, listeners, message),
    reinject
  };
}

/** A standards-mode page with `body` and an optional `head`. */
export const html = (body, head = "") => `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;

/** Load `page`, return content.js's ANALYZE_ONPAGE reply and close the window again. */
export async function analyze(page, options) {
  const { window, send } = await loadContentScript(page, options);
  try {
    return await send({ type: "ANALYZE_ONPAGE" });
  } finally {
    window.close();
  }
}

/**
 * Deliver `message` like chrome.tabs.sendMessage from the popup (promise form).
 * Only the first listener to respond or throw decides the outcome.
 */
function dispatch(window, listeners, message) {
  return new Promise((resolve, reject) => {
    if (!listeners.length) {
      reject(new Error("Could not establish connection. Receiving end does not exist."));
      return;
    }
    let settled = false;
    let channelOpen = false;
    let timer;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    // Chrome sends the reply as JSON (undefined becomes null). A reply that cannot
    // be serialised throws inside the listener, which then counts as throwing.
    const sendResponse = (reply) => {
      const json = JSON.stringify(reply ?? null);
      settle(resolve, JSON.parse(json));
    };
    // The listener gets a JSON copy made in the page's realm, as Chrome delivers it.
    const msg = window.JSON.parse(JSON.stringify(message));

    for (const listener of [...listeners]) {
      try {
        // Only a literal `true` keeps the channel open. A returned promise does
        // not count: that only works from Chrome 148, rolled out gradually.
        if (listener(msg, { ...POPUP_SENDER }, sendResponse) === true) channelOpen = true;
      } catch (err) {
        // Chrome 146+ rejects the sender with the error's message; the original
        // error is kept here so the stack trace points into content.js.
        settle(reject, err);
      }
    }
    if (settled) return;
    // Nobody kept the channel open: the promise form of sendMessage resolves undefined.
    if (!channelOpen) {
      settle(resolve, undefined);
      return;
    }
    // Chrome would wait forever; a test should fail clearly instead.
    timer = setTimeout(() => settle(reject, new Error(
      `content.js did not answer ${JSON.stringify(message?.type)} within ${NO_RESPONSE_MS} ms ` +
      "(a listener returned true but never called sendResponse)"
    )), NO_RESPONSE_MS);
  });
}

// content.js itself only calls chrome.runtime.onMessage.addListener; the rest is
// here for the code the fix phase may add.
function chromeStub(window, listeners, runtimeHandlers) {
  // Messages cross the extension boundary as JSON and arrive in the page's realm.
  const viaJson = (value) => window.JSON.parse(JSON.stringify(value ?? null));
  return {
    runtime: {
      id: EXTENSION_ID,
      getURL: (path) => `${ORIGIN}/${String(path).replace(/^\//, "")}`,
      onMessage: { addListener: (listener) => listeners.push(listener) },
      sendMessage(message, callback) {
        const handler = Object.hasOwn(runtimeHandlers, message?.type) ? runtimeHandlers[message.type] : null;
        // Without a handler nobody answers, so Chrome resolves undefined.
        const reply = window.Promise.resolve(viaJson(message))
          .then((msg) => handler?.(msg))
          .then((value) => (handler ? viaJson(value) : undefined));
        if (typeof callback !== "function") return reply;
        reply.then(callback);
      }
    }
  };
}

// Elements whose text Chrome never shows, whatever jsdom's computed style says.
const NO_TEXT = new Set([
  "audio", "canvas", "desc", "head", "iframe", "metadata", "noscript", "object", "script", "style",
  "template", "textarea", "title", "video"
]);
// Boxes that start and end a line. Table rows are here because Chrome puts each on its own line.
const BLOCK_LEVEL = /^(block|flex|flow-root|grid|list-item|table|table-caption|table-row)$/;
const SVG_NS = "http://www.w3.org/2000/svg";
const invisible = (style) => style.visibility === "hidden" || style.visibility === "collapse";
// A closed <details> renders only its first <summary>.
const skippedInDetails = (node) => {
  const details = node.parentNode;
  return details?.localName === "details" && !details.open &&
    node !== [...details.children].find((child) => child.localName === "summary");
};

// Approximates Chrome's HTMLElement.innerText (the HTML spec's rendered text
// collection steps), which jsdom lacks because it has no layout. It reads jsdom's
// computed style, so @media rules, specificity, !important, text-transform and
// white-space: pre are not modelled. tests/fixtures/chrome-innertext.json holds
// the cases checked against Chrome.
function innerText(el) {
  const view = el.ownerDocument.defaultView;
  // Spec: an element that is not being rendered returns its textContent.
  if (!el.isConnected) return el.textContent;
  let inClosedDetails = false;
  for (let node = el; node; node = node.parentElement) {
    if (NO_TEXT.has(node.localName) || view.getComputedStyle(node).display === "none") return el.textContent;
    inClosedDetails ||= skippedInDetails(node);
  }
  // Chrome keeps boxes for a closed <details>'s content but shows none of it.
  if (inClosedDetails) return "";

  // \u0001 and \u0002 stand for 1 or 2 required line breaks; runs of them merge below.
  let out = "";
  const walk = (node, style) => {
    const itemsAreBlocks = /flex|grid/.test(style.display);
    let cells = 0;
    for (const child of node.childNodes) {
      if (skippedInDetails(child)) continue;
      if (child.nodeType === child.TEXT_NODE) {
        if (!invisible(style)) out += child.data.replace(/[ \t\n\r\f]+/g, " ");
        continue;
      }
      if (child.nodeType !== child.ELEMENT_NODE || NO_TEXT.has(child.localName)) continue;
      const cs = view.getComputedStyle(child);
      if (cs.display === "none") continue;
      // visibility: hidden drops an element's own text and breaks, not its visible descendants.
      if (invisible(cs)) {
        walk(child, cs);
        continue;
      }
      if (child.localName === "br") {
        out += "\n";
        continue;
      }
      if (cs.display === "table-cell" && cells++) out += "\t";
      // Floats, absolute and fixed boxes, flex and grid items and SVG <text> are block-level too.
      const block = itemsAreBlocks || BLOCK_LEVEL.test(cs.display) || (cs.cssFloat || "none") !== "none" ||
        /^(absolute|fixed)$/.test(cs.position) || (child.localName === "text" && child.namespaceURI === SVG_NS);
      const gap = child.localName === "p" ? "\u0002" : block ? "\u0001" : "";
      out += gap;
      walk(child, cs);
      out += gap;
    }
  };
  walk(el, view.getComputedStyle(el));
  return out
    .replace(/ *([\n\t\u0001\u0002]) */g, "$1")
    .replace(/ {2,}/g, " ")
    .replace(/^ | $/g, "")
    .replace(/^[\u0001\u0002]+|[\u0001\u0002]+$/g, "")
    .replace(/[\u0001\u0002]+/g, (run) => (run.includes("\u0002") ? "\n\n" : "\n"));
}

function installPolyfills(window, { width, height, resourceEntries, media }) {
  const { Element, HTMLElement, HTMLImageElement } = window;

  // jsdom lacks matchMedia. A query matches when options.media sets it to true;
  // case and spaces are ignored, as Chrome normalises them.
  const normalise = (query) => String(query).toLowerCase().replace(/\s+/g, "");
  const matching = new Set(Object.keys(media).filter((query) => media[query] === true).map(normalise));
  window.matchMedia = (query) => ({
    media: String(query),
    matches: matching.has(normalise(query)),
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false
  });

  // Layout. jsdom has none, so every box is 0x0 at 0,0. A test can give an
  // element a box with data-test-rect="x,y,width,height" (viewport coordinates).
  const rectOf = (el) => {
    const raw = el.getAttribute("data-test-rect");
    if (raw === null) return new window.DOMRect(0, 0, 0, 0);
    const box = raw.split(",").map(Number);
    if (box.length !== 4 || box.some(Number.isNaN)) {
      throw new Error(`data-test-rect must be "x,y,width,height", got "${raw}"`);
    }
    return new window.DOMRect(...box);
  };
  Element.prototype.getBoundingClientRect = function () {
    return rectOf(this);
  };
  // Approximation: an element's scrollHeight is its own data-test-rect height
  // (content.js reads it on <html> and <body> for the page height).
  Object.defineProperty(Element.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return rectOf(this).height;
    }
  });
  // Approximation: an <img> with data-test-rect is rendered at that size, so
  // img.width/height return it (Chrome returns the content box). Without one,
  // jsdom's not-rendered value stands: the width/height attribute, else 0.
  for (const dim of ["width", "height"]) {
    const native = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, dim);
    Object.defineProperty(HTMLImageElement.prototype, dim, {
      ...native,
      get() {
        return this.hasAttribute("data-test-rect") ? rectOf(this)[dim] : native.get.call(this);
      }
    });
  }
  // jsdom loads no images. data-test-natural="w,h" gives an <img> its natural size,
  // and data-test-current="url" the srcset candidate the browser picked (currentSrc).
  for (const [prop, idx] of [["naturalWidth", 0], ["naturalHeight", 1]]) {
    Object.defineProperty(HTMLImageElement.prototype, prop, {
      configurable: true,
      get() { const v = this.getAttribute("data-test-natural"); return v ? Number(v.split(",")[idx]) : 0; }
    });
  }
  Object.defineProperty(HTMLImageElement.prototype, "currentSrc", {
    configurable: true,
    get() { const v = this.getAttribute("data-test-current"); return v ? new URL(v, this.ownerDocument.baseURI).href : (this.src || ""); }
  });
  window.innerWidth = width;
  window.innerHeight = height;

  // jsdom lacks scrollIntoView. A no-op on the prototype, so tests can spy on it.
  Element.prototype.scrollIntoView = function () {};

  // jsdom lacks HTMLImageElement.loading. Reflect the attribute as the spec does:
  // "lazy" in any case is lazy, anything else (or nothing) is "eager".
  Object.defineProperty(HTMLImageElement.prototype, "loading", {
    configurable: true,
    get() {
      return this.getAttribute("loading")?.toLowerCase() === "lazy" ? "lazy" : "eager";
    },
    set(value) {
      this.setAttribute("loading", value);
    }
  });

  // jsdom's Performance keeps no entries. Serve the test's resource timings.
  window.performance.getEntriesByType = (type) => (type === "resource" ? [...resourceEntries] : []);

  Object.defineProperty(HTMLElement.prototype, "innerText", {
    configurable: true,
    get() {
      return innerText(this);
    }
  });
}
