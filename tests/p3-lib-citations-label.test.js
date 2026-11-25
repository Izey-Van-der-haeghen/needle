// Full check of 25 November 2026, P3-25: the AI tab and the report show "too few" next to
// 1 or 2 external links, not "missing". Both take the word from signalStatus.
import { describe, it, expect } from "vitest";
import { analyzeEEAT } from "../lib/geo.js";
import { signalStatus } from "../lib/labels.js";

const citations = (n) => analyzeEEAT({ schema: [], externalLinkCount: n }).find((s) => s.label === "External citations");

describe("the External citations label", () => {
  it("says missing for 0 links, too few for 1 or 2, ok for 3", () => {
    expect(signalStatus(citations(0), "missing")).toEqual(["missing", "warn"]);
    expect(signalStatus(citations(1), "missing")).toEqual(["too few", "warn"]);
    expect(signalStatus(citations(2), "missing")).toEqual(["too few", "warn"]);
    expect(signalStatus(citations(3), "missing")).toEqual(["ok", "good"]);
  });

  it("leaves a signal without a word of its own to the list's word", () => {
    expect(signalStatus({ label: "Author", ok: false, value: "not detected" }, "missing")).toEqual(["missing", "warn"]);
    expect(signalStatus({ label: "Lists", ok: false, value: "0" }, "low")).toEqual(["low", "warn"]);
  });
});
