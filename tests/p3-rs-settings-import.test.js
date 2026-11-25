// @vitest-environment jsdom
// The real Settings page: "Load settings from file" with a file whose settings Needle refuses
// (full check of 25 November 2026, P3-2). It used to say "No Needle settings found in this file."
// Now it says that nothing was loaded and how many settings have values Needle can't use.
// What a file does load counts as saved, so its Save buttons turn secondary (P3-23).
import { it, expect, vi, beforeAll, beforeEach } from "vitest";
import { loadOptions } from "./helpers/options-harness.js";

const $ = (id) => document.getElementById(id);
/** Typing in a field, as a person does, and the Save buttons that are coral now. */
const type = (id, value) => { $(id).value = value; $(id).dispatchEvent(new Event("input", { bubbles: true })); };
const coralSaves = () => ["save-dfs", "save-psi", "save-bing", "save-images"].filter((id) => $(id).classList.contains("primary-btn"));
let storage;

beforeAll(async () => {
  ({ storage } = await loadOptions({ sync: { imgWidth: "1200", imgHeight: "630", popupShortcuts: true } }));
});

beforeEach(() => { $("sync-status").textContent = ""; });

/** Load a settings file through the real file field, as a person picking a file does. */
async function loadFile(json) {
  const input = $("import-settings");
  Object.defineProperty(input, "files", { configurable: true, value: [{ text: async () => JSON.stringify(json) }] });
  input.dispatchEvent(new Event("change"));
  await vi.waitFor(() => expect($("sync-status").textContent).not.toBe(""));
  return $("sync-status");
}

it("three refused values: nothing loaded, and says how many", async () => {
  const status = await loadFile({ app: "Needle", settings: { imgWidth: "800", theme: "purple", popupShortcuts: "yes" } });
  expect(status.textContent).toBe("Nothing loaded: 3 settings in this file have values Needle can't use.");
  expect(status.className).toBe("status-bad");
  // What was stored stays.
  expect(await storage.sync.get(["imgWidth", "imgHeight", "theme", "popupShortcuts"])).toEqual({ imgWidth: "1200", imgHeight: "630", theme: "light", popupShortcuts: true });
});

it("one refused value: in the singular", async () => {
  const status = await loadFile({ settings: { theme: "purple" } });
  expect(status.textContent).toBe("Nothing loaded: 1 setting in this file has a value Needle can't use.");
  expect(status.className).toBe("status-bad");
});

it("a file without any Needle setting still says so", async () => {
  const status = await loadFile({ settings: { somethingElse: 1 } });
  expect(status.textContent).toBe("No Needle settings found in this file.");
});

it("a file with a value it can use loads that one and counts the rest", async () => {
  const status = await loadFile({ settings: { theme: "dark", imgMode: "square" } });
  expect(status.textContent).toBe("Loaded 1 setting; skipped 1 that Needle can't use.");
  expect((await storage.sync.get("theme")).theme).toBe("dark");
});

it("what a file loads counts as saved: its Save buttons turn secondary, also over unsaved typing", async () => {
  type("psiKey", "typed, not saved");
  type("imgMaxKB", "999");
  expect(coralSaves()).toEqual(["save-psi", "save-images"]);
  const status = await loadFile({ settings: { psiKey: "AIza-file", imgMaxKB: "200" } });
  expect(status.textContent).toBe("Loaded 2 settings.");
  expect([$("psiKey").value, $("imgMaxKB").value]).toEqual(["AIza-file", "200"]);
  expect(coralSaves()).toEqual([]);
  // The loaded values are what Save compares with.
  type("imgMaxKB", "201");
  expect(coralSaves()).toEqual(["save-images"]);
  type("imgMaxKB", "200");
  type("psiKey", "AIza-file2");
  expect(coralSaves()).toEqual(["save-psi"]);
  type("psiKey", "AIza-file");
  expect(coralSaves()).toEqual([]);
});
