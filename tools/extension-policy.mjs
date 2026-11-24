// What Needle promises about itself, as checks: the permissions it asks for, and that it runs no
// code from outside the package. Used by tests/extension-policy.test.js.
//
// A change here is a product decision (README, store listing, privacy policy), not a fix to make a
// test pass.

/** The permissions Needle asks for at install. Access to websites is optional and asked at runtime. */
export const PERMISSIONS = ["activeTab", "contextMenus", "scripting", "sidePanel", "storage"];
export const OPTIONAL_HOST_PERMISSIONS = ["http://*/*", "https://*/*"];

const sorted = (a) => [...(a || [])].sort();
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/**
 * Where the manifest asks for more than Needle promises: other permissions, site access at
 * install, a content script on every page, pages other sites can load or message, or a content
 * security policy that allows code from elsewhere.
 * @param {Object} manifest
 * @returns {string[]} one line per problem; empty when the manifest keeps the promise
 */
export function manifestProblems(manifest) {
  const out = [];
  if (manifest.manifest_version !== 3) out.push("manifest_version is not 3");
  if (!same(manifest.permissions, PERMISSIONS)) out.push(`permissions are ${JSON.stringify(sorted(manifest.permissions))}, not ${JSON.stringify(PERMISSIONS)}`);
  if (!same(manifest.optional_permissions, [])) out.push(`optional_permissions ${JSON.stringify(manifest.optional_permissions)}: none promised`);
  if (!same(manifest.host_permissions, [])) out.push(`host_permissions ${JSON.stringify(manifest.host_permissions)}: access to websites must stay optional`);
  if (!same(manifest.optional_host_permissions, OPTIONAL_HOST_PERMISSIONS)) out.push(`optional_host_permissions are ${JSON.stringify(sorted(manifest.optional_host_permissions))}`);
  for (const key of ["content_scripts", "web_accessible_resources", "externally_connectable", "declarative_net_request", "chrome_url_overrides", "update_url", "key"]) {
    if (key in manifest) out.push(`"${key}" is set: Needle has none`);
  }
  if (manifest.background?.service_worker !== "background.js" || manifest.background?.type !== "module" || Object.keys(manifest.background || {}).length !== 2) {
    out.push(`background is ${JSON.stringify(manifest.background)}, not the module service worker background.js`);
  }
  const csp = manifest.content_security_policy || {};
  if (Object.keys(csp).some((k) => k !== "extension_pages")) out.push(`content_security_policy has ${Object.keys(csp).join(", ")}: only extension_pages`);
  const scriptSrc = /(?:^|;)\s*script-src\s+([^;]*)/.exec(csp.extension_pages || "")?.[1].trim();
  if (scriptSrc !== "'self'") out.push(`script-src is "${scriptSrc ?? "(not set)"}", not 'self'`);
  const objectSrc = /(?:^|;)\s*object-src\s+([^;]*)/.exec(csp.extension_pages || "")?.[1].trim();
  if (objectSrc && objectSrc !== "'self'" && objectSrc !== "'none'") out.push(`object-src is "${objectSrc}"`);
  return out;
}

const REMOTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;   // a scheme (https:, data:, blob:) or a protocol-relative address

/**
 * Code that would run something not in the package: a script tag, import or injected file from
 * an address, eval and its relatives, or a script element made at runtime.
 * @param {Array<{path: string, text: string}>} files - the packaged .js and .html files
 * @returns {string[]} "file:line: what" per problem
 */
export function remoteCodeProblems(files) {
  const out = [];
  const at = (f, index, what) => out.push(`${f.path}:${f.text.slice(0, index).split("\n").length}: ${what}`);
  for (const f of files) {
    if (f.path.endsWith(".html")) {
      for (const m of f.text.matchAll(/<script\b([^>]*)>/gi)) {
        const src = /\bsrc\s*=\s*["']?([^"'\s>]+)/i.exec(m[1])?.[1];
        if (src && REMOTE.test(src)) at(f, m.index, `script from ${src}`);
      }
      continue;
    }
    if (!f.path.endsWith(".js")) continue;
    const rules = [
      [/\bimport\s*\(\s*(["'`])([^"'`]*)\1/g, (m) => !/^\.{1,2}\//.test(m[2]) && `import("${m[2]}")`],
      [/\bimport\s*\(\s*(?!["'`])/g, () => "import() of a computed address"],
      // import … from "x" and export … from "x"; import "x"
      [/^\s*(?:import|export)\b[^;'"]*?\bfrom\s*(["'])([^"']*)\1/gm, (m) => !/^\.{1,2}\//.test(m[2]) && `${m[0].trim().split(/\s/)[0]} from "${m[2]}"`],
      [/^\s*import\s*(["'])([^"']*)\1/gm, (m) => !/^\.{1,2}\//.test(m[2]) && `import "${m[2]}"`],
      [/\bimportScripts\s*\(/g, () => "importScripts()"],
      [/(?<![.\w])eval\s*\(/g, () => "eval()"],
      [/\bnew\s+Function\s*\(/g, () => "new Function()"],
      [/\bset(?:Timeout|Interval)\s*\(\s*["'`]/g, () => "setTimeout/setInterval with a string"],
      [/createElement\s*\(\s*["'`]script["'`]/gi, () => "a script element made at runtime"],
      [/\bfiles\s*:\s*\[([^\]]*)\]/g, (m) => [...m[1].matchAll(/["'`]([^"'`]+)["'`]/g)].some((x) => REMOTE.test(x[1])) && `executeScript files ${m[1].trim()}`]
    ];
    for (const [re, what] of rules) {
      for (const m of f.text.matchAll(re)) {
        const w = what(m);
        if (w) at(f, m.index, w);
      }
    }
  }
  return out;
}
