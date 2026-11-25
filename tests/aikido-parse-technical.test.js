// Aikido triage of 25 November 2026, finding 10 (and 17b for the copy in content.js): the strips over
// the server HTML ran a lazy scan from every unclosed opener, so their time grew with the square of
// the page (640 KB of "<!--" took 18 s). Each crafted input here is as large as Needle reads (3 MiB
// for a page, 5 MiB for a competitor) and runs in a worker: the old code took minutes on them, and a
// worker that doesn't answer in time fails the test instead of hanging it.
import { describe, it, expect } from "vitest";
import { Worker } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { serverIndexingTags, extractWordCount, rawSnapshot } from "../lib/technical.js";

const WORKER = `
const { parentPort, workerData: w } = require("node:worker_threads");
(async () => {
  const fn = w.url ? (await import(w.url))[w.name] : new Function(w.source + "; return " + w.name + ";")();
  const out = [];
  for (const [label, args] of w.runs) {
    const t0 = performance.now();
    fn(...args);
    out.push({ label, ms: performance.now() - t0 });
  }
  parentPort.postMessage(out);
})();`;

/** Each run's time in ms, measured in a worker; null when the worker hasn't answered after limitMs. */
function timeInWorker(fn, runs, limitMs = 10000) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, { eval: true, workerData: { ...fn, runs } });
    const stop = setTimeout(() => { worker.terminate(); resolve(null); }, limitMs);
    worker.once("message", (out) => { clearTimeout(stop); worker.terminate(); resolve(out); });
    worker.once("error", (e) => { clearTimeout(stop); reject(e); });
  });
}

async function expectEachUnder(ms, fn, runs) {
  const out = await timeInWorker(fn, runs);
  expect(out, "the worker didn't answer within 10 s").not.toBeNull();
  for (const r of out) expect(r.ms, r.label).toBeLessThan(ms);
}

const MiB = 1024 * 1024;
const fill = (unit, bytes = 3 * MiB) => unit.repeat(Math.floor(bytes / unit.length));
const TECH = new URL("../lib/technical.js", import.meta.url).href;
const URL_ = "https://a.example/";

// The content.js copy, cut out as tests/content-copies.test.js does.
const CONTENT = readFileSync(new URL("../content.js", import.meta.url), "utf8");
function cut(start, decl = start) {
  const i = CONTENT.indexOf(start);
  const d = CONTENT.indexOf(decl, i);
  let depth = 0;
  for (let j = CONTENT.indexOf("{", d); j < CONTENT.length; j++) {
    if (CONTENT[j] === "{") depth++;
    else if (CONTENT[j] === "}" && --depth === 0) return CONTENT.slice(i, j + 1);
  }
  throw new Error(`No end found for "${decl}" in content.js`);
}
const COPY_SOURCE = `${cut("const NO_SPACES", "function countWords(")}\n${cut("function htmlWordCount(")}`;
const htmlWordCount = new Function(`${COPY_SOURCE}; return htmlWordCount;`)();

describe("the strips over the server HTML take linear time (finding 10)", () => {
  it("serverIndexingTags reads 3 MiB of unclosed comments and raw-text elements in under a second", async () => {
    await expectEachUnder(1000, { url: TECH, name: "serverIndexingTags" }, [
      ["<!--", [fill("<!--"), URL_]],
      ["<script ", [fill("<script "), URL_]],
      ["<title ", [fill("<title "), URL_]],
      ["<textarea>", [fill("<textarea>"), URL_]],
      ["<!--<script>", [fill("<!--<script>"), URL_]],
      ["5 MiB of <!-- (a competitor page)", [fill("<!--", 5 * MiB), URL_]]
    ]);
  }, 20000);

  it("extractWordCount reads 3 MiB of unclosed heads, titles, tags, comments and SVG in under a second", async () => {
    await expectEachUnder(1000, { url: TECH, name: "extractWordCount" }, [
      ["<head  without <body>", [fill("<head ")]],
      ["<title  without <body>", [fill("<title ")]],
      ["<", ["<body>" + fill("<")]],
      ["<svg", ["<body>" + fill("<svg")]],
      ["<!--", ["<body>" + fill("<!--")]],
      ["<script ", ["<body>" + fill("<script ")]]
    ]);
  }, 20000);

  it("rawSnapshot counts 3 MiB of <a  without a closing > in under a second", async () => {
    await expectEachUnder(1000, { url: TECH, name: "rawSnapshot" }, [
      ["<a ", [fill("<a "), URL_]],
      ["<a  then one >", [fill("<a ") + ">", URL_]]
    ]);
  }, 20000);
});

describe("the strips read the HTML as the browser does", () => {
  const robots = (html) => serverIndexingTags(html, URL_).robots;

  it("an unclosed comment runs to the end, so a meta after it is no element", () => {
    expect(robots('<head><!-- <meta name="robots" content="noindex"></head><body>x</body>')).toBe("");
    expect(extractWordCount("<body><p>one two</p><!-- <p>three four</p>")).toBe(2);
  });

  it("an unclosed script runs to the end", () => {
    expect(robots('<head><script>var a = 1;<meta name="robots" content="noindex">')).toBe("");
    expect(extractWordCount("<body><p>one two</p><script>var a = 1; three four")).toBe(2);
  });

  it('a "<!--" inside a script is script text, not the start of a comment', () => {
    expect(robots('<head><script>var x = "<!--";</script><meta name="robots" content="noindex"></head>')).toBe("noindex");
    expect(extractWordCount('<body><script>var x = "<!--";</script><p>one two</p><!-- c --><p>three</p></body>')).toBe(3);
  });

  it('"İ" before an end tag does not move the cut (a lower-cased copy is longer)', () => {
    expect(robots(`<head><script>${"İ".repeat(40)}</SCRIPT><meta name="robots" content="noindex"></head>`)).toBe("noindex");
    expect(extractWordCount(`<body><SCRIPT>${"İ".repeat(40)}</SCRIPT><p>one two</p></body>`)).toBe(2);
  });

  it("<svg-icon> is a custom element, not an <svg>", () => {
    expect(extractWordCount("<body><svg-icon src=a.svg></svg-icon><p>one two three four five</p></body>")).toBe(5);
    expect(extractWordCount("<body><svg-icon></svg-icon><p>one two</p><svg><text>x</text></svg></body>")).toBe(2);
  });

  it("still finds the robots metas, the canonical and the counts of an ordinary page", () => {
    const page = '<!doctype html><html><head><title>T</title><!-- old --><meta name="robots" content="noindex">' +
      '<link rel="canonical" href="/c"><script>if (a < b) x = "</head>";</script></head>' +
      '<body><h1>One two</h1><a href="/a">three</a> <A class=x HREF="/b">four</A><svg><text>no</text></svg></body></html>';
    expect(serverIndexingTags(page, URL_)).toEqual({ robots: "noindex", canonical: "https://a.example/c" });
    const raw = rawSnapshot(page, URL_);
    expect([raw.wordCount, raw.headings, raw.links]).toEqual([4, 1, 2]);
  });
});

describe("content.js counts the rendered HTML as lib/technical.js counts the server HTML (finding 17)", () => {
  it("gives the same word count where the strips changed", () => {
    for (const html of [
      "<body><p>one two</p><!-- <p>three four</p>",
      "<body><p>one two</p><script>var a = 1; three four",
      '<body><script>var x = "<!--";</script><p>one two</p><!-- c --><p>three</p></body>',
      `<body><SCRIPT>${"İ".repeat(40)}</SCRIPT><p>one two</p></body>`,
      "<body><svg-icon></svg-icon><p>one two</p><svg><text>x</text></svg></body>",
      "<head><title>a b</title></head><title>c</title>no body here",
      "<head><title>a b</title>no end tags",
      "<body><p>a <b c</p> <i>d</i> <e",
      "<body><xmp>" + "<!--".repeat(50) + "</xmp><p>one</p>"
    ]) expect(htmlWordCount(html), html.slice(0, 60)).toBe(extractWordCount(html));
  });

  it("reads 3 MiB of unclosed comments and <script in the text of an <xmp> in under a second", async () => {
    const page = (unit) => `<html><head></head><body><p>a b</p><xmp>${fill(unit)}</xmp></body></html>`;
    await expectEachUnder(1000, { source: COPY_SOURCE, name: "htmlWordCount" }, [
      ["<!--", [page("<!--")]],
      ["<script ", [page("<script ")]],
      ["<", [page("<")]]
    ]);
  }, 20000);
});
