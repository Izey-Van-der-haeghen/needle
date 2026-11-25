// The privacy policy after the Aikido follow-ups (25 November 2026): what image previews load, what each
// clear button removes (named as the buttons are named), and the addresses the checks don't request.
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(path.join(ROOT, f), "utf8");
const policy = read("privacy.html").replace(/\s+/g, " ");
const item = (name) => policy.match(new RegExp(`<li><strong>${name}</strong>(.*?)</li>`))?.[1] || "";

it("is dated 25 November 2026", () => {
  expect(policy).toContain("Last updated: 25 November 2026");
});

it("says which images Needle and the report don't load, that redirects and public names that lead to the local network still load, and that cookies may go along", () => {
  const images = policy.match(/<p>To show image previews,(.*?)<\/p>/)?.[1] || "";
  expect(images).toContain("Needle doesn't load an image whose address is on your local network (such as your router), in Needle or in the report, unless the audited page is on your local network too.");
  // isLocalUrl reads the address as written: a public name that leads to the local network still loads.
  expect(images).toContain("An image address that redirects is still followed, also to your local network, and an image at a public web address whose name leads to your local network still loads: Needle can't see where a name leads before it loads the image.");
  expect(images).toContain("Like the page's own images, these requests may carry your cookies for those servers.");
});

it("names the clear buttons as the popup and Settings name them, and what each removes", () => {
  for (const label of ["Clear history and snapshots", "Clear saved results"]) {
    expect(policy).toContain(`"${label}"`);
  }
  expect(read("popup.html")).toContain(">Clear history and snapshots</button>");
  expect(read("options.html")).toContain(">Clear history and snapshots</button>");
  expect(read("options.html")).toContain(">Clear saved results</button>");
  expect(item("Audit results")).toContain('"Clear saved results" in Settings removes them all, and so does each Needle update.');
  expect(item("Audit results")).toContain("An expired result stays on your device until Needle saves its next result.");
  expect(item("History")).toContain(`"Clear history and snapshots", in Needle's History panel or in Settings, removes it any time.`);
  expect(item("Snapshots")).toContain("They are removed with the history.");
  expect(item("Your last inputs and choices")).toContain("Clearing the history also clears the countries and languages picked per website, and a link you right-clicked to compare that Needle has not opened yet.");
});

it("says the checks don't request names that only work on the local network, and what can still lead there", () => {
  const checks = item("Link check, competitor comparison, hreflang alternates, http/https and www versions, and image sizes");
  expect(checks).toContain("names that only work on your local network, such as http://intranet/ or nas.local: the link check reports a link to such a name without requesting it.");
  expect(checks).toContain("Only a website that redirects there, or a public web address whose name leads there, can still lead a request to such an address.");
});
