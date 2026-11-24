// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { buildHtmlReport } from "../lib/export.js";
import { confirmClick } from "../lib/confirm-button.js";
import { AI_BOTS } from "../lib/geo.js";
import { popupSizeForZoom } from "../lib/popup-helpers.js";

const onpage = {
  url: "https://example.com/a", title: "T", description: "", headings: [], links: { details: [] }, schema: [], hreflang: [], og: {}, twitter: {},
  images: [{ src: "https://example.com/hero.jpg", context: "main", displayedWidth: 800, displayedHeight: 400, alt: "Hero" }]
};
const report = (extra = {}) => buildHtmlReport({ url: onpage.url, onpage, technical: null, offpage: null, geo: null, health: null, verdict: null, theme: "dark", ...extra });

describe("the downloaded report", () => {
  it("carries the house fonts when they are passed in", () => {
    const css = '@font-face { font-family: "Atkinson Hyperlegible Next"; src: url(data:font/woff2;base64,AAAA) format("woff2"); }';
    expect(report({ fontCss: css })).toContain(css);
  });

  it("prints in light colours, also when it was saved in dark theme", () => {
    expect(report()).toMatch(/@media print \{\s*:root, :root\[data-theme="dark"\] \{[^}]*--paper: #FFFFFF/);
  });

  it("says '1 image', and lets long image URLs wrap on a phone", () => {
    const html = report();
    expect(html).toMatch(/<p>1 image · /);
    expect(html).toContain("grid-template-columns: 64px minmax(0, 1fr) auto");
  });
});

describe("buttons that can't be undone", () => {
  afterEach(() => vi.useRealTimers());
  it("ask for a second click with no time limit (WCAG 2.2.1), disarm on blur, and keep their width", async () => {
    vi.useFakeTimers();
    const btn = document.createElement("button");
    btn.textContent = "Clear history";
    document.body.append(btn);
    const action = vi.fn();
    confirmClick(btn, action);
    btn.click();
    expect(action).not.toHaveBeenCalled();
    expect(btn.textContent).toBe("Confirm");
    btn.click();
    await Promise.resolve();
    expect(action).toHaveBeenCalledTimes(1);
    expect(btn.textContent).toBe("Clear history");
    btn.click();
    vi.advanceTimersByTime(60000);
    expect(btn.textContent).toBe("Confirm"); // a screen-reader user has all the time they need
    btn.dispatchEvent(new FocusEvent("blur"));
    expect(btn.textContent).toBe("Clear history");
    expect(action).toHaveBeenCalledTimes(1);
  });
});

describe("AI bots", () => {
  it("files every bot that fetches a page for a user under 'user'", () => {
    const users = AI_BOTS.filter((b) => /-User$/.test(b.ua));
    expect(users.length).toBeGreaterThan(1);
    expect(users.every((b) => b.kind === "user")).toBe(true);
  });
});

describe("popup at browser zoom", () => {
  it("fits Chrome's 800 × 600 cap at real zoom levels, and leaves 100 % and odd ratios alone", () => {
    expect(popupSizeForZoom(1)).toBeNull();
    expect(popupSizeForZoom(756 / 560)).toBeNull(); // headless Chrome's fixed outerWidth
    expect(popupSizeForZoom(1.1)).toEqual({ width: 560, height: 545 });
    expect(popupSizeForZoom(1.5)).toEqual({ width: 533, height: 400 });
    expect(popupSizeForZoom(2.01)).toEqual({ width: 400, height: 300 });
  });
});
