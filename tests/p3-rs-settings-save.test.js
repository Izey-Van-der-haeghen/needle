// @vitest-environment jsdom
// The real Settings page (full check of 25 November 2026, P3-23 and P3-8).
// A Save button is secondary, and coral only while its section has changes that are not saved yet
// (Izey, 25 November 2026). "Allow access to websites" keeps its coral button. Each field and button
// has a name of its own, and each name starts with the words on screen.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOptions } from "./helpers/options-harness.js";

// A path, not a URL object: in a jsdom test the global URL is jsdom's, which node:fs refuses.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const $ = (id) => document.getElementById(id);
const SAVES = ["save-dfs", "save-psi", "save-bing", "save-images"];
/** The Save buttons that are coral now. */
const coralSaves = () => SAVES.filter((id) => $(id).classList.contains("primary-btn"));
/** Typing in a text field, and picking in a list, as a person does. */
const type = (id, value) => { $(id).value = value; $(id).dispatchEvent(new Event("input", { bubbles: true })); };
const pick = (id, value) => { $(id).value = value; $(id).dispatchEvent(new Event("change", { bubbles: true })); };
/**
 * A button's name as a screen reader reads it: the elements its aria-labelledby names, in order (the
 * button itself gives its own text, a hidden span its text too), else its text.
 */
const nameOf = (btn) => {
  const ids = btn.getAttribute("aria-labelledby");
  const parts = ids ? ids.trim().split(/\s+/).map((id) => $(id).textContent) : [btn.textContent];
  return parts.join(" ").replace(/\s+/g, " ").trim();
};
/** The words on screen: the button's text without visually hidden text. */
const visibleText = (btn) => {
  const copy = btn.cloneNode(true);
  copy.querySelectorAll(".visually-hidden").forEach((n) => n.remove());
  return copy.textContent.replace(/\s+/g, " ").trim();
};
/** A field's name: the text of its label, without the options of a list. */
const fieldName = (el) => {
  const label = el.closest("label");
  return (label.querySelector(":scope > span")?.textContent ?? label.textContent).replace(/\s+/g, " ").trim();
};
let storage;

beforeAll(async () => {
  ({ storage } = await loadOptions({
    allowed: false,
    local: { dfsLogin: "me@example.com", dfsPassword: "secret", psiKey: "AIza-test" },
    sync: { imgMaxKB: "150", imgWidth: "1200", imgHeight: "630", imgMode: "ratio" }
  }));
});

describe("Settings: the Save buttons", () => {
  it("are all secondary on a page with nothing changed; Allow access to websites is the one coral button", () => {
    for (const id of SAVES) {
      expect($(id).classList.contains("secondary-btn"), id).toBe(true);
      expect($(id).classList.contains("primary-btn"), id).toBe(false);
    }
    const coral = [...document.querySelectorAll(".primary-btn")].filter((b) => !b.hidden).map((b) => b.id);
    expect(coral).toEqual(["grant-all"]);
  });

  it("a field changed back to what is stored leaves its Save secondary, in every section", () => {
    const stored = { dfsLogin: "me@example.com", dfsPassword: "secret", psiKey: "AIza-test", bingKey: "", imgMaxKB: "150", imgWidth: "1200" };
    for (const [id, value] of Object.entries(stored)) {
      type(id, `${value}9`);
      expect(coralSaves(), id).toHaveLength(1);
      type(id, value);
      expect(coralSaves(), id).toEqual([]);
    }
    pick("imgMode", "exact");
    expect(coralSaves()).toEqual(["save-images"]);
    pick("imgMode", "ratio");
    expect(coralSaves()).toEqual([]);
  });

  it("a changed key makes only its own Save coral; the saved key typed back makes it secondary again", () => {
    type("psiKey", "AIza-new");
    expect(coralSaves()).toEqual(["save-psi"]);
    expect($("save-psi").classList.contains("secondary-btn")).toBe(false);
    // Save trims spaces, so a key with spaces around it is the saved key.
    type("psiKey", "  AIza-test ");
    expect(coralSaves()).toEqual([]);
  });

  it("Save key stores the key and turns its button secondary", async () => {
    type("psiKey", "AIza-new");
    $("save-psi").click();
    await vi.waitFor(() => expect(coralSaves()).toEqual([]));
    expect((await storage.local.get("psiKey")).psiKey).toBe("AIza-new");
  });

  it("a Save that is refused keeps its button coral; the Save that works turns it secondary", async () => {
    type("dfsPassword", "");
    expect(coralSaves()).toEqual(["save-dfs"]);
    $("save-dfs").click();
    await vi.waitFor(() => expect($("dfs-status").textContent).toMatch(/Fill in both/));
    expect(coralSaves()).toEqual(["save-dfs"]);

    type("dfsPassword", "secret-2");
    $("save-dfs").click();
    await vi.waitFor(() => expect(coralSaves()).toEqual([]));
    expect((await storage.local.get("dfsPassword")).dfsPassword).toBe("secret-2");
  });

  it("image checks: a choice in a list counts as a change too, and a refused number keeps Save coral", async () => {
    pick("imgMode", "exact");
    expect(coralSaves()).toEqual(["save-images"]);
    type("imgWidth", "12a");
    $("save-images").click();
    await vi.waitFor(() => expect($("images-status").textContent).toMatch(/whole numbers/));
    expect(coralSaves()).toEqual(["save-images"]);

    type("imgWidth", "1200");
    $("save-images").click();
    await vi.waitFor(() => expect(coralSaves()).toEqual([]));
    expect((await storage.sync.get("imgMode")).imgMode).toBe("exact");
  });

  it("are secondary in options.html itself, so none shows coral while the page loads", () => {
    const html = readFileSync(path.join(ROOT, "options.html"), "utf8");
    for (const id of SAVES) expect(html, id).toMatch(new RegExp(`<button type="button" class="secondary-btn" id="${id}"[ >]`));
  });

  it("what was typed while Chrome asked for access is not saved, so Save stays coral", async () => {
    const ask = chrome.permissions.request;
    chrome.permissions.request = async () => { type("dfsLogin", "typed-meanwhile@example.com"); return true; };
    try {
      type("dfsLogin", "new@example.com");
      $("save-dfs").click();
      await vi.waitFor(() => expect($("dfs-status").textContent).toBe("Saved."));
      expect((await storage.local.get("dfsLogin")).dfsLogin).toBe("new@example.com");
      expect(coralSaves()).toEqual(["save-dfs"]);
    } finally {
      chrome.permissions.request = ask;
    }
    type("dfsLogin", "new@example.com");
    expect(coralSaves()).toEqual([]);
  });

  it.each([
    ["Remove login", "clear-dfs", "save-dfs", { dfsLogin: "me-2@example.com", dfsPassword: "secret-3" }],
    ["Remove key for Google", "clear-psi", "save-psi", { psiKey: "AIza-2" }],
    ["Remove key for Bing", "clear-bing", "save-bing", { bingKey: "bing-key" }]
  ])("%s leaves nothing unsaved", async (_name, remove, save, fields) => {
    const ids = Object.keys(fields);
    for (const id of ids) type(id, fields[id]);
    $(save).click();
    await vi.waitFor(() => expect(coralSaves()).toEqual([]));
    $(remove).click(); // arms: "Confirm"
    $(remove).click();
    await vi.waitFor(() => expect(ids.map((id) => $(id).value)).toEqual(ids.map(() => "")));
    expect(coralSaves()).toEqual([]);
    expect(await storage.local.get(ids)).toEqual(Object.fromEntries(ids.map((id) => [id, ""])));
    // The empty fields are what is stored now: typing and deleting again leaves nothing to save.
    type(ids[0], "x");
    expect(coralSaves()).toEqual([save]);
    type(ids[0], "");
    expect(coralSaves()).toEqual([]);
  });
});

describe("Settings: names", () => {
  it("names the two API key fields after their service", () => {
    expect(fieldName($("psiKey"))).toBe("Google API key");
    expect(fieldName($("bingKey"))).toBe("Bing API key");
  });

  it("names each Save button for what it saves, starting with the words on screen", () => {
    expect(SAVES.map((id) => visibleText($(id)))).toEqual(["Save login", "Save key", "Save key", "Save image checks"]);
    expect(SAVES.map((id) => nameOf($(id)))).toEqual(["Save login", "Save key for Google", "Save key for Bing", "Save image checks"]);
    for (const id of SAVES) expect(nameOf($(id)).startsWith(visibleText($(id))), id).toBe(true);
  });

  it("names each Remove button for what it removes, also while it asks to confirm", () => {
    const removes = ["clear-dfs", "clear-psi", "clear-bing"];
    expect(removes.map((id) => nameOf($(id)))).toEqual(["Remove login", "Remove key for Google", "Remove key for Bing"]);
    for (const id of removes) expect(nameOf($(id)).startsWith(visibleText($(id))), id).toBe(true);
    // lib/confirm-button.js swaps the button's text for "Confirm" and back: the service stays in the name.
    $("clear-psi").click();
    expect(visibleText($("clear-psi"))).toBe("Confirm");
    expect(nameOf($("clear-psi"))).toBe("Confirm for Google");
    $("clear-psi").dispatchEvent(new Event("blur"));
    expect(nameOf($("clear-psi"))).toBe("Remove key for Google");
  });

  it("gives no two fields and no two buttons the same name", () => {
    const fields = [...document.querySelectorAll("input, select")].filter((el) => el.type !== "file").map(fieldName);
    expect(fields.filter((n, i) => fields.indexOf(n) !== i)).toEqual([]);
    const buttons = [...document.querySelectorAll("button")].map(nameOf);
    expect(buttons.filter((n, i) => buttons.indexOf(n) !== i)).toEqual([]);
  });

  it("the guides name the button by its words on screen", () => {
    const guides = [...document.querySelectorAll("details.guide")].map((d) => d.textContent);
    expect(guides.filter((t) => /click Save\b/.test(t)).every((t) => /click Save key\b/.test(t))).toBe(true);
    expect(guides.join(" ")).not.toMatch(/click Save\.(?!\w)/);
  });
});
