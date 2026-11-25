// Every actions/checkout step in CI sets persist-credentials: false, so the job's GitHub token is not
// left in .git/config for the later steps' third-party code (npm ci's install scripts, npx addons-linter)
// to read (Aikido finding 23, 25 November 2026).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOWS = path.join(REPO, ".github/workflows");

/** Each list item ("- …" and the lines indented under it) that uses actions/checkout. */
function checkoutSteps(yaml) {
  const lines = yaml.split(/\r?\n/);
  const steps = [];
  lines.forEach((line, i) => {
    const m = /^(\s*)-\s/.exec(line);
    if (!m) return;
    let end = i + 1;
    while (end < lines.length && (!lines[end].trim() || lines[end].search(/\S/) > m[1].length)) end++;
    const block = lines.slice(i, end);
    if (block.some((l) => /^\s*(?:-\s+)?uses:\s*["']?actions\/checkout@/.test(l))) steps.push(block.join("\n"));
  });
  return steps;
}

/** The value of `persist-credentials` under the step's `with:`, or undefined. */
function persistCredentials(step) {
  const lines = step.split("\n");
  const w = lines.findIndex((l) => /^\s+with:\s*(#.*)?$/.test(l));
  if (w < 0) return undefined;
  const indent = lines[w].search(/\S/);
  for (const l of lines.slice(w + 1)) {
    if (l.trim() && l.search(/\S/) <= indent) break;
    const m = /^\s+persist-credentials:\s*["']?([^"'\s#]+)/.exec(l);
    if (m) return m[1];
  }
  return undefined;
}

describe("CI checkout", () => {
  const files = fs.readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));

  it("finds the workflows and their checkout steps", () => {
    expect(files).toContain("test.yml");
    const steps = files.flatMap((f) => checkoutSteps(fs.readFileSync(path.join(WORKFLOWS, f), "utf8")));
    expect(steps.length).toBeGreaterThan(0);
  });

  it.each(files)("%s: every checkout sets persist-credentials: false", (f) => {
    for (const step of checkoutSteps(fs.readFileSync(path.join(WORKFLOWS, f), "utf8"))) {
      expect(persistCredentials(step), step).toBe("false");
    }
  });

  it("reads the setting only from the step's with: block", () => {
    expect(persistCredentials("- uses: actions/checkout@v5")).toBeUndefined();
    expect(persistCredentials("- uses: actions/checkout@v5\n  with:\n    fetch-depth: 0")).toBeUndefined();
    expect(persistCredentials("- uses: actions/checkout@v5\n  with:\n    persist-credentials: true")).toBe("true");
    expect(persistCredentials("- name: Get the code\n  uses: actions/checkout@v5\n  with:\n    # no token\n    persist-credentials: false")).toBe("false");
    expect(checkoutSteps("steps:\n  - name: x\n    uses: actions/checkout@v5\n  - run: npm ci")).toHaveLength(1);
  });
});
