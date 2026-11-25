// Aikido round of 25 November 2026, finding 12 (the walkers): a JSON-LD block nested thousands of
// levels deep must not overflow the stack in the walkers the popup runs on every audit.
import { describe, it, expect } from "vitest";
import { collectAllSchemaTypes, suggestMissingSchemas, MAX_SCHEMA_DEPTH } from "../lib/schema-validator.js";
import { schemaAuthor, analyzeEEAT } from "../lib/geo.js";

/** An object nested `levels` deep: {"@type": "Thing", "x": {"@type": "Thing", "x": … }}. */
function nested(levels, leaf = {}) {
  let node = leaf;
  for (let i = 0; i < levels; i++) node = { "@type": "Thing", x: node };
  return node;
}

/** The same, with arrays in between: [{"x": [{"x": …}]}]. */
function nestedArrays(levels) {
  let node = { "@type": "Thing" };
  for (let i = 0; i < levels; i++) node = [{ x: node }];
  return node;
}

const deep = (raw) => [{ type: "Thing", raw }];

describe("collectAllSchemaTypes and suggestMissingSchemas on a block 10,000 levels deep", () => {
  it("do not throw", () => {
    expect(collectAllSchemaTypes(deep(nested(10000)))).toEqual(["Thing"]);
    expect(collectAllSchemaTypes(deep(nestedArrays(10000)))).toEqual([]);
    expect(() => suggestMissingSchemas({ url: "https://e.com/", schema: deep(nested(10000)) })).not.toThrow();
  });

  it("still find a type nested within the limit, and not one beyond it", () => {
    const at = (depth) => collectAllSchemaTypes(deep(nested(depth, { "@type": "PostalAddress" })));
    expect(at(MAX_SCHEMA_DEPTH)).toEqual(["PostalAddress", "Thing"]);
    expect(at(MAX_SCHEMA_DEPTH + 1)).toEqual(["Thing"]);
  });
});

describe("schemaAuthor and analyzeEEAT on a block 10,000 levels deep", () => {
  it("do not throw", () => {
    expect(schemaAuthor(deep(nested(10000)))).toBe("");
    expect(schemaAuthor(deep(nestedArrays(10000)))).toBe("");
    expect(() => analyzeEEAT({ schema: deep(nested(10000)), externalLinkCount: 0 })).not.toThrow();
  });

  it("still find an author within the limit, and not one beyond it", () => {
    const at = (depth) => schemaAuthor(deep(nested(depth, { "@type": "Article", author: { "@type": "Person", name: "Ann" } })));
    expect(at(MAX_SCHEMA_DEPTH)).toBe("Ann");
    expect(at(MAX_SCHEMA_DEPTH + 1)).toBe("");
  });
});
