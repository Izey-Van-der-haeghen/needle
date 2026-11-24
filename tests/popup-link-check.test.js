// @vitest-environment jsdom
// The real popup: the link check's hints, then Refresh. Refresh keeps keyboard focus in the panel
// while it redraws, and it is a fresh look: the saved link check doesn't come back by itself.
import { it, expect, vi } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

const SITE = "https://www.riverside-bikes.example";
const $ = (id) => document.getElementById(id);
/** The link list item whose URL is href. */
const itemFor = (href) => [...document.querySelectorAll("#link-list .item")].find((li) => li.querySelector(".item-body > .item-url")?.textContent === href);

it("shows where a link redirects, keeps a language redirect, and Refresh starts without the saved check", async () => {
  const checks = [];
  await loadPopup({
    allSites: true,
    runtime: {
      CHECK_LINKS: ({ urls }) => {
        checks.push(urls);
        return { data: urls.map((url) => (
          url === `${SITE}/bikes/` ? { url, kind: "redirect", status: 301, finalUrl: `${SITE}/shop/bikes/` }
          : url === `${SITE}/` ? { url, kind: "ok", status: 200, language: true, finalUrl: `${SITE}/en/` }
          : { url, kind: "ok", status: 200 })) };
      }
    }
  });
  $("check-broken").click();
  await vi.waitFor(() => expect($("link-check-status").textContent).toMatch(/links? checked/));
  expect(checks).toHaveLength(1);

  // The final URL gets its own line in the code font, like the link's own URL above it.
  const redirect = itemFor(`${SITE}/bikes/`).querySelector(".hint");
  expect(redirect.firstChild.textContent).toBe("Redirects. Link straight to the final URL:");
  expect(redirect.querySelector(".item-url").textContent).toBe(`${SITE}/shop/bikes/`);
  const language = itemFor(`${SITE}/`).querySelector(".hint");
  expect(language.firstChild.textContent).toMatch(/Keep this link: it works for every language\.$/);
  expect(language.querySelector(".item-url").textContent).toBe(`${SITE}/en/`);
  expect(itemFor(`${SITE}/repairs/`).querySelector(".hint")).toBeNull();

  // Refresh by keyboard: the button goes away with the panel's content, focus stays in the panel.
  const panel = $("panel-onpage");
  const refresh = panel.querySelector("[data-refresh='onpage']");
  refresh.focus();
  refresh.click();
  expect(refresh.isConnected).toBe(false);
  expect(document.activeElement).toBe(panel);

  // The audit is drawn again (the report button returns once every check answered), without the saved link check.
  await vi.waitFor(() => expect($("export-audit-header").hidden).toBe(false));
  expect($("link-list")).not.toBeNull();
  expect($("link-check-status").textContent).not.toMatch(/checked/);
  expect(document.querySelectorAll("#link-list .hint")).toHaveLength(0);
  expect(document.activeElement).toBe(panel);
});
