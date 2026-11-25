// @vitest-environment jsdom
// When robots.txt has too many rules to check in time, lib/robots.js gives no verdict:
// {allowed: null, unchecked: true}. The popup read a null as false: the Technical tab said Googlebot was
// "blocked", and the AI tab's heading counted an AI answer bot as blocked. It says "not checked" now.
import { it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPopup } from "./helpers/popup-harness.js";

// Googlebot and one AI answer bot run out of time; every other verdict is the real one.
vi.mock("../lib/robots.js", async (importOriginal) => {
  const real = await importOriginal();
  const OUT_OF_TIME = new Set(["googlebot", "OAI-SearchBot"]);
  return {
    ...real,
    isAllowedByRobots: (text, p, ua, fallback) => (OUT_OF_TIME.has(ua) ? { allowed: null, rule: null, unchecked: true } : real.isAllowedByRobots(text, p, ua, fallback))
  };
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FX = JSON.parse(readFileSync(path.join(ROOT, "dev/preview/fixtures/riverside.json"), "utf8"));
// The server check reads the demo page, its robots.txt and its sitemap through the page.
const pageFetchAll = (requests) => (requests || []).map((r) => {
  const p = FX.pages[r.url];
  if (!p) return { ok: false, status: 404, url: r.url, redirected: false, headers: { "content-type": "text/html" }, text: "", truncated: false, ms: 20 };
  return { ok: p.status < 400, status: p.status, url: r.url, redirected: false, headers: p.headers, text: p.text, truncated: false, ms: 40 };
});
const words = (el) => el.textContent.replace(/\s+/g, " ").trim();

it("says 'not checked' for a robots.txt verdict that ran out of time, never 'blocked'", async () => {
  await loadPopup({ scripting: async ({ func, args, files }) => [{ result: files ? undefined : func?.name === "pageFetchAll" ? pageFetchAll(args?.[0]) : undefined }] });

  // Technical tab: the Googlebot row.
  const googlebot = await vi.waitFor(() => {
    const r = [...document.querySelectorAll("#panel-technical .row")].find((x) => x.querySelector(".k")?.textContent === "This URL for Googlebot");
    if (!r) throw new Error("robots.txt card not drawn");
    return r;
  }, { timeout: 3000 });
  expect(words(googlebot.querySelector(".v"))).toBe("not checked too many rules to check in time");
  expect(googlebot.querySelector(".tag.bad")).toBeNull();

  // AI tab: GPTBot (training) is really blocked in the demo robots.txt, and OAI-SearchBot has no verdict.
  // No AI answer bot is blocked, and one is not checked: the heading says so, not "allowed".
  const heading = await vi.waitFor(() => {
    const h = [...document.querySelectorAll("#panel-ai h3")].find((x) => x.textContent.startsWith("AI crawlers in robots.txt"));
    if (!h) throw new Error("AI tab not drawn");
    return h;
  }, { timeout: 3000 });
  expect(words(heading.querySelector(".tag"))).toBe("1 AI answer bot not checked");
  expect(heading.querySelector(".tag").className).toBe("tag neutral");
  // A real block still shows its rule.
  const gptbot = [...document.querySelectorAll("#panel-ai .bot-list li")].find((li) => li.querySelector(".bot-name").textContent === "GPTBot");
  expect(gptbot.querySelector(".bot-rule")?.textContent).toBe("Disallow: /");
});
