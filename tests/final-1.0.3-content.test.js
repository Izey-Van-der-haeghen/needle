// The final check before 1.0.3: comments or cards nested as <article> inside a post <article>, on a
// page without <main>, are counted once, not again as articles of their own.
import { it, expect } from "vitest";
import { loadContentScript, html } from "./helpers/content-harness.js";

it("counts nested articles' words and lists once", async () => {
  const words = (n, w) => Array.from({ length: n }, () => w).join(" ");
  const comment = `<article><p>${words(30, "reply")}</p><ul><li>a</li></ul></article>`;
  const page = await loadContentScript(html(`<article><h1>Post</h1><p>${words(300, "post")}</p><ul><li>x</li></ul>${comment}${comment}${comment}</article>`));
  try {
    const op = await page.send({ type: "ANALYZE_ONPAGE" });
    expect(op.mainContentSelector).toBe("article");
    expect(op.listCount).toBe(4);
    const text = (await page.send({ type: "GET_MAIN_TEXT" })).text;
    expect(text.match(/\breply\b/g)).toHaveLength(90);
  } finally { page.close?.(); }
});
