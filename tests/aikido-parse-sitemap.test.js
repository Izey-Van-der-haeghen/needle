// Aikido triage of 25 November 2026, finding 11: an RSS or Atom sitemap full of <item> or <entry>
// openers without end tags made each one scan to the end of the file (960 KB took 21 s; Needle reads
// files up to 10 MiB). The inputs here are as large as Needle reads and run in a worker: the old
// code took minutes or more on them, and a worker that doesn't answer in time fails the test.
// The skeptic's correction is covered too: the cut at the last end tag is found in the text itself,
// so "İ" (two characters in lower case) before it can't bring the slow scan back.
import { describe, it, expect } from "vitest";
import { Worker } from "node:worker_threads";
import { sitemapEntries } from "../lib/sitemap-check.js";

const WORKER = `
const { parentPort, workerData: w } = require("node:worker_threads");
(async () => {
  const fn = (await import(w.url))[w.name];
  const out = [];
  for (const [label, args] of w.runs) {
    const t0 = performance.now();
    const value = fn(...args);
    out.push({ label, ms: performance.now() - t0, count: value.length });
  }
  parentPort.postMessage(out);
})();`;

/** Each run's time in ms and number of URLs, measured in a worker; null when it hasn't answered after limitMs. */
function timeInWorker(fn, runs, limitMs = 10000) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, { eval: true, workerData: { ...fn, runs } });
    const stop = setTimeout(() => { worker.terminate(); resolve(null); }, limitMs);
    worker.once("message", (out) => { clearTimeout(stop); worker.terminate(); resolve(out); });
    worker.once("error", (e) => { clearTimeout(stop); reject(e); });
  });
}

const MiB = 1024 * 1024;
const RSS = "<rss><channel><link>https://a.example/</link>";
const ATOM = '<feed xmlns="http://www.w3.org/2005/Atom">';
const n = (unit, bytes = 10 * MiB) => Math.floor(bytes / unit.length);

describe("RSS and Atom sitemaps are read in linear time (finding 11)", () => {
  it("reads 10 MiB of unclosed <item> or <entry> in under a second, also after a run of İ", async () => {
    const out = await timeInWorker({ url: new URL("../lib/sitemap-check.js", import.meta.url).href, name: "sitemapEntries" }, [
      ["unclosed <item>", [RSS + "<item>".repeat(n("<item>")), "rss"]],
      ["unclosed <entry>", [ATOM + "<entry>".repeat(n("<entry>")), "atom"]],
      ["İ, one item, then unclosed <item>", [RSS + "İ".repeat(n("İ", 4 * MiB)) + "<item><link>https://a.example/x</link></item>" + "<item>".repeat(n("<item>", 6 * MiB)), "rss"]],
      ["İ, one entry, then unclosed <entry>", [ATOM + "İ".repeat(n("İ", 4 * MiB)) + '<entry><link href="https://a.example/x"/></entry>' + "<entry>".repeat(n("<entry>", 6 * MiB)), "atom"]]
    ]);
    expect(out, "the worker didn't answer within 10 s").not.toBeNull();
    for (const r of out) expect(r.ms, r.label).toBeLessThan(1000);
    expect(out.map((r) => r.count)).toEqual([0, 0, 1, 1]);
  }, 20000);

  it("still lists every item and entry that has its end tag, in any case", () => {
    const rss = `${RSS}<ITEM><link>https://a.example/1</link></ITEM><item x="y"><link><![CDATA[https://a.example/2]]></link></Item>` +
      "<item><title>no link</title></item><item><link>https://a.example/3</link>";
    expect(sitemapEntries(rss, "rss")).toEqual(["https://a.example/1", "https://a.example/2"]);
    const atom = `${ATOM}İİ<entry><link rel="self" href="https://a.example/feed"/><link href="https://a.example/1"/></ENTRY>` +
      '<entry>\n<link rel="alternate" href="https://a.example/2"/></entry><entry><link href="https://a.example/3"/>';
    expect(sitemapEntries(atom, "atom")).toEqual(["https://a.example/1", "https://a.example/2"]);
  });
});
