// Full check of 1.0.2, state and timing: what goes wrong when the page, another view or the
// worker changes something while Needle is busy.
import { describe, it, expect } from "vitest";
import { loadContentScript } from "./helpers/content-harness.js";
import { withoutTracking } from "../lib/urls.js";
import { analyzeTechnical } from "../lib/technical.js";
import { collectFindings } from "../lib/findings.js";
import { computeIndexability } from "../lib/popup-compute.js";
import { pruneCache } from "../lib/cache.js";
import { sendWithRetry } from "../lib/popup-messaging.js";

describe("a heading Needle points at", () => {
  it("is found by its level and text after the page gains a heading above it", async () => {
    const { document, send, window } = await loadContentScript(`<!doctype html><html lang="en"><head><title>T</title></head><body>
      <main><h1>Bike repairs</h1><p>text</p><h2>Prices</h2><p>more</p><h4>Opening hours</h4></main></body></html>`);
    const a = await send({ type: "ANALYZE_ONPAGE" });
    const skip = collectFindings({ onpage: a }).find((f) => f.id === "heading-skips");
    expect(skip.targets).toEqual([{ kind: "heading", index: 2, level: 4, text: "Opening hours" }]);
    const banner = document.createElement("div");
    banner.innerHTML = "<h2>We value your privacy</h2>";
    document.body.prepend(banner);
    const res = await send({ type: "HIGHLIGHT", target: skip.targets[0] });
    const marked = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].find((h) => h.style.outline);
    expect(res.ok).toBe(true);
    expect(marked.textContent).toBe("Opening hours");
    window.close();
  });

  it("is reported as not found when it is gone, not drawn on another heading", async () => {
    const { send, window } = await loadContentScript(`<!doctype html><html lang="en"><head><title>T</title></head><body><h1>A</h1><h2>B</h2></body></html>`);
    const issues = await send({ type: "HIGHLIGHT_ISSUES", items: [{ target: { kind: "heading", index: 1, level: 4, text: "Opening hours" }, label: "skips a level", severity: "low" }] });
    expect(issues.missing).toBe(1);
    window.close();
  });
});

describe("a campaign link is the same page", () => {
  it("only the tracking parameters go; the rest of the query stays exactly as written", () => {
    expect(withoutTracking("https://www.example.be/zoek?q=fiets%20herstel&utm_source=nieuwsbrief")).toBe("https://www.example.be/zoek?q=fiets%20herstel");
    expect(withoutTracking("https://a.example/p?amp&utm_medium=mail")).toBe("https://a.example/p?amp");
    expect(withoutTracking("https://a.example/p?tags=a,b&gclid=1#top")).toBe("https://a.example/p?tags=a,b");
    expect(withoutTracking("https://a.example/p?q=a+b")).toBe("https://a.example/p?q=a+b");
    expect(withoutTracking("https://a.example/p?utm_source=x")).toBe("https://a.example/p");
  });

  it("its canonical without the campaign isn't 'another URL'", () => {
    const d = { url: "https://www.example.be/zoek?q=fiets%20herstel&utm_source=nieuwsbrief", robots: "", canonical: "https://www.example.be/zoek?q=fiets%20herstel", headings: [] };
    expect(collectFindings({ onpage: d }).some((f) => f.id === "canonical-elsewhere")).toBe(false);
    expect(collectFindings({ onpage: { ...d, canonical: "https://www.example.be/zoek?q=fiets" } }).some((f) => f.id === "canonical-elsewhere")).toBe(true);
  });

  it("robots.txt is judged on the page's own path, not the ?utm_ address", async () => {
    const fetcher = async (reqs) => reqs.map((r) => (r.url.endsWith("/robots.txt")
      ? { ok: true, status: 200, text: "User-agent: *\nDisallow: /*?\n", headers: {} }
      : { ok: true, status: 200, text: "<html></html>", headers: { "content-type": "text/html" } }));
    const tech = await analyzeTechnical("https://www.example.be/fietsen?utm_source=nieuwsbrief&utm_medium=email", fetcher);
    expect(tech.robotsTxt.pathAllowed.allowed).toBe(true);
    expect(computeIndexability({ url: "https://www.example.be/fietsen", canonicals: [], metaRobots: "" }, tech).level).not.toBe("bad");
  });
});

describe("saved results", () => {
  it("count Chrome's quota in UTF-8 bytes", () => {
    const ja = "東京".repeat(1000); // 6000 bytes, 2000 UTF-16 units
    const cache = { "onpage:a": { ts: Date.now(), data: ja }, "onpage:b": { ts: Date.now() - 1, data: ja } };
    expect(Object.keys(pruneCache(cache, 8000))).toEqual(["onpage:a"]);
  });
});

describe("the background worker", () => {
  it("stopping mid-request gives plain words and no second (possibly paid) call", async () => {
    let calls = 0;
    globalThis.chrome = { runtime: { sendMessage: async () => { calls++; throw new Error("A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received"); } } };
    await expect(sendWithRetry({ type: "RUN_DFS" })).rejects.toThrow("Needle's background worker stopped before it answered. Try again.");
    expect(calls).toBe(1);
    delete globalThis.chrome;
  });
});
