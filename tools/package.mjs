// Build the Chrome Web Store upload: dist/needle-<version>.zip with only the
// files the extension needs. Run: npm run package
//
// It refuses to build when a file outside the allow-list is referenced, when
// the manifest version and package.json disagree, or when the shipped files
// mention things that must not be published.
import { readFileSync, readdirSync, statSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const INCLUDE = [
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
// Things that must never ship: local paths, API keys pasted into code, placeholders,
// plus private words listed one per line in tools/forbidden.local.txt (git-ignored).
const FORBIDDEN = [/\/Users\//, /api[_-]?key\s*[:=]\s*["'][A-Za-z0-9_-]{20,}/i, /\[support email\]/];
const localList = join(ROOT, "tools", "forbidden.local.txt");
if (existsSync(localList)) {
  for (const word of readFileSync(localList, "utf8").split(/\r?\n/).map((w) => w.trim()).filter(Boolean)) {
    FORBIDDEN.push(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
}

const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
if (manifest.version !== pkg.version) {
  console.error(`manifest.json (${manifest.version}) and package.json (${pkg.version}) disagree on the version.`);
  process.exit(1);
}

const files = [];
const walk = (p) => {
  const abs = join(ROOT, p);
  if (!existsSync(abs)) { console.error(`Missing: ${p}`); process.exit(1); }
  if (statSync(abs).isDirectory()) readdirSync(abs).forEach((f) => walk(join(p, f)));
  else if (!/(^|\/)\.DS_Store$/.test(p)) files.push(p);
};
INCLUDE.forEach(walk);

for (const f of files) {
  if (!/\.(js|json|html|css|txt)$/.test(f)) continue;
  const text = readFileSync(join(ROOT, f), "utf8");
  for (const re of FORBIDDEN) {
    if (re.test(text)) { console.error(`Refusing to package: ${f} matches ${re}`); process.exit(1); }
  }
}

// Every file the HTML pages and the manifest point to must be in the package.
const referenced = new Set();
for (const page of ["popup.html", "options.html", "privacy.html"]) {
  for (const m of readFileSync(join(ROOT, page), "utf8").matchAll(/(?:src|href)="([^":#?]+\.(?:js|css|html))"/g)) referenced.add(m[1]);
}
Object.values(manifest.icons).forEach((i) => referenced.add(i));
referenced.add(manifest.background.service_worker);
for (const r of referenced) {
  if (!files.includes(r)) { console.error(`Referenced but not packaged: ${r}`); process.exit(1); }
}

const outDir = join(ROOT, "dist");
mkdirSync(outDir, { recursive: true });
const zip = join(outDir, `needle-${manifest.version}.zip`);
if (existsSync(zip)) rmSync(zip);
execFileSync("zip", ["-X", "-q", zip, ...files], { cwd: ROOT });
const kb = (statSync(zip).size / 1024).toFixed(0);
console.log(`Wrote ${relative(ROOT, zip)} (${files.length} files, ${kb} KB)`);
