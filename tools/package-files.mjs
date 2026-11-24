// What goes into the Chrome Web Store package, and what the shipped files load.
// Used by tools/package.mjs; tested in tests/package-files.test.js.
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join, posix, dirname } from "node:path";

export const INCLUDE = [
  "manifest.json",
  "background.js",
  "content.js",
  "theme-boot.js",
  "popup.html", "popup.js", "popup.css",
  "options.html", "options.js", "options.css",
  "privacy.html",
  "base.css",
  "_locales",
  "fonts",
  "icons",
  "lib",
  "LICENSE"
];

/**
 * Every file under the INCLUDE entries, relative to root.
 * @param {string} root
 * @param {string[]} [include]
 * @returns {string[]}
 * @throws {Error} when an entry doesn't exist
 */
export function packagedFiles(root, include = INCLUDE) {
  const files = [];
  const walk = (p) => {
    const abs = join(root, p);
    if (!existsSync(abs)) throw new Error(`Missing: ${p}`);
    if (statSync(abs).isDirectory()) readdirSync(abs).forEach((f) => walk(posix.join(p, f)));
    else if (!/(^|\/)\.DS_Store$/.test(p)) files.push(p);
  };
  include.forEach(walk);
  return files;
}

/**
 * Every file the extension loads, relative to root: the manifest's pages, icons, service worker and
 * default-locale messages, src and href in the packaged HTML pages, url(…) and @import in the packaged stylesheets (relative to the
 * stylesheet), relative imports in the packaged scripts (relative to the script), and the files
 * chrome.scripting.executeScript injects (relative to the extension root).
 * @param {string} root
 * @param {string[]} files - the packaged files, whose stylesheets and scripts are read
 * @param {Object} manifest
 * @returns {Set<string>}
 */
export function referencedFiles(root, files, manifest) {
  const read = (f) => readFileSync(join(root, f), "utf8");
  const isLocal = (ref) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref);
  const resolve = (file, ref) => posix.normalize(posix.join(posix.dirname(file), ref.replace(/[?#].*$/, "")));
  const referenced = new Set();
  // What the manifest itself loads: its pages, icons, worker and the default locale's messages.
  [
    manifest.action?.default_popup, manifest.options_ui?.page, manifest.side_panel?.default_path,
    ...Object.values(manifest.action?.default_icon || {}), ...Object.values(manifest.icons || {}),
    manifest.background?.service_worker,
    manifest.default_locale && `_locales/${manifest.default_locale}/messages.json`
  ].filter(Boolean).forEach((f) => referenced.add(f));
  // Every packaged page, and what it loads (relative to the page).
  for (const page of files.filter((x) => x.endsWith(".html"))) {
    for (const m of read(page).matchAll(/(?:src|href)="([^":#?]+\.(?:js|css|html))"/g)) referenced.add(resolve(page, m[1]));
  }
  for (const f of files.filter((x) => x.endsWith(".css"))) {
    for (const m of read(f).matchAll(/url\(\s*["']?([^"')]+?)["']?\s*\)|@import\s+["']([^"']+)["']/g)) {
      const ref = (m[1] || m[2]).trim();
      if (isLocal(ref)) referenced.add(resolve(f, ref));
    }
  }
  for (const f of files.filter((x) => x.endsWith(".js"))) {
    const text = read(f);
    // import … from "./x.js", export … from "./x.js", import "./x.js", import("./x.js")
    for (const m of text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) referenced.add(resolve(f, m[1]));
    // executeScript({ target, files: ["content.js"] })
    for (const m of text.matchAll(/\bfiles\s*:\s*\[([^\]]*)\]/g)) {
      for (const s of m[1].matchAll(/["']([^"']+)["']/g)) referenced.add(posix.normalize(s[1].replace(/^\//, "")));
    }
  }
  return referenced;
}

/**
 * The files the extension loads that the package leaves out: the build must stop on any.
 * @param {string} root
 * @param {string[]} files
 * @param {Object} manifest
 * @returns {string[]}
 */
export function notPackaged(root, files, manifest) {
  return [...referencedFiles(root, files, manifest)].filter((r) => !files.includes(r));
}

/**
 * Copy exactly the packaged files to a folder, for a check that loads or lints the store package;
 * `plant(dir)` then breaks the copy on purpose, to prove the check catches it.
 * @param {string} root
 * @param {string} dir
 * @param {(dir: string) => void} [plant]
 * @returns {string} dir
 */
export function copyPackage(root, dir, plant) {
  for (const f of packagedFiles(root)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    copyFileSync(join(root, f), join(dir, f));
  }
  plant?.(dir);
  return dir;
}
