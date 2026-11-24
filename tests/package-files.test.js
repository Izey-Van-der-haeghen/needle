// The store package (tools/package.mjs): the build stops when a file the extension loads is left
// out of the allow-list, also when only a stylesheet, a script or executeScript loads it.
import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { INCLUDE, packagedFiles, referencedFiles, notPackaged } from "../tools/package-files.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
const without = (...entries) => packagedFiles(ROOT, INCLUDE.filter((e) => !entries.includes(e)));

describe("the store package", () => {
  it("holds every file the extension loads", () => {
    expect(notPackaged(ROOT, packagedFiles(ROOT), MANIFEST)).toEqual([]);
  });

  it("follows stylesheets, scripts and injected files to what they load", () => {
    const refs = referencedFiles(ROOT, packagedFiles(ROOT), MANIFEST);
    for (const f of [
      "base.css", // @import url("base.css") in popup.css and options.css
      "fonts/atkinson-hyperlegible-next-latin.woff2", "fonts/martian-mono-latin.woff2", // url(…) in fonts/fonts.css
      "lib/settings.js", "lib/busy.js", // import … from "./lib/…"
      "lib/image-rules.js", // import("./image-rules.js") in lib/settings.js
      "content.js" // executeScript({ files: ["content.js"] })
    ]) expect(refs, f).toContain(f);
  });

  it("stops the build when base.css, a font, content.js or a module is left out", () => {
    expect(notPackaged(ROOT, without("base.css"), MANIFEST)).toEqual(["base.css"]);
    expect(notPackaged(ROOT, without("fonts"), MANIFEST)).toEqual(["fonts/fonts.css"]);
    // A font file renamed or moved, with fonts.css still pointing to the old name:
    expect(notPackaged(ROOT, packagedFiles(ROOT).filter((f) => f !== "fonts/martian-mono-latin.woff2"), MANIFEST)).toEqual(["fonts/martian-mono-latin.woff2"]);
    expect(notPackaged(ROOT, without("content.js"), MANIFEST)).toEqual(["content.js"]);
    expect(notPackaged(ROOT, without("lib"), MANIFEST)).toContain("lib/popup-helpers.js");
  });

  it("stops the build when a page the manifest opens, or the default locale, is left out", () => {
    expect(notPackaged(ROOT, without("popup.html"), MANIFEST)).toEqual(["popup.html"]);
    expect(notPackaged(ROOT, without("options.html"), MANIFEST)).toEqual(["options.html"]);
    expect(notPackaged(ROOT, without("_locales"), MANIFEST)).toEqual(["_locales/en/messages.json"]);
  });

  it("resolves a reference against the file that makes it, and skips data: and web addresses", () => {
    const dir = mkdtempSync(join(tmpdir(), "needle-package-"));
    mkdirSync(join(dir, "css"));
    mkdirSync(join(dir, "lib"));
    writeFileSync(join(dir, "css/a.css"), `@import "b.css"; .x { background: url('../img/x.png?v=2'), url(data:image/png;base64,AA), url("https://cdn.example/y.png"); }`);
    writeFileSync(join(dir, "lib/a.js"), `import { b } from "./b.js";\nexport * from "../c.js";\nchrome.scripting.executeScript({ target, files: ["/inject.js"] });`);
    const refs = referencedFiles(dir, ["css/a.css", "lib/a.js"], { icons: {}, background: { service_worker: "sw.js" } });
    expect([...refs].sort()).toEqual(["c.js", "css/b.css", "img/x.png", "inject.js", "lib/b.js", "sw.js"]);
  });
});
