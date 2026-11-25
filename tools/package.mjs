// Build the Chrome Web Store upload: dist/needle-<version>.zip with only the
// files the extension needs. Run: npm run package
//
// It refuses to build when a file outside the allow-list is referenced, when
// the manifest version and package.json disagree, or when the shipped files
// mention things that must not be published.
import { readFileSync, statSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { packagedFiles, notPackaged } from "./package-files.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// The allow-list (INCLUDE) is in tools/package-files.mjs.
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
const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
if (manifest.version !== pkg.version || lock.version !== pkg.version || lock.packages?.[""]?.version !== pkg.version) {
  console.error(`manifest.json (${manifest.version}), package.json (${pkg.version}) and package-lock.json (${lock.version} / ${lock.packages?.[""]?.version}) disagree on the version.`);
  process.exit(1);
}

let files;
try { files = packagedFiles(ROOT); } catch (e) { console.error(e.message); process.exit(1); }

for (const f of files) {
  if (!/\.(js|json|html|css|txt)$/.test(f)) continue;
  const text = readFileSync(join(ROOT, f), "utf8");
  for (const re of FORBIDDEN) {
    if (re.test(text)) { console.error(`Refusing to package: ${f} matches ${re}`); process.exit(1); }
  }
}

// Every file the pages, the manifest, the stylesheets and the scripts load must be in the package.
const missing = notPackaged(ROOT, files, manifest);
if (missing.length) { console.error(`Referenced but not packaged: ${missing.join(", ")}`); process.exit(1); }

const outDir = join(ROOT, "dist");
mkdirSync(outDir, { recursive: true });
const zip = join(outDir, `needle-${manifest.version}.zip`);
if (existsSync(zip)) rmSync(zip);
execFileSync("zip", ["-X", "-q", zip, ...files], { cwd: ROOT });
const kb = (statSync(zip).size / 1024).toFixed(0);
console.log(`Wrote ${relative(ROOT, zip)} (${files.length} files, ${kb} KB)`);
