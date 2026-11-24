// @vitest-environment jsdom
// The real Settings page: "Allow" and "Remove" for access to websites hide themselves once Chrome
// answers, and show the other one. Keyboard focus moves to the button that is now shown.
import { it, expect, vi, beforeAll } from "vitest";
import { loadOptions } from "./helpers/options-harness.js";

const $ = (id) => document.getElementById(id);
let granted = false;

beforeAll(async () => {
  await loadOptions({ allowed: false });
  // Chrome's answers, kept in step: what was allowed or removed is what contains() reports.
  chrome.permissions.contains = async () => granted;
  chrome.permissions.request = async () => { granted = true; return true; };
  chrome.permissions.remove = async () => { granted = false; return true; };
});

it("starts with Allow shown and Remove hidden", () => {
  expect($("grant-all").hidden).toBe(false);
  expect($("revoke-all").hidden).toBe(true);
});

it("Allow: focus moves to Remove", async () => {
  $("grant-all").focus();
  $("grant-all").click();
  await vi.waitFor(() => expect($("grant-all").hidden).toBe(true));
  expect($("revoke-all").hidden).toBe(false);
  await vi.waitFor(() => expect(document.activeElement).toBe($("revoke-all")));
});

it("Remove: focus moves back to Allow", async () => {
  $("revoke-all").click();
  await vi.waitFor(() => expect($("revoke-all").hidden).toBe(true));
  expect($("grant-all").hidden).toBe(false);
  await vi.waitFor(() => expect(document.activeElement).toBe($("grant-all")));
});
