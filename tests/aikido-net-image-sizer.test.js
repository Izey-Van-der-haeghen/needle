// Aikido round, 25 November 2026, finding 20: an image URL that redirects to the user's own network.
// The server chooses which request it redirects (the HEAD, or only the Range GET), so Needle checks
// where each one ended. The request that lands there is still sent: fetch hides the hops.
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchImageSizes } from "../lib/image-sizer.js";

const IMG = "https://attacker.example/img.png";
const LAN = "http://10.0.0.5/secret.png";
const PAGE = "https://blog.example/post";

/** A Response-shaped object with the fields image-sizer.js reads. */
function res(status, url, headers = {}) {
  const h = new Map(Object.entries(headers));
  return { status, ok: status >= 200 && status < 300, url, headers: { get: (k) => h.get(k.toLowerCase()) ?? null }, body: { cancel: async () => {} } };
}

function stub(handler) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, opts) => {
    calls.push(`${opts?.method || "GET"} ${url}`);
    return handler(url, opts);
  });
  return calls;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.fetch;
});

describe("fetchImageSizes: an image that redirects to a local address", () => {
  it("the HEAD lands there: no Range GET and no size", async () => {
    const calls = stub(async () => res(200, LAN, { "content-length": "4242" }));
    expect(await fetchImageSizes([IMG], undefined, PAGE)).toEqual({});
    expect(calls).toEqual([`HEAD ${IMG}`]);
  });

  it("the HEAD stays public without a size, and only the Range GET lands there: no size", async () => {
    const calls = stub(async (url, opts) => (opts.method === "HEAD" ? res(200, IMG) : res(206, LAN, { "content-range": "bytes 0-0/4242" })));
    expect(await fetchImageSizes([IMG], undefined, PAGE)).toEqual({});
    expect(calls).toEqual([`HEAD ${IMG}`, `GET ${IMG}`]);
  });

  it("the HEAD is refused (405), and only the Range GET lands there: no size", async () => {
    stub(async (url, opts) => (opts.method === "HEAD" ? res(405, IMG) : res(206, LAN, { "content-range": "bytes 0-0/4242" })));
    expect(await fetchImageSizes([IMG], undefined, PAGE)).toEqual({});
  });

  it("measures as before when the audited page is itself local", async () => {
    stub(async () => res(200, LAN, { "content-length": "4242" }));
    expect(await fetchImageSizes(["http://localhost:8080/img.png"], undefined, "http://localhost:8080/")).toEqual({ "http://localhost:8080/img.png": 4242 });
  });

  it("an image that redirects to a public CDN is still measured", async () => {
    stub(async () => res(200, "https://cdn.example/img.png", { "content-length": "777" }));
    expect(await fetchImageSizes([IMG], undefined, PAGE)).toEqual({ [IMG]: 777 });
  });
});
