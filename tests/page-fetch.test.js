import { describe, it, expect, vi, afterEach } from "vitest";
import { pageFetchAll } from "../lib/page-fetch.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete globalThis.fetch;
});

const streamOf = (chunks) => new ReadableStream({
  start(controller) {
    for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
    controller.close();
  }
});

describe("pageFetchAll (runs inside the audited tab)", () => {
  it("returns status, final URL, lower-case headers and text, without cookies", async () => {
    globalThis.fetch = vi.fn(async () => new Response(streamOf(["User-agent: *"]), { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex" } }));
    const [r] = await pageFetchAll([{ url: "https://e.com/robots.txt" }], 5000);
    expect(r).toMatchObject({ ok: true, status: 200, text: "User-agent: *", truncated: false });
    expect(r.headers["x-robots-tag"]).toBe("noindex");
    expect(globalThis.fetch.mock.calls[0][1]).toMatchObject({ credentials: "omit", redirect: "follow" });
  });

  it("stops reading after maxBytes", async () => {
    globalThis.fetch = vi.fn(async () => new Response(streamOf(["a".repeat(600), "b".repeat(600)]), { status: 200 }));
    const [r] = await pageFetchAll([{ url: "https://e.com/big", maxBytes: 1000 }], 5000);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThan(1300);
  });

  it("answers status 0 with the error instead of throwing", async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    const [r] = await pageFetchAll([{ url: "https://other.example/" }], 5000);
    expect(r).toEqual({ ok: false, status: 0, url: "https://other.example/", error: "Failed to fetch" });
  });

  it("is self-contained, so chrome.scripting can run it in the page", () => {
    // A function passed to executeScript is serialised: it must not close over module scope.
    const src = pageFetchAll.toString();
    expect(src).not.toMatch(/\bimport\b|PAGE_FETCH_TIMEOUT_MS/);
  });
});
