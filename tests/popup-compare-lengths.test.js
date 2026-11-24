// @vitest-environment jsdom
// The real popup's Compare: the title and description lengths count characters as a reader does, as the
// On-page card does. A flag or a family emoji is one character, not the four or eight code units
// JavaScript's .length counts.
import { it, expect, vi, afterAll } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

const ME = "https://www.riverside-bikes.example/repairs/";
const RIVAL = "https://www.fietsen.example/";
const TITLE = "🇧🇪 Fietsherstel in Gent 🚲"; // 24 characters; .length 28, code points 25
const DESCRIPTION = "👨‍👩‍👧 Family bikes for every ride"; // 29 characters; .length 36, code points 33

const page = (title, description) => `<!doctype html><html lang="nl"><head><title>${title}</title>
  <meta name="description" content="${description}"></head><body><h1>${title}</h1><p>Tekst.</p></body></html>`;
const PAGES = { [ME]: page("Bike repairs in Ghent", "Bike repairs while you wait"), [RIVAL]: page(TITLE, DESCRIPTION) };

afterAll(() => vi.unstubAllGlobals());

it("counts an emoji title and description by characters", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url) => (PAGES[url]
    ? { ok: true, status: 200, url, headers: new Headers({ "content-type": "text/html; charset=utf-8" }), text: async () => PAGES[url] }
    : Promise.reject(new TypeError("Failed to fetch")))));
  await loadPopup({ allSites: true });
  document.getElementById("compare-self").value = ME;
  document.querySelector('.competitor-url[data-idx="0"]').value = RIVAL;
  document.getElementById("run-compare").click();
  await vi.waitFor(() => expect(document.querySelector("#compare-result .compare-table")).not.toBeNull());

  /** The number in each page's cell of a length row: [you, competitor]. */
  const lengths = (label) => {
    const tr = [...document.querySelectorAll("#compare-result tr")].find((r) => r.querySelector("th")?.textContent.trim() === label);
    return [...tr.querySelectorAll("td")].map((td) => td.querySelector(".tag")?.lastChild.textContent);
  };
  expect(lengths("Title length")).toEqual(["21", "24"]);
  expect(lengths("Description length")).toEqual(["27", "29"]);
});
