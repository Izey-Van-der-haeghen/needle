// The worker's FETCH_SERP checks the DataForSEO login before the permission, as RUN_DFS does:
// without an account, asking to allow DataForSEO leads nowhere (the retry fails on the login).
import { it, expect, vi, beforeAll } from "vitest";

const EXT = "chrome-extension://abc/";
const POPUP = { id: "abc", url: EXT + "popup.html" };
let onMessage;
let secrets = {};
let allowed = false;

beforeAll(async () => {
  const area = (get) => ({ get: vi.fn(get), set: vi.fn(async () => {}), remove: vi.fn(async () => {}), onChanged: { addListener: vi.fn() } });
  globalThis.chrome = {
    runtime: {
      id: "abc", getURL: (p) => EXT + p, getManifest: () => ({ version: "1.0.0" }),
      onInstalled: { addListener: vi.fn() }, onStartup: { addListener: vi.fn() },
      onMessage: { addListener: (fn) => { onMessage = fn; } }, onConnect: { addListener: vi.fn() }, sendMessage: vi.fn(async () => {})
    },
    storage: { local: area(async () => ({ ...secrets })), sync: area(async () => ({})) },
    permissions: { contains: vi.fn(async () => allowed) },
    contextMenus: { onClicked: { addListener: vi.fn() }, removeAll: vi.fn(), create: vi.fn() },
    sidePanel: { setPanelBehavior: vi.fn(async () => {}), open: vi.fn(async () => {}) },
    action: { setPopup: vi.fn(async () => {}), openPopup: vi.fn(async () => {}), onClicked: { addListener: vi.fn() } }
  };
  await import("../background.js");
});

const send = (msg) => new Promise((resolve) => { onMessage(msg, POPUP, resolve); });
const serp = () => send({ type: "FETCH_SERP", params: { keyword: "bike repair", locationCode: 2840, languageCode: "en", device: "desktop" } });

it("asks for the login first when there is neither a login nor the permission", async () => {
  secrets = {};
  allowed = false;
  const res = await serp();
  expect(res.error).toMatch(/Add your DataForSEO login in Settings/);
  expect(res.error).not.toBe("needs-permission");
});

it("asks for the permission once there is a login", async () => {
  secrets = { dfsLogin: "me@example.com", dfsPassword: "secret" };
  allowed = false;
  expect(await serp()).toMatchObject({ error: "needs-permission" });
});
