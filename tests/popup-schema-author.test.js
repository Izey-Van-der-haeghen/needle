// @vitest-environment jsdom
// The real popup on a page whose author is an @id reference (as Yoast writes it) and whose FAQ
// markup is incomplete: the Author field names the Person, and the FAQ gap is a note, not an error.
import { it, expect, vi } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

const ctx = "https://schema.org";
const schema = [
  { type: "Article", raw: { "@context": ctx, "@type": "Article", headline: "Chain care", author: { "@id": "https://www.riverside-bikes.example/#/schema/person/1" } } },
  { type: "Person", raw: { "@context": ctx, "@type": "Person", "@id": "https://www.riverside-bikes.example/#/schema/person/1", name: "Jan Peeters" } },
  { type: "FAQPage", raw: { "@context": ctx, "@type": "FAQPage", mainEntity: { "@type": "Question", name: "How often?" } } }
];

it("shows the referenced author, and an incomplete FAQ as a note", async () => {
  await loadPopup({ onpage: { schema, authorMeta: "", authorByline: "" } });
  await vi.waitFor(() => expect(document.getElementById("schema-card")).not.toBeNull());
  const author = [...document.querySelectorAll("#panel-onpage .meta-field")].find((f) => f.querySelector(".meta-label").textContent.trim() === "Author");
  expect(author.querySelector(".meta-value").textContent.trim()).toBe("Jan Peeters");

  const card = document.getElementById("schema-card");
  expect(card.querySelector("summary").textContent).toMatch(/valid/);
  const faq = [...card.querySelectorAll("details.sub")].find((d) => d.querySelector("summary").textContent.includes("FAQPage"));
  expect(faq.querySelector("summary").textContent).not.toMatch(/error/);
  expect(faq.querySelector(".plain-list").textContent).toMatch(/note\s+mainEntity › Question: missing "acceptedAnswer" or "suggestedAnswer"\. Google no longer shows FAQ rich results\./);
});
