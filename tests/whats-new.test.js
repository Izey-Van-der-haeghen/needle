// "What's new": a note in the popup after an update, a link in Settings, the changelog on GitHub.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { whatsNewFor, WHATS_NEW, CHANGELOG_URL } from "../lib/whats-new.js";

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

describe("what changed since the version the user had", () => {
  it("lists every newer version, newest first", () => {
    const w = whatsNewFor("1.0.2", "1.0.0");
    expect(w.sections.map((s) => s.version)).toEqual(["1.0.2", "1.0.1"]);
    expect(whatsNewFor("1.0.2", "1.0.1").sections.map((s) => s.version)).toEqual(["1.0.2"]);
  });

  it("says nothing after a fresh install, a reload or a downgrade", () => {
    expect(whatsNewFor("1.0.2", undefined)).toBeNull();
    expect(whatsNewFor("1.0.2", "1.0.2")).toBeNull();
    expect(whatsNewFor("1.0.1", "1.0.2")).toBeNull();
  });

  it("compares versions as numbers (1.0.10 is newer than 1.0.9)", () => {
    expect(whatsNewFor("1.0.10", "1.0.9")).not.toBeNull();
  });

  it("has lines for the version in the manifest, and for every version in the changelog since 1.0.1", () => {
    const version = JSON.parse(read("manifest.json")).version;
    expect(WHATS_NEW[version]?.length).toBeGreaterThan(0);
    const inChangelog = [...read("CHANGELOG.md").matchAll(/^## (\d+\.\d+\.\d+)/gm)].map((m) => m[1]).filter((v) => v !== "1.0.0");
    for (const v of inChangelog) expect(WHATS_NEW[v]?.length, `WHATS_NEW["${v}"]`).toBeGreaterThan(0);
  });
});

describe("where users find it", () => {
  it("Settings links 'What's new' to the changelog", () => {
    expect(read("options.html")).toMatch(/Version <span id="version"><\/span> · <a id="changelog-link"[^>]*rel="noopener noreferrer">What's new<\/a>/);
    expect(read("options.js")).toContain('$("changelog-link").href = CHANGELOG_URL;');
    expect(CHANGELOG_URL).toBe("https://github.com/Izey-Van-der-haeghen/needle/blob/main/CHANGELOG.md");
  });

  it("the README links the changelog", () => {
    expect(read("README.md")).toContain("[changelog](CHANGELOG.md)");
  });
});

describe("the update itself", () => {
  afterEach(() => { delete globalThis.chrome; });

  it("remembers the old version for the popup, only on an update", async () => {
    let onInstalled;
    const set = vi.fn(async () => {});
    const area = () => ({ get: vi.fn(async () => ({})), set, remove: vi.fn(async () => {}), onChanged: { addListener: vi.fn() } });
    globalThis.chrome = {
      runtime: { id: "abc", getURL: (p) => p, getManifest: () => ({ version: "1.0.2" }), onInstalled: { addListener: (fn) => { onInstalled ??= fn; } },
        onStartup: { addListener: vi.fn() }, onMessage: { addListener: vi.fn() }, onConnect: { addListener: vi.fn() }, sendMessage: vi.fn(async () => {}) },
      storage: { local: area(), sync: area() },
      permissions: { contains: vi.fn(async () => false) },
      contextMenus: { onClicked: { addListener: vi.fn() }, removeAll: vi.fn(), create: vi.fn() },
      sidePanel: { setPanelBehavior: vi.fn(async () => {}), open: vi.fn(async () => {}) },
      action: { setPopup: vi.fn(async () => {}), openPopup: vi.fn(async () => {}), onClicked: { addListener: vi.fn() } }
    };
    await import("../background.js");
    onInstalled({ reason: "install" });
    await new Promise((r) => setTimeout(r, 0));
    expect(set.mock.calls.some(([o]) => "whatsNew" in o)).toBe(false);
    onInstalled({ reason: "update", previousVersion: "1.0.0" });
    await vi.waitFor(() => expect(set.mock.calls.find(([o]) => "whatsNew" in o)?.[0].whatsNew).toEqual({ from: "1.0.0" }));
  });
});

describe("a second update before the popup opens", () => {
  it("keeps the oldest version, so the note covers both", async () => {
    vi.resetModules();
    let onInstalled;
    const store = { whatsNew: { from: "1.0.0" } };
    const area = () => ({ get: vi.fn(async (k) => (k === "whatsNew" ? { whatsNew: store.whatsNew } : {})), set: vi.fn(async (o) => Object.assign(store, o)), remove: vi.fn(async () => {}), onChanged: { addListener: vi.fn() } });
    globalThis.chrome = {
      runtime: { id: "abc", getURL: (p) => p, getManifest: () => ({ version: "1.0.2" }), onInstalled: { addListener: (fn) => { onInstalled ??= fn; } },
        onStartup: { addListener: vi.fn() }, onMessage: { addListener: vi.fn() }, onConnect: { addListener: vi.fn() }, sendMessage: vi.fn(async () => {}) },
      storage: { local: area(), sync: area() },
      permissions: { contains: vi.fn(async () => false) },
      contextMenus: { onClicked: { addListener: vi.fn() }, removeAll: vi.fn(), create: vi.fn() },
      sidePanel: { setPanelBehavior: vi.fn(async () => {}), open: vi.fn(async () => {}) },
      action: { setPopup: vi.fn(async () => {}), openPopup: vi.fn(async () => {}), onClicked: { addListener: vi.fn() } }
    };
    await import("../background.js");
    onInstalled({ reason: "update", previousVersion: "1.0.1" });
    await vi.waitFor(() => expect(store.whatsNew).toEqual({ from: "1.0.0" }));
    delete globalThis.chrome;
  });
});
