// Aikido triage of 25 November 2026, finding 13 (the skeptic's reading): robots.txt matching cost
// rules × path length × bots. The site chooses both the file (500 KiB, tens of thousands of wildcard
// rules) and the URL (up to 2 MiB), and one audit asks for Googlebot and 18 AI bots, each parsing
// and matching the file again: minutes of frozen popup. Now each pattern and search is done once
// for all bots, a part with a character the path lacks is no search at all, and matching stops after
// ROBOTS_MATCH_MS with partial: true. The verdicts don't change: a reference copy of the old
// matcher must agree on every case that fits the time.
import { describe, it, expect } from "vitest";
import { Worker } from "node:worker_threads";
import { isAllowedByRobots, parseRobots, ROBOTS_MATCH_MS } from "../lib/robots.js";

const WORKER = `
const { parentPort, workerData: w } = require("node:worker_threads");
(async () => {
  const { isAllowedByRobots } = await import(w.robots);
  const { analyzeAIAccess } = await import(w.geo);
  const out = [];
  for (const [label, text, path] of w.runs) {
    const t0 = performance.now();
    const google = isAllowedByRobots(text, path, "googlebot");
    const ai = analyzeAIAccess({ text }, path);
    out.push({ label, ms: performance.now() - t0, google, blocked: ai.blockedCount });
  }
  parentPort.postMessage(out);
})();`;

/** Googlebot plus the 18 AI bots, as one audit asks them, in a worker; null when it hasn't answered after limitMs. */
function auditInWorker(runs, limitMs = 10000) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, { eval: true, workerData: {
      robots: new URL("../lib/robots.js", import.meta.url).href,
      geo: new URL("../lib/geo.js", import.meta.url).href,
      runs
    } });
    const stop = setTimeout(() => { worker.terminate(); resolve(null); }, limitMs);
    worker.once("message", (out) => { clearTimeout(stop); worker.terminate(); resolve(out); });
    worker.once("error", (e) => { clearTimeout(stop); reject(e); });
  });
}

const MAX = 500 * 1024;
/** A robots.txt of `User-agent: *` and as many rules as fit in 500 KiB. */
const fill = (rule) => { let t = "User-agent: *\n"; for (let i = 0; ; i++) { const l = `${rule(i)}\n`; if (t.length + l.length > MAX) return t; t += l; } };
const ALPHA = "bcdefghijklmnopqrstuvwxyzBCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
const distinct = (i) => `Disallow: /*a${ALPHA[i % 64]}${ALPHA[Math.floor(i / 64) % 64]}${i >= 4096 ? ALPHA[Math.floor(i / 4096) % 64] : ""}`;

describe("robots.txt matching is bounded for every bot together (finding 13)", () => {
  it("answers Googlebot and the AI bots on hostile files and long URLs in about a second at most", async () => {
    const as = (n) => `/?${"a".repeat(n)}`;
    const out = await auditInWorker([
      // 34,000 identical rules; the old matcher took over 40 s with a 100,000-character URL.
      ["/*ab x 34,000", fill(() => "Disallow: /*ab"), as(100000)],
      ["Allow:*ab x 51,000", fill(() => "Allow:*ab"), as(100000)],
      // 2,000 different rules, and a URL that holds every character they use: 29 s before.
      ["2,000 different rules", `User-agent: *\n${Array.from({ length: 2000 }, (_, i) => distinct(i)).join("\n")}\n`, as(100000) + ALPHA],
      // 30,000 different rules against 2 MiB: hours before. Now the time runs out.
      ["30,000 different rules, 2 MiB URL", fill(distinct), as(2 * 1024 * 1024 - 100) + ALPHA]
    ]);
    expect(out, "the worker didn't answer within 10 s").not.toBeNull();
    const [same, allow, two, huge] = out;
    for (const r of [same, allow, two]) expect(r.ms, r.label).toBeLessThan(ROBOTS_MATCH_MS);
    expect(huge.ms, huge.label).toBeLessThan(ROBOTS_MATCH_MS * 2.5);
    // Exact where the old matcher finished: nothing matches the first two, and "/*abc" blocks every bot.
    expect([same.google, same.blocked]).toEqual([{ allowed: true, rule: null }, 0]);
    expect([allow.google, allow.blocked]).toEqual([{ allowed: true, rule: null }, 0]);
    expect([two.google, two.blocked]).toEqual([{ allowed: false, rule: "Disallow: /*abc" }, 18]);
    expect(huge.google.partial).toBe(true);
  }, 20000);
});

// ---- The matcher as it was before (lib/robots.js at 7c5a965), as the reference for the verdicts ----
function normalizeRobotsPath(p) {
  return String(p || "")
    // eslint-disable-next-line no-control-regex -- every non-ASCII character
    .replace(/[^\x00-\x7F]+/g, (ch) => { try { return encodeURIComponent(ch); } catch { return ch; } })
    .replace(/%([0-9a-fA-F]{2})/g, (m, hex) => {
      const c = String.fromCharCode(parseInt(hex, 16));
      return /[A-Za-z0-9\-._~]/.test(c) ? c : `%${hex.toUpperCase()}`;
    });
}
function matchRobotsPattern(pattern, path) {
  if (!pattern) return false;
  const anchored = pattern.endsWith("$");
  const parts = (anchored ? pattern.slice(0, -1) : pattern).split("*");
  if (!path.startsWith(parts[0])) return false;
  let pos = parts[0].length;
  if (parts.length === 1) return anchored ? pos === path.length : true;
  for (let i = 1; i < parts.length - 1; i++) {
    const idx = path.indexOf(parts[i], pos);
    if (idx < 0) return false;
    pos = idx + parts[i].length;
  }
  const last = parts[parts.length - 1];
  if (anchored) return path.length - last.length >= pos && path.endsWith(last);
  return path.indexOf(last, pos) >= 0;
}
function indexAsDirectory(pattern) {
  const slash = pattern.lastIndexOf("/");
  return slash >= 0 && pattern.startsWith("/index.htm", slash) ? `${pattern.slice(0, slash + 1)}$` : null;
}
const token = (v) => { const s = String(v || "").trim().toLowerCase(); return /^\*(\s|$)/.test(s) ? "*" : (s.match(/^[a-z_-]+/) || [""])[0]; };
function reference(robotsText, path, ua = "*", fallbackUa = null) {
  const groups = parseRobots(robotsText);
  const t = token(ua || "*") || "*";
  let applicable = groups.filter((g) => g.uas.includes(t));
  if (!applicable.length && fallbackUa) applicable = groups.filter((g) => g.uas.includes(token(fallbackUa)));
  if (!applicable.length) applicable = groups.filter((g) => g.uas.includes("*"));
  if (!applicable.length) return { allowed: true, rule: null };
  const target = normalizeRobotsPath(path);
  let best = null;
  for (const g of applicable) for (const type of ["allow", "disallow"]) for (const p of g[type]) {
    const norm = normalizeRobotsPath(p);
    let size = matchRobotsPattern(norm, target) ? norm.length : -1;
    if (size < 0 && type === "allow") { const dir = indexAsDirectory(norm); if (dir && matchRobotsPattern(dir, target)) size = dir.length; }
    if (size < 0) continue;
    if (!best || size > best.size || (size === best.size && type === "allow" && best.type === "disallow")) best = { type, pattern: p, size };
  }
  return best ? { allowed: best.type === "allow", rule: `${best.type === "allow" ? "Allow" : "Disallow"}: ${best.pattern}` } : { allowed: true, rule: null };
}

describe("the bounded matcher gives the same verdicts as before", () => {
  it("agrees with the old matcher on thousands of random files, paths and bots", () => {
    let seed = 20261125;
    const rnd = (k) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % k; };
    const pick = (a) => a[rnd(a.length)];
    const atoms = ["/", "a", "b", "ab", "*", "$", "?", "=", "x", "%7E", "~", "é", "%c3%a9", "index.html", "index.htm", ".pdf", "/dir/", "%2F", "-"];
    const pattern = () => { let s = rnd(4) ? "/" : ""; for (let k = rnd(6); k > 0; k--) s += pick(atoms); return s; };
    const pathOf = () => { let s = "/"; for (let k = rnd(7); k > 0; k--) s += pick(["a", "b", "ab", "dir/", "index.html", "x", "?", "=", ".pdf", "%7E", "~", "%C3%A9", "é", "/"]); return s; };
    const agents = ["*", "Googlebot", "GPTBot", "ClaudeBot", "googlebot/2.1", "Applebot", "Bingbot"];
    let checked = 0;
    for (let f = 0; f < 3000; f++) {
      let text = "";
      for (let g = 1 + rnd(4); g > 0; g--) {
        for (let u = 1 + rnd(2); u > 0; u--) text += `User-agent: ${pick(agents)}\n`;
        for (let r = rnd(8); r > 0; r--) text += `${pick(["Allow", "Disallow", "allow"])}: ${pattern()}\n`;
        if (!rnd(3)) text += "\n";
      }
      for (let p = 0; p < 3; p++) {
        const path = pathOf();
        for (const [ua, fallback] of [["googlebot"], ["GPTBot"], ["Applebot", "googlebot"], ["*"], ["ClaudeBot"]]) {
          expect(isAllowedByRobots(text, path, ua, fallback), JSON.stringify({ text, path, ua })).toEqual(reference(text, path, ua, fallback));
          checked++;
        }
      }
    }
    expect(checked).toBe(45000);
  });

  it("keeps the strongest rule, Allow on a tie and the first one read, across groups merged for one bot", () => {
    const text = "User-agent: *\nDisallow: /p\nAllow: /p\nDisallow: /*.pdf$\n\nUser-agent: *\nAllow: /dir/index.html\nDisallow: /dir/\nDisallow: /caf%C3%A9\nDisallow: /café\n";
    for (const path of ["/p", "/page", "/a.pdf", "/dir/", "/dir/x", "/café", "/caf%C3%A9/x", "/"]) {
      expect(isAllowedByRobots(text, path), path).toEqual(reference(text, path));
    }
  });
});
