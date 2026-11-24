import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { packagedFiles } from "../tools/package-files.mjs";
import { manifestProblems, remoteCodeProblems } from "../tools/extension-policy.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
const code = packagedFiles(ROOT)
  .filter((p) => /\.(?:js|html)$/.test(p))
  .map((p) => ({ path: p, text: readFileSync(join(ROOT, p), "utf8") }));

describe("the manifest asks for what Needle promises, nothing more", () => {
  it("holds for the shipped manifest", () => {
    expect(manifestProblems(manifest)).toEqual([]);
  });

  // Each change below must be caught, or the check above proves nothing.
  const changed = (edit) => { const m = structuredClone(manifest); edit(m); return manifestProblems(m); };
  it.each([
    ["another permission", (m) => m.permissions.push("tabs")],
    ["a permission less", (m) => m.permissions.splice(m.permissions.indexOf("sidePanel"), 1)],
    ["an optional API permission", (m) => { m.optional_permissions = ["downloads"]; }],
    ["site access at install", (m) => { m.host_permissions = ["https://*/*"]; }],
    ["narrower optional site access", (m) => { m.optional_host_permissions = ["https://*/*"]; }],
    ["wider optional site access", (m) => { m.optional_host_permissions.push("<all_urls>"); }],
    ["a content script on every page", (m) => { m.content_scripts = [{ matches: ["<all_urls>"], js: ["content.js"] }]; }],
    ["pages other sites can load", (m) => { m.web_accessible_resources = [{ resources: ["popup.html"], matches: ["<all_urls>"] }]; }],
    ["messages from websites", (m) => { m.externally_connectable = { matches: ["https://*/*"] }; }],
    ["a background page instead of the module worker", (m) => { m.background = { service_worker: "background.js" }; }],
    ["eval allowed", (m) => { m.content_security_policy.extension_pages = "script-src 'self' 'unsafe-eval'; object-src 'self';"; }],
    ["scripts from a website allowed", (m) => { m.content_security_policy.extension_pages = "script-src 'self' https://cdn.example.com; object-src 'self';"; }],
    ["no script-src at all", (m) => { m.content_security_policy.extension_pages = "object-src 'self';"; }],
    ["a sandbox policy", (m) => { m.content_security_policy.sandbox = "sandbox allow-scripts; script-src 'self' 'unsafe-eval'"; }],
    ["Manifest V2", (m) => { m.manifest_version = 2; }],
    ["network rules", (m) => { m.declarative_net_request = { rule_resources: [] }; }],
    ["a replaced new-tab page", (m) => { m.chrome_url_overrides = { newtab: "popup.html" }; }],
    ["an update address outside the store", (m) => { m.update_url = "https://example.com/updates.xml"; }],
    ["a fixed key", (m) => { m.key = "MIIB"; }],
    ["plugins allowed", (m) => { m.content_security_policy.extension_pages = "script-src 'self'; object-src https://cdn.example.com;"; }]
  ])("catches %s", (_, edit) => {
    expect(changed(edit).length).toBeGreaterThan(0);
  });
});

describe("Needle runs no code from outside its package", () => {
  it("holds for every shipped script and page", () => {
    expect(code.length).toBeGreaterThan(10);
    expect(remoteCodeProblems(code)).toEqual([]);
  });

  it.each([
    ["a remote script tag", "x.html", `<script src="https://cdn.example.com/a.js"></script>`],
    ["a protocol-relative script tag", "x.html", `<script defer src=//cdn.example.com/a.js></script>`],
    ["a remote dynamic import", "x.js", `const m = await import("https://cdn.example.com/m.js");`],
    ["a computed dynamic import", "x.js", "const m = await import(url);"],
    ["a remote static import", "x.js", `import { a } from "https://cdn.example.com/m.js";`],
    ["a remote side-effect import", "x.js", `import "https://cdn.example.com/m.js";`],
    ["a re-export from an address", "x.js", `export { a } from "https://cdn.example.com/m.js";`],
    ["importScripts", "x.js", `importScripts("https://cdn.example.com/w.js");`],
    ["eval", "x.js", "const v = eval(text);"],
    ["new Function", "x.js", `const f = new Function("return 1");`],
    ["a string timer", "x.js", `setTimeout("run()", 10);`],
    ["a script element made at runtime", "x.js", `const s = document.createElement('script');`],
    ["an injected remote file", "x.js", `chrome.scripting.executeScript({ target, files: ["https://cdn.example.com/c.js"] });`]
  ])("catches %s", (_, path, text) => {
    expect(remoteCodeProblems([{ path, text }])).toHaveLength(1);
  });

  it.each([
    ["a local module script", "x.html", `<script src="popup.js" type="module"></script>`],
    ["a relative dynamic import", "x.js", `const { a } = await import("./image-rules.js");`],
    ["a relative re-export", "x.js", `export { a } from "./a.js";`],
    ["an export of a string constant", "x.js", `export const URL_TEXT = "https://example.com";`],
    ["an import type in a comment", "x.js", `/** @typedef {import("./page-fetch.js").FetchResult} R */`],
    ["a method named eval", "x.js", "const r = engine.eval(x);"],
    ["a local injected file", "x.js", `chrome.scripting.executeScript({ target, files: ["content.js"] });`],
    ["a function timer", "x.js", "setTimeout(() => run(), 10);"]
  ])("lets %s pass", (_, path, text) => {
    expect(remoteCodeProblems([{ path, text }])).toEqual([]);
  });
});
