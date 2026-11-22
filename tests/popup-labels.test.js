// @vitest-environment jsdom
// The real popup: plain facts carry the outlined information label, problems keep their colour.
import { it, expect, vi } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

it("marks external and nofollow links and not-scored tables as information", async () => {
  await loadPopup({ onpage: { tableCount: 0 } });
  const kinds = (sel) => [...document.querySelectorAll(sel)].map((t) => [t.textContent.trim(), [...t.classList].find((c) => c !== "tag")]);
  const onpage = kinds("#panel-onpage .tag");
  const facts = onpage.filter(([text]) => text === "external" || text === "nofollow");
  expect(facts.length).toBeGreaterThan(0);
  expect(facts.every(([, k]) => k === "info")).toBe(true);
  await vi.waitFor(() => expect(document.querySelector("#panel-ai .card")).not.toBeNull());
  expect(kinds("#panel-ai .tag").find(([text]) => text === "not scored")?.[1]).toBe("info");
});
