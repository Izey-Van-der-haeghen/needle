// Fixes from the review round of 1.0.2 (22 November 2026).
import { describe, it, expect, vi, afterEach } from "vitest";
import { readablePageError, safeSendTabMessage } from "../lib/popup-messaging.js";

afterEach(() => { delete globalThis.chrome; });

describe("why a tab can't be read, in plain words", () => {
  it("names an offline error page instead of Chrome's 'Frame with ID 0 is showing error page'", () => {
    expect(readablePageError("Frame with ID 0 is showing error page")).toMatch(/^The tab shows an error page instead of the website: no internet connection/);
    expect(readablePageError("The extensions gallery cannot be scripted.")).toBe("Chrome doesn't let extensions read the Chrome Web Store.");
    expect(readablePageError("Cannot access contents of url \"https://x.example/\".")).toMatch(/Click the Needle button/);
    expect(readablePageError("No tab with id: 12.")).toMatch(/tab was closed or changed/);
    expect(readablePageError("")).toBe("The page didn't answer. Reload it, then try again.");
  });

  it("says it once: no 'Needle can't read this page.' prefix, and the side panel still knows a missing permission", async () => {
    globalThis.chrome = {
      tabs: { sendMessage: vi.fn(async () => { throw new Error("Could not establish connection."); }) },
      scripting: { executeScript: vi.fn(async () => { throw new Error("Frame with ID 0 is showing error page"); }) }
    };
    await expect(safeSendTabMessage(1, { type: "ANALYZE_ONPAGE" })).rejects.toMatchObject({ message: expect.stringMatching(/^The tab shows an error page/), noAccess: false });
    globalThis.chrome.scripting.executeScript = vi.fn(async () => { throw new Error("Cannot access contents of url \"https://x.example/\"."); });
    await expect(safeSendTabMessage(1, { type: "ANALYZE_ONPAGE" })).rejects.toMatchObject({ noAccess: true });
  });
});
