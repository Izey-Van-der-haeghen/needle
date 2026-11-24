// content.js is injected into the page without imports, so it keeps copies of four lib/ helpers.
// Each copy is cut out of content.js and run next to its lib/ original on the same inputs:
// when one of the two changes without the other, this fails.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { countWords } from "../lib/words.js";
import { isSvgSource } from "../lib/image-rules.js";
import { flattenJsonLd } from "../lib/schema-validator.js";
import { extractWordCount } from "../lib/technical.js";

const CONTENT = readFileSync(new URL("../content.js", import.meta.url), "utf8");

/**
 * The source from `start` to the end of the function declared at `decl` (its closing brace).
 * The copies hold no braces in strings or regexes, so counting them finds the end.
 */
function cut(start, decl = start) {
  const i = CONTENT.indexOf(start);
  const d = CONTENT.indexOf(decl, i);
  if (i < 0 || d < 0) throw new Error(`content.js no longer has "${decl}": update this test with the copy's new name`);
  let depth = 0;
  for (let j = CONTENT.indexOf("{", d); j < CONTENT.length; j++) {
    if (CONTENT[j] === "{") depth++;
    else if (CONTENT[j] === "}" && --depth === 0) return CONTENT.slice(i, j + 1);
  }
  throw new Error(`No end found for "${decl}" in content.js`);
}

const copy = {
  countWords: new Function(`${cut("const NO_SPACES", "function countWords(")}; return countWords;`)(),
  isSvgSource: new Function(`${cut("function isSvgSource(")}; return isSvgSource;`)(),
  flattenJsonLd: new Function(`${cut("const flattenJsonLd = ")}; return flattenJsonLd;`)()
};
copy.htmlWordCount = new Function("countWords", `${cut("function htmlWordCount(")}; return htmlWordCount;`)(copy.countWords);

/** Each input gives the same answer from the lib/ original and the content.js copy. */
function same(original, contentCopy, inputs) {
  for (const args of inputs) {
    expect(contentCopy(...args), JSON.stringify(args).slice(0, 80)).toEqual(original(...args));
  }
}

describe("content.js copies behave like their lib/ originals", () => {
  it("countWords (lib/words.js)", () => {
    same(countWords, copy.countWords, [
      [""], ["   "], ["one"], ["one two  three"], [" leading and trailing "], ["line\nbreaks\tand tabs"],
      ["日本語のテキストです"], ["สวัสดีครับ ไทย"], ["mixed 中文 words"], ["ກິນເຂົ້າ"], ["l'été dernier, à Bruxelles"], ["a b"]
    ]);
  });

  it("isSvgSource (lib/image-rules.js)", () => {
    same(isSvgSource, copy.isSvgSource, [
      [""], [null], ["https://x.example/a.svg"], ["https://x.example/a.SVGZ"], ["https://x.example/Logo.svg.png"],
      ["https://x.example/i?format=svg"], ["https://x.example/i?f=image/svg+xml"], ["https://x.example/i?f=svgz"],
      ["data:image/svg+xml;base64,AA"], ["data:image/svg+xml,<svg/>"], ["data:image/png;base64,AA"],
      ["/rel/a.svg?x=1"], ["not a url .svg#x"], ["https://x.example/a.svg#frag"]
    ]);
  });

  it("flattenJsonLd (lib/schema-validator.js)", () => {
    same(flattenJsonLd, copy.flattenJsonLd, [
      [[{ "@type": "A" }, { "@graph": [{ "@type": "B" }], "@context": "https://schema.org" }]],
      [{ "@graph": { "@type": "C" } }],
      [{ "@context": "https://schema.org", "@graph": [{ "@type": "D", "@context": "https://other.example" }, { "@type": "E" }] }],
      [null], [{}], [[]], ["text"], [[[{ "@type": "F" }]]],
      [{ "@type": "G" }, "https://schema.org"],
      [{ "@context": "https://schema.org", "@type": "H" }, "https://outer.example"],
      [[{ "@graph": [] }, {}, null, { "@type": "I" }]],
      [{ "@context": { "@vocab": "https://schema.org/" }, "@graph": [{ "@type": "J" }] }]
    ]);
  });

  it("htmlWordCount in content.js counts like extractWordCount (lib/technical.js)", () => {
    same(extractWordCount, copy.htmlWordCount, [
      ["<html><head><title>T x</title></head><body><p>one two</p><script>x y</script></body></html>"],
      ["<title>No body</title><p>three words here</p>"],
      ["<body><!-- c d --><svg><text>s</text></svg>a&nbsp;b</body>"],
      ["<body><!-- a comment\nover lines --><p>kept</p></body>"],
      ["<body><!-- <p>old text</p> --><p>one</p></body>"],
      ["<body><!--[if IE]><p>Upgrade your browser</p><![endif]--><p>one two</p></body>"],
      ["<body><style>p { color: red }</style><template><p>hidden</p></template><noscript>no js</noscript><p>one</p></body>"],
      ["<body>a&#160;b&nbsp;c</body>"],
      ["<head><meta name=x></head>head only"],
      ["<BODY class=x><P>Upper case</P></BODY>"],
      ["<body><p>日本語のテキストです</p></body>"],
      [""],
      ["plain text, no tags"],
      ["<html><head><title>T</title></head><body>   </body></html>"]
    ]);
  });
});
