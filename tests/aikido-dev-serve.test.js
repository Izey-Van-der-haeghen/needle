// dev/preview/serve.js serves only the store package's files and the harness, answers only requests
// addressed to localhost, and survives a NUL byte in the path (Aikido findings 6 and 7, 25 November 2026).
// The server runs as a child process on a free port, bound to 127.0.0.1, against a fixture root full of
// canary files, so the private files exist wherever the test runs (a fresh clone has no notes/ or CLAUDE.md).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packagedFiles } from "../tools/package-files.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVE = path.join(REPO, "dev/preview/serve.js");
const STUB_TAG = '<script src="/__preview/chrome-stub.js"></script>';

/** A port nothing listens on right now, on 127.0.0.1. */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Start serve.js; resolves once it prints its address. */
async function start(args = []) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVE, "--port", String(port), ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`serve.js did not start:\n${log}`)), 10000);
    child.stdout.on("data", (d) => {
      log += d;
      if (log.includes("Needle preview")) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on("data", (d) => { log += d; });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`serve.js exited with ${code}:\n${log}`)); });
  });
  return { port, child, log: () => log };
}

function stop(server) {
  if (!server || server.child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    server.child.once("exit", resolve);
    server.child.kill();
  });
}

/** GET a raw request target (sent as is, not normalised), with a chosen Host header. */
function get(port, target, host = `localhost:${port}`) {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path: target, headers: { host }, agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on("error", (e) => resolve({ status: 0, body: "", error: e.code || e.message }));
    req.setTimeout(5000, () => req.destroy(new Error("timeout")));
    req.end();
  });
}

describe("serve.js against a root with private files", () => {
  let tmp, root, server;
  const write = (rel, text) => {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  };

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "needle-serve-"));
    root = path.join(tmp, "root");
    fs.writeFileSync(path.join(tmp, "outside.txt"), "CANARY-OUTSIDE");
    write("manifest.json", '{"name":"fixture"}');
    write("popup.html", "<!doctype html><html><head><title>x</title></head><body>FIXTURE-POPUP</body></html>");
    write("lib/a.js", "FIXTURE-LIB");
    write("icons/icon48.png", "FIXTURE-ICON");
    write("CLAUDE.md", "CANARY-CLAUDE");
    write("PUBLISHING.md", "CANARY-PUBLISHING");
    write("notes/LESSONS.md", "CANARY-NOTES");
    write("tools/forbidden.local.txt", "CANARY-FORBIDDEN");
    write("tests/x.test.js", "CANARY-TESTS");
    write(".git/config", "CANARY-GIT");
    write(".env", "CANARY-ENV");
    write("node_modules/x/index.js", "CANARY-NODE-MODULES");
    write("%00", "CANARY-PERCENT");
    server = await start(["--root", root]);
  });

  afterAll(async () => {
    await stop(server);
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("serves the package's files, with the stub in the root pages, and the harness", async () => {
    const popup = await get(server.port, "/popup.html");
    expect(popup.status).toBe(200);
    expect(popup.body).toContain("FIXTURE-POPUP");
    expect(popup.body).toContain(STUB_TAG);
    expect((await get(server.port, "/lib/a.js")).body).toBe("FIXTURE-LIB");
    expect((await get(server.port, "/manifest.json")).status).toBe(200);
    expect((await get(server.port, "/favicon.ico")).body).toBe("FIXTURE-ICON");
    expect((await get(server.port, "/")).status).toBe(302);
    const stub = await get(server.port, "/__preview/chrome-stub.js");
    expect(stub.status).toBe(200);
    expect(stub.body).toContain("chrome");
    expect((await get(server.port, "/__preview/fixtures/riverside.json")).status).toBe(200);
  });

  it.each([
    "/CLAUDE.md",
    "/PUBLISHING.md",
    "/notes/LESSONS.md",
    "/tools/forbidden.local.txt",
    "/tests/x.test.js",
    "/.git/config",
    "/.env",
    "/node_modules/x/index.js"
  ])("does not serve %s", async (target) => {
    const r = await get(server.port, target);
    expect(r.status).toBe(404);
    expect(r.body).not.toMatch(/CANARY/);
  });

  // An encoded slash is no dot segment to the URL parser, so a check on the URL's first segment
  // would let these through; path.join resolves them to the private file.
  it.each([
    "/lib/..%2fCLAUDE.md",
    "/lib/..%2FCLAUDE.md",
    "/lib/%2e%2e%2fnotes/LESSONS.md",
    "/lib/%2E%2E%2Fnotes%2FLESSONS.md",
    "/lib/..%2f.git/config",
    "/lib/..%2ftools/forbidden.local.txt",
    "/icons/..%2f..%2froot/.env",
    "/lib/..%2f%2e%2e%2froot%2fCLAUDE.md",
    "/%2e%2e/CLAUDE.md",
    "/lib/%2e%2e/CLAUDE.md",
    "/lib/../CLAUDE.md",
    "/../CLAUDE.md",
    "/lib%5c..%5cCLAUDE.md"
  ])("does not serve a private file through %s", async (target) => {
    const r = await get(server.port, target);
    expect([403, 404]).toContain(r.status);
    expect(r.body).not.toMatch(/CANARY/);
  });

  it.each([
    "/lib/..%2f..%2foutside.txt",
    "/lib/%2e%2e%2f%2e%2e%2foutside.txt",
    "/../outside.txt",
    "/%2e%2e/outside.txt",
    "/__preview/..%2f..%2f..%2fCLAUDE.md",
    "/__preview/..%2fserve.js"
  ])("does not leave its folders through %s", async (target) => {
    const r = await get(server.port, target);
    expect([403, 404]).toContain(r.status);
    expect(r.body).not.toMatch(/CANARY/);
  });

  it("treats %2500 as the literal name %00, not as a NUL byte", async () => {
    const r = await get(server.port, "/%2500");
    expect(r.status).toBe(404);
    expect(r.body).not.toMatch(/CANARY/);
  });

  it("answers only requests addressed to localhost or 127.0.0.1 on its port (DNS rebinding)", async () => {
    const { port } = server;
    for (const host of ["attacker.example", `attacker.example:${port}`, "localhost", `localhost:${port + 1}`, `127.0.0.2:${port}`, `localhost.attacker.example:${port}`]) {
      const r = await get(port, "/lib/a.js", host);
      expect(r.status, host).toBe(421);
      expect(r.body, host).not.toContain("FIXTURE-LIB");
    }
    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `LocalHost:${port}`]) {
      const r = await get(port, "/lib/a.js", host);
      expect(r.status, host).toBe(200);
      expect(r.body, host).toBe("FIXTURE-LIB");
    }
  });

  it("answers a request without a Host header with 421", async () => {
    const reply = await new Promise((resolve, reject) => {
      const sock = net.connect(server.port, "127.0.0.1", () => sock.write("GET /lib/a.js HTTP/1.0\r\n\r\n"));
      let data = "";
      sock.setEncoding("utf8");
      sock.on("data", (c) => { data += c; });
      sock.on("end", () => resolve(data));
      sock.on("error", reject);
    });
    expect(reply).toMatch(/^HTTP\/1\.[01] 421 /);
    expect(reply).not.toContain("FIXTURE-LIB");
  });
});

// fs.readFile throws synchronously on a NUL byte, and nothing caught it: one request stopped the server.
// Its own server, so a crash here cannot fail the other tests.
describe("serve.js and a NUL byte in the path", () => {
  let server;
  beforeAll(async () => { server = await start(); });
  afterAll(async () => { await stop(server); });

  it("answers 400 and keeps running", async () => {
    const targets = ["/%00", "/__preview/%00", "/popup.html%00.png", "/lib/popup-helpers.js%00", "/__preview/chrome-stub.js%00"];
    const statuses = {};
    for (const target of targets) statuses[target] = (await get(server.port, target)).status;
    const after = await get(server.port, "/popup.html");
    expect(statuses).toEqual(Object.fromEntries(targets.map((t) => [t, 400])));
    expect(server.child.exitCode, server.log()).toBeNull();
    expect(after.status).toBe(200);
  });
});

describe("serve.js against the real repo", () => {
  let server;
  beforeAll(async () => { server = await start(); });
  afterAll(async () => { await stop(server); });

  it("serves every file of the store package", async () => {
    const files = packagedFiles(REPO);
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const r = await get(server.port, "/" + f.split("/").map(encodeURIComponent).join("/"));
      expect(r.status, f).toBe(200);
    }
  });

  it("serves what the preview and the store images load", async () => {
    for (const target of [
      "/popup.html", "/options.html", "/favicon.ico", "/manifest.json", "/_locales/en/messages.json",
      "/fonts/fonts.css", "/icons/icon128.png",
      "/__preview/chrome-stub.js", "/__preview/fixtures/riverside.json",
      "/__preview/store-frame.html", "/__preview/promo.html"
    ]) {
      const r = await get(server.port, target);
      expect(r.status, target).toBe(200);
    }
    const popup = await get(server.port, "/popup.html?theme=light&delay=0");
    expect(popup.body).toContain(STUB_TAG);
  });

  it("does not serve the rest of the repo", async () => {
    for (const target of ["/package.json", "/README.md", "/CLAUDE.md", "/notes/LESSONS.md", "/.git/config", "/.gitignore", "/tools/package-files.mjs", "/tests/aikido-dev-serve.test.js", "/dev/preview/serve.js"]) {
      const r = await get(server.port, target);
      expect(r.status, target).toBe(404);
    }
  });
});
