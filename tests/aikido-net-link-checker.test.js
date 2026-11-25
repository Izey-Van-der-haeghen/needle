// Aikido round, 25 November 2026, finding 18: a public link that redirects to the user's own network.
// fetch follows the redirect, so the first request reaches the device; after that Needle must not
// ask it again with GET, and must not report the device's answer as the link's status.
import { describe, it, expect, vi, afterEach } from "vitest";
import { checkLinks, noConnection } from "../lib/link-checker.js";

const LAN = "http://192.168.1.1/cgi-bin/reboot";
const res = (status, url, redirected = false) => ({ status, url, redirected, type: "default" });

/** A stubbed fetch that lists each request as "METHOD url". */
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

describe("checkLinks: a public link that redirects to a local address", () => {
  it("stops after the HEAD that landed there: no GET, and the device's 404 is not the link's status", async () => {
    const calls = stub(async () => res(404, LAN, true));
    const [r] = await checkLinks(["https://attacker.example/r"], undefined, "https://blog.example/post");
    expect(calls).toEqual(["HEAD https://attacker.example/r"]);
    expect(r).toMatchObject({ url: "https://attacker.example/r", status: 0, kind: "redirect", finalUrl: LAN, local: true });
  });

  it("also catches a server that answers the HEAD itself and redirects only the GET", async () => {
    const calls = stub(async (url, opts) => (opts.method === "HEAD" ? res(405, url) : res(404, LAN, true)));
    const [r] = await checkLinks(["https://attacker.example/r"], undefined, "https://blog.example/post");
    expect(calls).toEqual(["HEAD https://attacker.example/r", "GET https://attacker.example/r"]);
    expect(r).toMatchObject({ status: 0, kind: "redirect", finalUrl: LAN, local: true });
  });

  it("follows such redirects as before when the audited page is itself local", async () => {
    const calls = stub(async () => res(404, LAN, true));
    const [r] = await checkLinks(["http://localhost:3000/r"], undefined, "http://localhost:3000/");
    expect(calls).toEqual(["HEAD http://localhost:3000/r", "GET http://localhost:3000/r"]);
    expect(r).toMatchObject({ status: 404, kind: "broken" });
    expect(r.local).toBeUndefined();
  });

  it("a redirect to another public address is an ordinary redirect", async () => {
    stub(async () => res(200, "https://www.example.com/new", true));
    const [r] = await checkLinks(["https://example.com/old"], undefined, "https://blog.example/post");
    expect(r).toMatchObject({ status: 200, kind: "redirect", finalUrl: "https://www.example.com/new" });
    expect(r.local).toBeUndefined();
  });
});

describe("checkLinks: local forms the literal-address check missed (finding 21)", () => {
  it.each(["http://100.64.0.1/", "http://[::192.168.1.1]/"])("skips %s without a request", async (u) => {
    const calls = stub(async (url) => res(200, url));
    const [r] = await checkLinks([u], undefined, "https://blog.example/post");
    expect(calls).toEqual([]);
    expect(r).toMatchObject({ url: u, kind: "skipped" });
  });
});

// Review of finding 21: a one-word host used to come out "broken" (the name didn't resolve), which
// fed the "broken links" finding. Skipping it hid leftover placeholders and typos. Visitors of a
// public page can't reach such a host, so it stays broken, still without a request.
describe("checkLinks: a one-word host on a public page", () => {
  it.each(["http://yourwebsite/", "https://linkedin/company/x", "http://www/", "http://intranet/wiki"])("reports %s as broken without a request", async (u) => {
    const calls = stub(async (url) => res(200, url));
    const [r] = await checkLinks([u], undefined, "https://blog.example/post");
    expect(calls).toEqual([]);
    expect(r).toMatchObject({ url: u, status: 0, kind: "broken", oneWordHost: true });
  });

  it("is not a lost connection: those links were never requested", async () => {
    stub(async (url) => res(200, url));
    const results = await checkLinks(["http://yourwebsite/", "http://www/"], undefined, "https://blog.example/post");
    expect(results.map((r) => r.kind)).toEqual(["broken", "broken"]);
    expect(noConnection(results)).toBe(false);
  });

  it("leaves localhost skipped, as before", async () => {
    const calls = stub(async (url) => res(200, url));
    const [r] = await checkLinks(["http://localhost:3000/"], undefined, "https://blog.example/post");
    expect(calls).toEqual([]);
    expect(r).toMatchObject({ kind: "skipped" });
    expect(r.oneWordHost).toBeUndefined();
  });

  it("is requested as usual when the audited page is itself on the user's network", async () => {
    const calls = stub(async (url) => res(200, url));
    const [r] = await checkLinks(["http://wiki/start"], undefined, "http://intranet/home");
    expect(calls).toEqual(["HEAD http://wiki/start"]);
    expect(r).toMatchObject({ status: 200, kind: "ok" });
  });
});

// The doc comment of checkLinks lists what still reaches the device: fetch hides the hops, so when the
// device hangs or refuses the connection there is no final URL to check. These pin that description.
describe("checkLinks: what a device behind a redirect still receives", () => {
  /** The public host redirects every request (or, with onlyGet, answers the HEAD itself with 405). */
  function device(onlyGet, behaviours) {
    const log = [];
    let n = 0;
    globalThis.fetch = vi.fn(async (url, o) => {
      const kind = `${o.method}${o.mode === "no-cors" ? " no-cors" : ""}`;
      if (onlyGet && o.method === "HEAD") { log.push(`${kind} -> public`); return res(405, url); }
      log.push(`${kind} -> LAN`);
      const b = behaviours[Math.min(n++, behaviours.length - 1)];
      if (b === "hang") throw new DOMException("Timed out", "TimeoutError");
      if (b === "refuse") throw new TypeError("Failed to fetch");
      return { status: 0, type: "opaque", url: "" };
    });
    return log;
  }

  it("hangs, then refuses: one more HEAD after our deadline, then a no-cors GET (three in all)", async () => {
    const log = device(false, ["hang", "refuse"]);
    await checkLinks(["https://attacker.example/r"], undefined, "https://blog.example/post");
    expect(log).toEqual(["HEAD -> LAN", "HEAD -> LAN", "GET no-cors -> LAN"]);
  });

  it("only the GET is redirected and the device hangs: the retry sends it another full GET", async () => {
    const log = device(true, ["hang"]);
    const [r] = await checkLinks(["https://attacker.example/r"], undefined, "https://blog.example/post");
    expect(log).toEqual(["HEAD -> public", "GET -> LAN", "HEAD -> public", "GET -> LAN"]);
    expect(r).toMatchObject({ kind: "timeout" });
  });
});
