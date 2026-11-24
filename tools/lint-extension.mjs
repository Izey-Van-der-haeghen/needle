// Lint the store package with Mozilla's addons-linter, read for Chrome.
//
//   npm run lint:extension                  lint; exit 1 on a problem
//   node tools/lint-extension.mjs --prove   first show that planted problems fail the lint
//
// addons-linter checks an extension's manifest, content security policy, remote and dynamic code
// and unsafe HTML. It is written for Firefox, so the codes that only matter there are dropped
// (each with its reason below). What is left fails the lint, with one exception: the HTML that
// popup.js builds from escaped text. Those places are counted per file; a new one fails the lint
// until it has been checked and the count below raised.
//
// It runs a pinned version with npx (downloaded once, then cached), on a copy of exactly the files
// the store package ships (tools/package-files.mjs).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { copyPackage as copyFiles } from "./package-files.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// Pinned, and at least two weeks old when chosen (a newly published version can be a bad one).
const LINTER = "addons-linter@10.15.0";

/** Codes that only apply to Firefox. */
const FIREFOX_ONLY = {
  ADDON_ID_REQUIRED: "Firefox needs browser_specific_settings.gecko.id; Chrome takes the id from the store",
  MISSING_DATA_COLLECTION_PERMISSIONS: "Firefox's data-collection consent; Chrome uses the store's privacy tab",
  STORAGE_SYNC: "about Firefox's temporary add-ons; storage.sync works in Chrome"
};
/** Permissions and APIs Chrome has and Firefox doesn't. */
const CHROME_ONLY_PERMISSIONS = ["sidePanel"];
const CHROME_ONLY_API = /^sidePanel\./;

/**
 * HTML built from escaped text (escapeHtml in lib/popup-helpers.js), counted per file and code on
 * 24 November 2026. A new place raises the count: check that page text in it is escaped, then
 * raise the number here.
 */
const KNOWN_HTML = { "popup.js": { UNSAFE_VAR_ASSIGNMENT: 18 } };

// Only a message that names Chrome-only permissions, and nothing else, is dropped.
const chromeOnlyPermission = (m) => {
  const named = [...m.message.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  return m.code === "MANIFEST_PERMISSIONS" && named.length > 0 && named.every((p) => CHROME_ONLY_PERMISSIONS.includes(p));
};
const chromeOnlyApi = (m) => m.code === "UNSUPPORTED_API" && CHROME_ONLY_API.test(/^(\S+) is not supported/.exec(m.message)?.[1] || "");

const copyPackage = (dir, plant) => copyFiles(ROOT, dir, plant);

/** Run the linter on a directory and keep what matters for Chrome. */
function lint(dir) {
  const run = spawnSync("npx", ["--yes", LINTER, "--output", "json", "--self-hosted", "--enable-background-service-worker", dir],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  let report;
  try { report = JSON.parse(run.stdout); } catch { throw new Error(`addons-linter gave no report (exit ${run.status}): ${(run.stderr || "").slice(-800)}`); }
  const all = [...report.errors.map((m) => ({ ...m, level: "error" })), ...report.warnings.map((m) => ({ ...m, level: "warning" })), ...report.notices.map((m) => ({ ...m, level: "notice" }))];
  const dropped = all.filter((m) => m.code in FIREFOX_ONLY || chromeOnlyPermission(m) || chromeOnlyApi(m));
  const kept = all.filter((m) => !dropped.includes(m));
  const problems = [];
  const counted = {};
  for (const m of kept) {
    const known = KNOWN_HTML[m.file]?.[m.code];
    if (known !== undefined) { (counted[`${m.file} ${m.code}`] ??= []).push(m); continue; }
    if (m.level !== "notice") problems.push(`${m.level} ${m.code} ${m.file || ""}${m.line ? `:${m.line}` : ""}: ${m.message}`);
  }
  for (const [file, codes] of Object.entries(KNOWN_HTML)) {
    for (const [code, n] of Object.entries(codes)) {
      const found = counted[`${file} ${code}`] || [];
      // Any difference fails: after one place is removed, a new unescaped one would otherwise keep the count.
      if (found.length > n) problems.push(`${file}: ${found.length} ${code} (known: ${n}). Lines ${found.map((m) => m.line).join(", ")}: check the new one escapes page text, then set the count to ${found.length} in tools/lint-extension.mjs`);
      else if (found.length < n) problems.push(`${file}: ${found.length} ${code}, fewer than the known ${n}: set the count to ${found.length} in tools/lint-extension.mjs`);
    }
  }
  const notices = kept.filter((m) => m.level === "notice" && KNOWN_HTML[m.file]?.[m.code] === undefined);
  return { problems, dropped, notices, counted };
}

const edit = (file, from, to) => {
  const s = fs.readFileSync(file, "utf8");
  if (!s.includes(from)) throw new Error(`planting failed: "${from}" not in ${path.basename(file)}`);
  fs.writeFileSync(file, s.replace(from, to));
};
const PLANTED = [
  ["eval in the service worker", (d) => fs.appendFileSync(path.join(d, "background.js"), '\nconst plantedValue = eval("1 + 1");\n')],
  ["a script from a website in the popup", (d) => edit(path.join(d, "popup.html"), '<script src="theme-boot.js"></script>', '<script src="theme-boot.js"></script>\n    <script src="https://cdn.example.com/x.js"></script>')],
  ["eval allowed by the content security policy", (d) => edit(path.join(d, "manifest.json"), "script-src 'self';", "script-src 'self' 'unsafe-eval';")],
  ["one more unescaped HTML assignment", (d) => fs.appendFileSync(path.join(d, "popup.js"), "\nexport function planted(t) { document.body.innerHTML = t; }\n")],
  ["one HTML assignment fewer (the count must follow)", (d) => edit(path.join(d, "popup.js"), "btn.innerHTML = btn.dataset.label;", "btn.textContent = btn.dataset.label;")]
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "needle-lint-"));
let exitCode = 0;
try {
  if (process.argv.includes("--prove")) {
    console.log(`Proving the lint (${LINTER}) on planted problems…`);
    for (const [i, [name, plant]] of PLANTED.entries()) {
      const { problems } = lint(copyPackage(path.join(tmp, `planted-${i}`), plant));
      console.log(`  ${problems.length ? "✓" : "✗"} ${name}: ${problems.length ? `caught (${problems[0].slice(0, 110)})` : "NOT caught"}`);
      if (!problems.length) exitCode = 1;
    }
    if (exitCode) console.log("The lint missed a planted problem: fix it before trusting it.");
  }
  if (!exitCode) {
    console.log(`Linting the store package with ${LINTER}, read for Chrome…`);
    const { problems, dropped, notices, counted } = lint(copyPackage(path.join(tmp, "clean")));
    const byCode = dropped.reduce((a, m) => ({ ...a, [m.code]: (a[m.code] || 0) + 1 }), {});
    console.log(`  dropped as Firefox-only: ${Object.entries(byCode).map(([c, n]) => `${c} ×${n}`).join(", ") || "none"}`);
    for (const [k, list] of Object.entries(counted)) console.log(`  known HTML from escaped text: ${k} ×${list.length}`);
    notices.forEach((m) => console.log(`  notice ${m.code} ${m.file || ""}: ${m.message}`));
    problems.forEach((p) => console.log(`  ✗ ${p}`));
    console.log(problems.length ? `FAIL: ${problems.length} problem(s)` : "PASS");
    exitCode = problems.length ? 1 : 0;
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(exitCode);
