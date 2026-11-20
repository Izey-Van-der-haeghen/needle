import { describe, it, expect, vi, beforeEach } from "vitest";
import { migrateSecrets, getSecrets, getPrefs, DEFAULT_LOCATION } from "../lib/settings.js";

let sync;
let local;
beforeEach(() => {
  sync = {};
  local = {};
  const area = (store) => ({
    get: vi.fn(async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, store[k]]))),
    set: vi.fn(async (obj) => Object.assign(store, obj)),
    remove: vi.fn(async (keys) => [].concat(keys).forEach((k) => delete store[k]))
  });
  globalThis.chrome = { storage: { sync: area(sync), local: area(local) } };
});

describe("credentials", () => {
  it("moves credentials from synced storage to this device only, then deletes the synced copy", async () => {
    Object.assign(sync, { dfsLogin: "me@example.com", dfsPassword: "secret", psiKey: "k", theme: "dark" });
    await migrateSecrets();
    expect(local).toEqual({ dfsLogin: "me@example.com", dfsPassword: "secret", psiKey: "k" });
    expect(sync).toEqual({ theme: "dark" });
  });

  it("keeps a newer local value over an old synced one", async () => {
    Object.assign(sync, { psiKey: "old" });
    Object.assign(local, { psiKey: "new" });
    expect((await getSecrets()).psiKey).toBe("new");
    expect(sync).toEqual({});
  });
});

describe("getPrefs", () => {
  it("defaults to the United States in English", async () => {
    expect(await getPrefs()).toEqual({ defaultLocation: DEFAULT_LOCATION, defaultLanguage: "en" });
  });
});
