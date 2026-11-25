// The final check before 1.0.3: small wording and release-tool points.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { variantsLoadingText, checkHostVariants } from "../lib/variants.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("the versions check's waiting text", () => {
  it("names as many versions as it requests", async () => {
    const asked = async (url) => { const seen = []; await checkHostVariants(url, async (u) => { seen.push(u); return { status: 200, url: u }; }); return seen.length; };
    expect(variantsLoadingText("https://www.example.be/fr/")).toBe("Requesting the four versions of the home page…");
    expect(await asked("https://www.example.be/fr/")).toBe(4);
    expect(variantsLoadingText("https://shop.example.be/")).toBe("Requesting the two versions of the home page…");
    expect(await asked("https://shop.example.be/")).toBe(2);
  });
});

describe("npm run package", () => {
  it("refuses a package-lock.json whose version differs from package.json and the manifest", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "needle-pack-"));
    try {
      for (const f of ["package.json", "package-lock.json", "manifest.json", "tools"]) cpSync(path.join(ROOT, f), path.join(dir, f), { recursive: true });
      const lockFile = path.join(dir, "package-lock.json");
      const lock = JSON.parse(readFileSync(lockFile, "utf8"));
      lock.version = "0.0.1";
      writeFileSync(lockFile, JSON.stringify(lock));
      const r = spawnSync(process.execPath, [path.join(dir, "tools/package.mjs")], { cwd: dir, encoding: "utf8" });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/package-lock\.json \(0\.0\.1/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
