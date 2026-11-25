// @vitest-environment jsdom
// The real popup while the server check runs (P3-6): "What the score is missing" counts a check
// the page alone already fails, and lists a check that needs the server's answer as waiting. The
// server check is held; with the harness's default answer it then fails, which shows "Try again".
import { it, expect, vi, beforeAll } from "vitest";
import { loadPopup } from "./helpers/popup-harness.js";

const $ = (id) => document.getElementById(id);
const items = () => [...document.querySelectorAll("#verdict-slot .score-details li")].map((li) => li.textContent);

// The page Needle reads: the demo page, changed by each test (the harness reads this object each time).
const page = { viewport: "" };
const held = [];
let hold = true;
const letServerAnswer = async () => {
  await vi.waitFor(() => expect(held.length).toBeGreaterThan(0));
  hold = false;
  held.splice(0).forEach((resolve) => resolve([{ result: undefined }]));
  await vi.waitFor(() => expect(document.querySelector('#panel-technical [data-refresh="onpage"]')).not.toBeNull());
};
const readAgain = async () => {
  hold = true;
  document.querySelector('#panel-technical [data-refresh="onpage"]').click();
  // The page is read; the score waits for the server.
  await vi.waitFor(() => expect(document.querySelector("#verdict-slot .health")?.textContent).toMatch(/after the server check/));
};

beforeAll(async () => {
  await loadPopup({
    onpage: page,
    scripting: () => (hold ? new Promise((resolve) => held.push(resolve)) : Promise.resolve([{ result: undefined }]))
  });
  await vi.waitFor(() => expect($("score-summary")).not.toBeNull());
});

it("counts a server check the page already fails: no viewport fails Technical basics", () => {
  expect(document.querySelector("#verdict-slot .verdict-title").textContent).toBe("Checking the server…");
  const list = items();
  expect(list).toContain("Technical basics: 50%");
  // Only Indexability waits: whatever the server says, Technical basics stays below 100%.
  expect(list).toContain("Indexability: waiting for the server check");
  const missing = list.filter((t) => !/waiting/.test(t));
  expect($("score-summary").textContent).toBe(`What the score is missing (${missing.length})`);
});

it("counts Indexability when the page itself says noindex", async () => {
  await letServerAnswer();
  page.robots = "noindex";
  await readAgain();
  const list = items();
  expect(list).toContain("Indexability: 0%");
  expect(list.some((t) => /waiting/.test(t))).toBe(false);
});

it("says what the score waits for when nothing is missing yet", async () => {
  await letServerAnswer();
  // A page that passes every check the page alone decides.
  Object.assign(page, {
    robots: "",
    viewport: "width=device-width, initial-scale=1",
    title: "Bike repairs in Riverside: prices, times and booking",
    description: "Same-day bike repairs and servicing in Riverside. See prices, how long a repair takes and book online.",
    headings: [{ level: 1, text: "Bike repairs in Riverside", hidden: false }, { level: 2, text: "Prices", hidden: false }],
    mainContentWordCount: 400,
    images: []
  });
  await readAgain();
  expect(items()).toEqual(["Indexability: waiting for the server check"]);
  expect($("score-summary").textContent).toBe("What the score is waiting for");
});
