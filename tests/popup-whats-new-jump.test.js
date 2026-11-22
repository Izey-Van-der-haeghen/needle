// @vitest-environment jsdom
// After a jump over versions (1.0.0 → now), the note shows only the newest lines and points to the changelog.
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPopup } from "./helpers/popup-harness.js";
import { whatsNewFor } from "../lib/whats-new.js";

// A path, not a URL object: in a jsdom test the global URL is jsdom's.
const MANIFEST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../manifest.json");

it("keeps the note short", async () => {
  await loadPopup({ local: { whatsNew: { from: "1.0.0" } } });
  const note = document.querySelector(".whats-new");
  const version = JSON.parse(readFileSync(MANIFEST, "utf8")).version;
  // The newest version's lines, compared as versions (1.0.10 is newer than 1.0.9).
  expect(note.querySelectorAll("li").length).toBe(whatsNewFor(version, "1.0.0").sections[0].items.length);
  expect(note.textContent).toMatch(/More changed since 1\.0\.0: see the full changelog\./);
});
