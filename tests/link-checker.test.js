import { describe, it, expect, vi, afterEach } from "vitest";
import { checkLinks } from "../lib/link-checker.js";

/**
 * Helper: build a Response-shaped object the way the real `fetch` would.
 * Only includes the fields link-checker.js inspects.
 */
function res(status, { url = "", redirected = false, type = "default" } = {}) {
  return { status, url, redirected, type };
}

function mockFetch(handler) {
  globalThis.fetch = vi.fn(handler);
}

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.fetch;
});

describe("checkLinks — input handling", () => {
  it("returns [] for empty input without calling fetch", async () => {
    mockFetch(async () => res(200));
    const result = await checkLinks([]);
    expect(result).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("checkLinks — status classification", () => {
  it("200 OK (not redirected) → kind 'ok'", async () => {
    mockFetch(async (url) => res(200, { url }));
    const [r] = await checkLinks(["https://e.com/a"]);
    expect(r).toMatchObject({
      url: "https://e.com/a",
      status: 200,
      kind: "ok",
      finalUrl: "https://e.com/a",
    });
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });

  it("200 OK with response.redirected=true → kind 'redirect'", async () => {
    mockFetch(async () => res(200, { url: "https://e.com/final", redirected: true }));
    const [r] = await checkLinks(["https://e.com/a"]);
    expect(r.kind).toBe("redirect");
    expect(r.status).toBe(200);
    expect(r.finalUrl).toBe("https://e.com/final");
  });

  it("301 → kind 'redirect'", async () => {
    mockFetch(async () => res(301));
    const [r] = await checkLinks(["https://e.com/old"]);
    expect(r).toMatchObject({ status: 301, kind: "redirect" });
  });

  it("404 → kind 'broken'", async () => {
    mockFetch(async () => res(404));
    const [r] = await checkLinks(["https://e.com/gone"]);
    expect(r).toMatchObject({ status: 404, kind: "broken" });
  });

  it("503 → kind 'blocked' (bot walls answer 503; otherwise it means down for now, not gone)", async () => {
    mockFetch(async () => res(503));
    const [r] = await checkLinks(["https://e.com/down"]);
    expect(r.kind).toBe("blocked");
  });

  it("500 → kind 'broken'", async () => {
    mockFetch(async () => res(500));
    const [r] = await checkLinks(["https://e.com/error"]);
    expect(r.kind).toBe("broken");
  });
});

describe("checkLinks — no-cors opaque fallback", () => {
  it("falls back to no-cors when default fetch throws; opaque response → 'ok'", async () => {
    let call = 0;
    mockFetch(async (_url, opts) => {
      call++;
      if (opts.mode !== "no-cors") {
        throw new TypeError("Failed to fetch — CORS");
      }
      return res(0, { type: "opaque" });
    });
    const [r] = await checkLinks(["https://cors-blocked.example/x"]);
    expect(call).toBe(2);
    expect(r).toMatchObject({ status: 0, kind: "ok" });
  });

  it("reports 'broken' status 0 when both default and no-cors throw", async () => {
    mockFetch(async () => {
      throw new TypeError("Failed to fetch — DNS");
    });
    const [r] = await checkLinks(["https://dead.example/x"]);
    expect(r).toMatchObject({ status: 0, kind: "broken" });
  });

  it("does NOT retry with no-cors when the first error is AbortError — surfaces as 'timeout'", async () => {
    let call = 0;
    mockFetch(async () => {
      call++;
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    });
    const [r] = await checkLinks(["https://aborted.example/x"]);
    expect(call).toBe(1);
    expect(r).toMatchObject({ status: 0, kind: "timeout" });
  });
});

describe("checkLinks — abort signal", () => {
  it("external abort surfaces as 'timeout' for in-flight requests", async () => {
    const controller = new AbortController();
    mockFetch((_url, opts) => {
      return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    });
    const pending = checkLinks(["https://slow.example/x"], controller.signal);
    // Allow the worker to enqueue the fetch before we abort.
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    const [r] = await pending;
    expect(r.kind).toBe("timeout");
    expect(r.status).toBe(0);
  });
});

describe("checkLinks — batch behaviour", () => {
  it("caps at MAX_LINKS (2000) and checks each URL once", async () => {
    let count = 0;
    mockFetch(async () => {
      count++;
      return res(200);
    });
    const urls = Array.from({ length: 2050 }, (_, i) => `https://e${i % 50}.com/${i}`);
    const results = await checkLinks([...urls, urls[0], urls[1]]);
    expect(results).toHaveLength(2000);
    expect(count).toBe(2000);
  });

  it("uses HEAD first and retries with GET when HEAD fails", async () => {
    const methods = [];
    mockFetch(async (url, opts) => {
      methods.push(opts.method);
      return opts.method === "HEAD" ? res(405) : res(200, { url });
    });
    const [r] = await checkLinks(["https://e.com/no-head"]);
    expect(methods).toEqual(["HEAD", "GET"]);
    expect(r.kind).toBe("ok");
  });

  it("reports servers that refuse automated checks as 'blocked', not broken", async () => {
    mockFetch(async () => res(403));
    const [r] = await checkLinks(["https://e.com/members"]);
    expect(r).toMatchObject({ status: 403, kind: "blocked" });
  });

  it("does not retry a 429 with GET", async () => {
    const methods = [];
    mockFetch(async (_url, opts) => { methods.push(opts.method); return res(429); });
    const [r] = await checkLinks(["https://e.com/slow-down"]);
    expect(methods).toEqual(["HEAD"]);
    expect(r.kind).toBe("blocked");
  });

  it("skips links to this computer or a private network unless the page itself is local", async () => {
    mockFetch(async (url) => res(200, { url }));
    const remote = await checkLinks(["http://192.168.1.1/admin", "http://localhost:8080/"], undefined, "https://www.example.com/");
    expect(remote.map((r) => r.kind)).toEqual(["skipped", "skipped"]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    const local = await checkLinks(["http://localhost:8080/"], undefined, "http://localhost:3000/");
    expect(local[0].kind).toBe("ok");
  });

  it("never runs more than 3 requests to one host at once", async () => {
    let inFlight = 0;
    let peak = 0;
    mockFetch(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return res(200);
    });
    await checkLinks(Array.from({ length: 12 }, (_, i) => `https://one-host.example/${i}`));
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("processes a mixed batch and assigns correct kind per URL", async () => {
    const responses = {
      "https://e.com/ok": res(200, { url: "https://e.com/ok" }),
      "https://e.com/gone": res(404),
      "https://e.com/moved": res(301),
      "https://e.com/down": res(500),
    };
    mockFetch(async (url) => responses[url]);
    const results = await checkLinks(Object.keys(responses));
    const byUrl = Object.fromEntries(results.map((r) => [r.url, r.kind]));
    expect(byUrl["https://e.com/ok"]).toBe("ok");
    expect(byUrl["https://e.com/gone"]).toBe("broken");
    expect(byUrl["https://e.com/moved"]).toBe("redirect");
    expect(byUrl["https://e.com/down"]).toBe("broken");
  });

  it("every result has the contract shape {url, status, kind, ms}", async () => {
    mockFetch(async (url) => res(200, { url }));
    const results = await checkLinks(["https://e.com/1", "https://e.com/2"]);
    results.forEach((r) => {
      expect(typeof r.url).toBe("string");
      expect(typeof r.status).toBe("number");
      expect(["ok", "redirect", "broken", "blocked", "timeout", "skipped"]).toContain(r.kind);
      expect(typeof r.ms).toBe("number");
      expect(r.ms).toBeGreaterThanOrEqual(0);
    });
  });

  it("runs requests concurrently — observable as overlapping in-flight fetches", async () => {
    let inFlight = 0;
    let peak = 0;
    mockFetch(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      // Yield once so siblings can pile up before we resolve.
      await new Promise((r) => setTimeout(r, 0));
      inFlight--;
      return res(200);
    });
    const urls = Array.from({ length: 20 }, (_, i) => `https://e.com/${i}`);
    await checkLinks(urls);
    // Implementation runs PARALLEL=10 workers; peak should be >= 2 to prove
    // we're not serialised. (Exact 10 is implementation-detail; testing >=2.)
    expect(peak).toBeGreaterThanOrEqual(2);
  });
});

describe("checkLinks — finalUrl propagation", () => {
  it("uses response.url as finalUrl when present", async () => {
    mockFetch(async () => res(200, { url: "https://e.com/after-redirect", redirected: true }));
    const [r] = await checkLinks(["https://e.com/before"]);
    expect(r.finalUrl).toBe("https://e.com/after-redirect");
  });

  it("falls back to the request URL when response.url is empty", async () => {
    mockFetch(async () => res(200, { url: "" }));
    const [r] = await checkLinks(["https://e.com/x"]);
    expect(r.finalUrl).toBe("https://e.com/x");
  });

  it("opaque responses report finalUrl equal to the requested URL", async () => {
    mockFetch(async (_url, opts) => {
      if (opts.mode !== "no-cors") throw new TypeError("CORS");
      return res(0, { type: "opaque" });
    });
    const [r] = await checkLinks(["https://opaque.example/x"]);
    expect(r.finalUrl).toBe("https://opaque.example/x");
  });
});
