// @vitest-environment jsdom
// whileBusy (lib/busy.js): a run button that works once at a time, driven by a promise the test resolves.
import { it, expect, vi } from "vitest";
import { whileBusy } from "../lib/busy.js";

/** A run that waits until the test calls release(). */
function heldRun() {
  const releases = [];
  const run = vi.fn(() => new Promise((resolve, reject) => releases.push({ resolve, reject })));
  return { run, release: () => releases.shift().resolve(), fail: (e) => releases.shift().reject(e) };
}

it("ignores a second click while the first run is busy, and frees the button when it ends", async () => {
  const btn = document.createElement("button");
  const { run, release } = heldRun();
  const onClick = whileBusy(btn, run);

  const first = onClick("first");
  expect(btn.getAttribute("aria-disabled")).toBe("true");
  const second = onClick("second");
  expect(run).toHaveBeenCalledTimes(1);
  await second;
  expect(run).toHaveBeenCalledWith("first");
  expect(btn.getAttribute("aria-disabled")).toBe("true");

  release();
  await first;
  expect(btn.hasAttribute("aria-disabled")).toBe(false);

  const third = onClick("third");
  expect(run).toHaveBeenCalledTimes(2);
  release();
  await third;
});

it("frees the button when the run fails too", async () => {
  const btn = document.createElement("button");
  const { run, fail } = heldRun();
  const done = whileBusy(btn, run)();
  fail(new Error("no answer"));
  await expect(done).rejects.toThrow("no answer");
  expect(btn.hasAttribute("aria-disabled")).toBe(false);
});
