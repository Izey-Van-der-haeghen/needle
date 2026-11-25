// @vitest-environment jsdom
// The real popup for screen-reader and keyboard users (steps 3-7: P3-6 to P3-10, and the morning's
// a11y #11). The server check is held at first, so the tests can read the popup while it runs.
// With the harness's default answer the server check then fails, as it does offline.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { it, expect, vi, beforeAll } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

// A path, not a URL object: in a jsdom test the global URL is jsdom's.
const PRIVACY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../privacy.html");
const $ = (id) => document.getElementById(id);
const said = () => $("sr-status").textContent;
/** An element's text as a screen reader reads it: without its aria-hidden parts. */
const text = (el) => {
  const copy = el.cloneNode(true);
  copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return copy.textContent.replace(/\s+/g, " ").trim();
};
/** The words on screen: without the parts for screen readers only. */
const visible = (el) => {
  const copy = el.cloneNode(true);
  copy.querySelectorAll('.visually-hidden, [aria-hidden="true"]').forEach((n) => n.remove());
  return copy.textContent.replace(/\s+/g, " ").trim();
};
/** The accessible name, for the ways Needle names a control: aria-labelledby (a button may name
 *  itself by its text), aria-label, or the text. */
const nameOf = (el) => (el.hasAttribute("aria-labelledby")
  ? el.getAttribute("aria-labelledby").split(/\s+/).map((id) => { const r = $(id); return r === el ? text(r) : r.getAttribute("aria-label") || text(r); }).join(" ")
  : el.getAttribute("aria-label") || text(el));
/** The accessible description: the text of every element aria-describedby names; each must exist. */
const descriptionOf = (el) => (el.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean).map((id) => {
  expect($(id), `#${id}`).not.toBeNull();
  return text($(id));
}).join(" ");

const held = [];
let hold = true;
let tabMessages;
beforeAll(async () => {
  ({ tabMessages } = await loadPopup({
    // The welcome note shows.
    local: { popupState: { onboardingDismissed: false } },
    // The server check reads the page through chrome.scripting: hold it until a test lets it go.
    scripting: () => (hold ? new Promise((resolve) => held.push(resolve)) : Promise.resolve([{ result: undefined }])),
    tabHandlers: {
      HIGHLIGHT_LINKS: () => ({ matched: 3 }),
      UNHIGHLIGHT_LINKS: () => ({ ok: true }),
      HIGHLIGHT_HEADINGS: () => ({ ok: true }),
      UNHIGHLIGHT_HEADINGS: () => ({ ok: true })
    }
  }));
  await vi.waitFor(() => expect($("score-summary")).not.toBeNull());
});

it("doesn't count the server's checks as missing while the server check runs", () => {
  expect(document.querySelector("#verdict-slot .verdict-title").textContent).toBe("Checking the server…");
  const items = [...document.querySelectorAll("#verdict-slot .score-details li")].map((li) => li.textContent);
  // Indexability waits. The page has a canonical, a viewport and https: Canonical and Technical
  // basics pass already, so they are neither missing nor waiting.
  expect(items).toContain("Indexability: waiting for the server check");
  const missing = items.filter((t) => !/waiting for the server check/.test(t));
  expect(missing.length).toBeGreaterThan(0);
  expect(items.filter((t) => /^(Indexability|Canonical|Technical basics)\b/.test(t))).toEqual(["Indexability: waiting for the server check"]);
  expect($("score-summary").textContent).toBe(`What the score is missing (${missing.length})`);
});

it("announces the verdict and the score once the server check is in, not before", async () => {
  // The page itself was read long ago (the announcement timer is 30 ms): nothing is said yet.
  await new Promise((r) => setTimeout(r, 100));
  expect(said()).not.toMatch(/Page analysed/);

  // Every text the live region gets from here on: a screen reader may read each one.
  const announced = [];
  const watch = new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach((n) => announced.push(n.textContent))));
  watch.observe($("sr-status"), { childList: true });

  expect(held.length).toBeGreaterThan(0);
  hold = false;
  held.splice(0).forEach((resolve) => resolve([{ result: undefined }]));
  await vi.waitFor(() => expect(said()).toMatch(/^Page analysed/));
  const verdict = document.querySelector("#verdict-slot .verdict-title").textContent;
  const score = document.querySelector("#verdict-slot .health").textContent.match(/^Score (\d+)\/100$/)?.[1];
  // The harness's answer makes the server check fail: one sentence says so, after the verdict.
  expect(verdict).toBe("Not verified");
  expect(said()).toBe(`Page analysed: Not verified, score ${score}. The server check failed`);
  // One sentence, not "The server check failed" first: a second text so soon cuts the first one off.
  await new Promise((r) => setTimeout(r, 100));
  watch.disconnect();
  expect(announced.filter(Boolean)).toEqual([said()]);
  // The waiting line is gone, and the count is what the list shows.
  const items = [...document.querySelectorAll("#verdict-slot .score-details li")].map((li) => li.textContent);
  expect(items.some((t) => /waiting/.test(t))).toBe(false);
  expect($("score-summary").textContent).toBe(`What the score is missing (${items.length})`);
});

it("makes the verdict and the welcome note's title headings in the outline", () => {
  const verdict = document.querySelector("#verdict-slot .verdict-title");
  expect(verdict.tagName).toBe("H2");
  const welcome = document.querySelector(".onboarding h2");
  expect(welcome?.textContent).toBe("Welcome to Needle");
  expect(document.querySelector(".onboarding strong")).toBeNull();
  // The outline as a screen reader lists it: History is closed.
  const outline = [...document.querySelectorAll("h1, h2")].filter((h) => !h.closest("[hidden]")).map((h) => `${h.tagName} ${h.textContent.trim()}`);
  expect(outline.slice(0, 4)).toEqual(["H1 needle", "H2 Welcome to Needle", `H2 ${verdict.textContent}`, "H2 Fix this first"]);
});

it("says what Needle reads in three short sentences, in the privacy policy's words", () => {
  const privacy = text(document.querySelector(".onboarding details.sub > div"));
  const sentences = privacy.split(/(?<=\.)\s+/);
  expect(sentences).toHaveLength(3);
  // Short: 25 words at most each, a common plain-language limit. The old single sentence had 41.
  for (const s of sentences) expect(s.split(/\s+/).length, s).toBeLessThanOrEqual(25);
  expect(privacy).toMatch(/side panel/);
  expect(privacy).toMatch(/Nothing leaves your browser unless you start a check/);
  // What the side panel reads, said as the privacy policy says it: no more (other tabs and windows).
  const policy = readFileSync(PRIVACY, "utf8");
  const scope = "each tab you switch to and each page you open in it";
  expect(policy).toContain(scope);
  expect(privacy).toContain(scope);
});

it("gives the crosshairs in Fix this first a tooltip", () => {
  const locate = [...document.querySelectorAll("#findings-slot .locate")];
  expect(locate.length).toBeGreaterThan(0);
  for (const b of locate) expect(b.getAttribute("title")).toBe("Show on the page");
});

it("names Copy as table, Show on page and Check by their visible text, then what they act on", () => {
  const panel = $("panel-onpage");
  const copy = [...panel.querySelectorAll("[data-copy-fn]")].filter((b) => /^Copy as table/.test(b.textContent));
  expect(copy.map(nameOf)).toEqual(["Copy as table (meta tags)", "Copy as table (links)", "Copy as table (images)"]);
  expect(nameOf($("toggle-issues"))).toBe("Show all on page (findings)");
  expect(nameOf($("toggle-headings"))).toBe("Show on page (headings)");
  expect(nameOf($("toggle-links"))).toBe("Show on page (links)");
  expect(nameOf($("kw-check"))).toBe("Check keyword");
  // Each name starts with the words on the button (speech users say those), and no two are the same.
  const buttons = [...copy, $("toggle-issues"), $("toggle-headings"), $("toggle-links"), $("kw-check")];
  for (const b of buttons) expect(nameOf(b).startsWith(visible(b))).toBe(true);
  expect(new Set(buttons.map(nameOf)).size).toBe(buttons.length);
});

it("names and describes each locate button by its row's text", () => {
  const links = [...document.querySelectorAll("#link-list .locate")];
  expect(links.length).toBeGreaterThan(1);
  for (const b of links) {
    const item = b.closest(".item");
    expect(descriptionOf(b)).toBe(`${text(item.querySelector(".item-title"))} ${text(item.querySelector(".item-url"))}`);
  }
  const headings = [...document.querySelectorAll(".h-tree .locate")];
  expect(headings.length).toBeGreaterThan(1);
  for (const b of headings) {
    const row = b.closest(".h-row");
    expect(descriptionOf(b)).toBe(`${text(row.querySelector(".h-level"))} ${text(row.querySelector(".h-text"))}`);
  }
  const images = [...document.querySelectorAll("#image-list .locate")];
  expect(images.length).toBeGreaterThan(1);
  for (const b of images) expect(descriptionOf(b)).toBe(text(b.closest(".item").querySelector(".item-body")));
  // Each name says what it shows, so a screen reader's list of buttons (names only) tells them apart.
  for (const b of links) expect(nameOf(b)).toBe(`Show this link on the page: ${text(b.closest(".item").querySelector(".item-title"))}`);
  for (const b of headings) {
    const row = b.closest(".h-row");
    expect(nameOf(b)).toBe(`Show this heading on the page: ${text(row.querySelector(".h-level"))} ${text(row.querySelector(".h-text"))}`);
  }
  for (const b of images) expect(nameOf(b)).toBe(`Show this image on the page: ${text(b.closest(".item").querySelector(".item-title"))}`);
  for (const list of [links, headings, images]) expect(new Set(list.map(descriptionOf)).size).toBe(list.length);
});

it("marks the links again when a link filter changes while they are shown", async () => {
  const kind = (val) => $("toggle-links").closest(".card-body").querySelector(`[data-filter-group="kind"] [data-filter-val="${val}"]`);
  $("toggle-links").click();
  await vi.waitFor(() => expect($("toggle-links").textContent).toBe("Hide on page"));
  const sent = tabMessages.length;
  kind("external").click();
  await vi.waitFor(() => expect(tabMessages.slice(sent).map((m) => m.msg)).toContainEqual(expect.objectContaining({ type: "HIGHLIGHT_LINKS", filter: expect.objectContaining({ internal: "external" }) })));
  // Back as it was: all links, nothing marked.
  kind("all").click();
  $("toggle-links").click();
  await vi.waitFor(() => expect($("toggle-links").textContent).toBe("Show on page"));
});

it("says a toggle's state in its label, without aria-pressed", async () => {
  for (const id of ["toggle-issues", "toggle-headings", "toggle-links"]) expect($(id).hasAttribute("aria-pressed")).toBe(false);

  $("toggle-links").click();
  await vi.waitFor(() => expect($("toggle-links").textContent).toBe("Hide on page"));
  expect(nameOf($("toggle-links"))).toBe("Hide on page (links)");
  expect($("toggle-links").hasAttribute("aria-pressed")).toBe(false);
  $("toggle-links").click();
  await vi.waitFor(() => expect(nameOf($("toggle-links"))).toBe("Show on page (links)"));

  $("toggle-headings").click();
  await vi.waitFor(() => expect(nameOf($("toggle-headings"))).toBe("Hide on page (headings)"));
  expect($("toggle-headings").hasAttribute("aria-pressed")).toBe(false);
  $("toggle-headings").click();
  await vi.waitFor(() => expect(nameOf($("toggle-headings"))).toBe("Show on page (headings)"));
});
