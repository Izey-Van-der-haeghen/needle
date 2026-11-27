// npm run package: every file in the store zip carries one fixed time (ZIP_TIME), not the time it
// was last edited, so the zip depends only on the files' contents and the same commit always builds
// the same zip, byte for byte. Runs the real tools/package.mjs in a copy of the project and reads
// the zip's own headers.
import { it, expect } from "vitest";
import { cpSync, mkdtempSync, readFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { INCLUDE, packagedFiles, ZIP_TIME } from "../tools/package-files.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = JSON.parse(readFileSync(path.join(ROOT, "manifest.json"), "utf8")).version;

// Each entry's name and its MS-DOS time and date, from the central directory and from the entry's
// own (local) header.
function zipEntries(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`no central directory entry at ${p}`);
    const nameLength = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    entries.push({
      name: buf.toString("utf8", p + 46, p + 46 + nameLength),
      time: buf.readUInt16LE(p + 12), date: buf.readUInt16LE(p + 14),
      localTime: buf.readUInt16LE(local + 10), localDate: buf.readUInt16LE(local + 12)
    });
    p += 46 + nameLength + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return entries;
}

function build(dir) {
  const r = spawnSync(process.execPath, [path.join(dir, "tools/package.mjs")], { cwd: dir, encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
  return readFileSync(path.join(dir, "dist", `needle-${VERSION}.zip`));
}

it("gives every file in the zip the same fixed time, so the same files always build the same zip", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "needle-zip-"));
  for (const f of [...INCLUDE, "tools", "package.json", "package-lock.json"]) cpSync(path.join(ROOT, f), path.join(dir, f), { recursive: true });

  const first = build(dir);
  const entries = zipEntries(first);
  expect(entries.map((e) => e.name)).toEqual(packagedFiles(ROOT));
  // ZIP_TIME as MS-DOS time and date: 00:00:00 and 1 January 1980 (years since 1980 << 9 | month << 5 | day).
  expect(ZIP_TIME.toISOString()).toBe("1980-01-01T00:00:00.000Z");
  const date = (0 << 9) | (1 << 5) | 1;
  expect(entries.filter((e) => e.time !== 0 || e.date !== date || e.localTime !== 0 || e.localDate !== date).map((e) => e.name)).toEqual([]);

  // A file edited later (a new modification time) with the same contents: the same zip.
  utimesSync(path.join(dir, "popup.js"), new Date(), new Date());
  expect(build(dir).equals(first)).toBe(true);
}, 30000);
