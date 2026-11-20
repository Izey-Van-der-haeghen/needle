// Self-checks for tests/helpers/content-harness.js: the message dispatch has to
// behave like Chrome and the polyfills like their documented approximations,
// or the content.js tests prove nothing.
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadContentScript } from "./helpers/content-harness.js";
import chromeInnerText from "./fixtures/chrome-innertext.json";

const EMPTY = "<!DOCTYPE html><html><head></head><body></body></html>";
const opened = [];
async function load(html = EMPTY, options) {
  const page = await loadContentScript(html, options);
  opened.push(page);
  return page;
}
afterEach(() => {
  vi.useRealTimers();
  while (opened.length) opened.pop().window.close();
});

describe("send() delivers messages like the popup's chrome.tabs.sendMessage", () => {
  it("passes a JSON copy and a popup sender, resolves the first synchronous reply as JSON", async () => {
    const page = await load();
    const { onMessage, id } = page.window.chrome.runtime;
    let seen;
    onMessage.addListener((msg, sender, sendResponse) => {
      seen = { msg, sender };
      sendResponse({ when: new Date(0), gone: undefined, nan: NaN });
    });
    onMessage.addListener((msg, sender, sendResponse) => sendResponse("second listener"));

    await expect(page.send({ type: "TEST", keep: 1, drop: undefined }))
      .resolves.toEqual({ when: "1970-01-01T00:00:00.000Z", nan: null });
    expect(Object.keys(seen.msg)).toEqual(["type", "keep"]);
    expect(seen.sender).toEqual({
      id,
      url: `chrome-extension://${id}/popup.html`,
      origin: `chrome-extension://${id}`
    });
  });

  it("sends null for an empty reply", async () => {
    const page = await load();
    page.window.chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => sendResponse());
    await expect(page.send({ type: "TEST" })).resolves.toBeNull();
  });

  it("waits for a later reply when the listener returns true", async () => {
    const page = await load();
    page.window.chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      page.window.setTimeout(() => sendResponse({ ok: true }), 5);
      return true;
    });
    await expect(page.send({ type: "TEST" })).resolves.toEqual({ ok: true });
  });

  it("resolves undefined when no listener replies or returns true, and drops a late reply", async () => {
    const page = await load();
    let reply;
    page.window.chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      reply = sendResponse;
      return Promise.resolve("a returned promise does not keep the channel open");
    });
    await expect(page.send({ type: "TEST" })).resolves.toBeUndefined();
    expect(() => reply("too late")).not.toThrow();
  });

  it("rejects after 2 s when a listener returned true but never replies", async () => {
    const page = await load();
    page.window.chrome.runtime.onMessage.addListener(() => true);
    vi.useFakeTimers();
    const outcome = expect(page.send({ type: "TEST_SILENT" }))
      .rejects.toThrow('content.js did not answer "TEST_SILENT" within 2000 ms');
    vi.advanceTimersByTime(2000);
    await outcome;
  });

  it("rejects with the error a listener throws, as Chrome 146+ does", async () => {
    const page = await load();
    page.window.chrome.runtime.onMessage.addListener(() => {
      throw new Error("boom");
    });
    await expect(page.send({ type: "TEST" })).rejects.toThrow("boom");
  });
});

describe("chrome.runtime stub", () => {
  it("answers sendMessage from runtimeHandlers by type, nothing otherwise, with or without a callback", async () => {
    const page = await load(EMPTY, {
      runtimeHandlers: { FETCH_RAW: (msg) => ({ htmlLen: 42, url: msg.url }) }
    });
    const { runtime } = page.window.chrome;
    await expect(runtime.sendMessage({ type: "FETCH_RAW", url: "https://www.example.be/" }))
      .resolves.toEqual({ htmlLen: 42, url: "https://www.example.be/" });
    await expect(runtime.sendMessage({ type: "ANYTHING_ELSE" })).resolves.toBeUndefined();
    await expect(new Promise((done) => runtime.sendMessage({ type: "FETCH_RAW" }, done)))
      .resolves.toEqual({ htmlLen: 42 });
    expect(runtime.id).toMatch(/^[a-p]{32}$/);
    expect(runtime.getURL("/popup.html")).toBe(`chrome-extension://${runtime.id}/popup.html`);
  });
});

describe("polyfills", () => {
  it("innerText drops what Chrome does not render and puts blocks on their own lines", async () => {
    const page = await load(`<!DOCTYPE html><html><head><title>titel</title></head><body><main>
      <h1>Een<svg><title>icoon</title></svg></h1><p>twee<br>drie</p><ul><li>vier</li><li>vijf</li></ul>
      <script>var zes = "zes";</script><style>p {}</style><noscript><p>zeven</p></noscript><template><p>acht</p></template>
      <p hidden>negen</p><p style="display: none">tien</p></main></body></html>`);
    expect(page.document.querySelector("main").innerText).toBe("Een\n\ntwee\ndrie\n\nvier\nvijf");
    // An element that is not rendered returns its textContent (spec), and so does one outside the document.
    expect(page.document.querySelector("p[hidden]").innerText).toBe("negen");
    const detached = page.document.createElement("div");
    detached.innerHTML = "<p>een</p><p hidden>twee</p><script>drie</script>";
    expect(detached.innerText).toBe("eentweedrie");
  });

  it("innerText matches what Chrome returns for every case in fixtures/chrome-innertext.json", async () => {
    const page = await load();
    for (const [name, { html, of, innerText }] of Object.entries(chromeInnerText.cases)) {
      const box = page.document.createElement("div");
      box.innerHTML = html;
      page.document.body.append(box);
      expect.soft((of ? box.querySelector(of) : box).innerText, name).toBe(innerText);
      box.remove();
    }
  });

  it("matchMedia matches only the queries options.media turns on, ignoring case and spaces", async () => {
    const reduced = await load(EMPTY, { media: { "(prefers-reduced-motion: reduce)": true } });
    expect(reduced.window.matchMedia("(prefers-reduced-motion:REDUCE)").matches).toBe(true);
    expect(reduced.window.matchMedia("(prefers-color-scheme: dark)").matches).toBe(false);
    const plain = await load();
    expect(plain.window.matchMedia("(prefers-reduced-motion: reduce)")).toMatchObject({ matches: false, media: "(prefers-reduced-motion: reduce)" });
  });

  it("parses <noscript> as text, as Chrome does with scripting on", async () => {
    const page = await load('<!DOCTYPE html><html><body><noscript><img src="/fallback.jpg"></noscript></body></html>');
    expect(page.document.images).toHaveLength(0);
  });

  it("takes layout from data-test-rect and options.viewport", async () => {
    const page = await load(`<!DOCTYPE html><html><body data-test-rect="0,0,375,2400">
      <img src="/img/a.jpg" width="1200" height="630" data-test-rect="16,80,343,180">
      <img src="/img/b.jpg" width="1200" height="630"></body></html>`,
    { viewport: { width: 375, height: 667 } });
    const [rendered, plain] = page.document.images;

    expect([page.window.innerWidth, page.window.innerHeight]).toEqual([375, 667]);
    expect(rendered.getBoundingClientRect())
      .toMatchObject({ x: 16, y: 80, width: 343, height: 180, top: 80, right: 359, bottom: 260, left: 16 });
    expect([rendered.width, rendered.height]).toEqual([343, 180]);
    expect(plain.getBoundingClientRect()).toMatchObject({ width: 0, height: 0, top: 0 });
    expect([plain.width, plain.height]).toEqual([1200, 630]);
    expect(page.document.body.scrollHeight).toBe(2400);

    plain.setAttribute("data-test-rect", "1,2,3");
    expect(() => plain.getBoundingClientRect()).toThrow('data-test-rect must be "x,y,width,height"');
  });

  it("reflects img.loading, serves resource timings and has a spy-able scrollIntoView", async () => {
    const entry = { name: "https://www.example.be/a.jpg", initiatorType: "img", transferSize: 10 };
    const page = await load(`<!DOCTYPE html><html><body><img src="/img/a.jpg" loading="LAZY">
      <img src="/img/b.jpg" loading="auto"><img src="/img/c.jpg"></body></html>`,
      { resourceEntries: [entry] });
    expect([...page.document.images].map((img) => img.loading)).toEqual(["lazy", "eager", "eager"]);
    expect(page.window.performance.getEntriesByType("resource")).toEqual([entry]);
    expect(page.window.performance.getEntriesByType("navigation")).toEqual([]);
    expect(page.document.body.scrollIntoView).toBeTypeOf("function");
  });
});
