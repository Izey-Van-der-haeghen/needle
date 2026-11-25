// @vitest-environment jsdom
// The real popup: the link check's language-version hint shows the final address with its letters,
// like the redirect hint. fetch gives the encoded address.
import { it, expect, vi } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

const SITE = "https://www.riverside-bikes.example";
const $ = (id) => document.getElementById(id);
/** The link list item whose URL is href. */
const itemFor = (href) => [...document.querySelectorAll("#link-list .item")].find((li) => li.querySelector(".item-body > .item-url")?.textContent === href);

it("decodes the final address in the language-version hint", async () => {
  await loadPopup({
    allSites: true,
    runtime: {
      CHECK_LINKS: ({ urls }) => ({ data: urls.map((url) => (url === `${SITE}/`
        ? { url, kind: "ok", status: 200, language: true, finalUrl: `${SITE}/fr/v%C3%A9los-%C3%A9lectriques/` }
        : { url, kind: "ok", status: 200 })) })
    }
  });
  $("check-broken").click();
  await vi.waitFor(() => expect($("link-check-status").textContent).toMatch(/links? checked/));

  const hint = itemFor(`${SITE}/`).querySelector(".hint");
  expect(hint.firstChild.textContent).toMatch(/Keep this link: it works for every language\.$/);
  expect(hint.querySelector(".item-url").textContent).toBe(`${SITE}/fr/vélos-électriques/`);
});
