# content.js test harness

`content-harness.js` runs the real `content.js` in jsdom, the way Chrome injects it into a tab. A test then talks to it with the same messages the popup sends.

## Writing a test

```js
import { analyze, html, loadContentScript } from "./helpers/content-harness.js";

// One analysis: analyze() loads the page, sends ANALYZE_ONPAGE and closes the window again.
const res = await analyze(html("<main><h1>Fietsherstel</h1></main>"), { url: "https://www.example.be/fr-be/" });
expect(res.headings).toEqual([{ level: 1, text: "Fietsherstel" }]);

// Anything else: keep the page and send messages yourself.
const page = await loadContentScript(html("<h1>Titel</h1>"), { viewport: { width: 375, height: 667 } });
await page.send({ type: "HIGHLIGHT_HEADINGS" });
page.window.close(); // in afterEach, so jsdom timers stop
```

`html(body, head)` wraps a fragment in a standards-mode page. `loadContentScript(html, options)` resolves to `{ window, document, send, reinject }`.

| Option | Default | Use |
| --- | --- | --- |
| `url` | `https://www.example.be/nl-be/page/` | `location.href`; matters for internal links and `isHomepage` |
| `viewport` | `{ width: 1366, height: 768 }` | `window.innerWidth/innerHeight`, so above-the-fold logic |
| `runtimeHandlers` | `{}` | replies to `chrome.runtime.sendMessage`, keyed by `msg.type`; other types get no answer (`undefined`), as in Chrome when nobody responds |
| `resourceEntries` | `[]` | what `performance.getEntriesByType("resource")` returns (image bytes) |
| `media` | `{}` | media queries that match, e.g. `{ "(prefers-reduced-motion: reduce)": true }` |
| `setup` | `null` | `(window) => …`, runs before the page parses: set what jsdom can't, such as `devicePixelRatio` or a loaded image's `naturalWidth`, `width` and `currentSrc` on `HTMLImageElement.prototype` |

`send(msg)` behaves like the popup's `await chrome.tabs.sendMessage(tabId, msg)`:

- The message and the reply both cross as JSON, so `undefined` fields are dropped and an empty reply becomes `null`.
- The first listener to reply or throw decides the result. A thrown error rejects with that error, as Chrome 146+ does.
- If no listener replies synchronously or returns a literal `true`, the channel closes and `send` resolves `undefined`. A returned promise does not keep the channel open, because that only works from Chrome 148, which is still rolling out.
- If a listener returned `true` and never replies, `send` rejects after 2 s with a clear error.

`reinject()` runs `content.js` again in the same window, the way `chrome.scripting.executeScript` would.

Fixtures live in `tests/fixtures/`:

- `pages/landing-nl-be.html` is a well-formed page.
- `pages/edge-cases-fr-be.html` must be loaded at `https://www.example.be/fr-be/atelier/velo/`.
- `pages/nearly-empty.html` is close to empty.
- `chrome-innertext.json` holds the `innerText` Chrome 155 returned for each case; `content-harness.test.js` checks the polyfill against it. Measure a new case in Chrome, never write its expected string by hand.

All pages are synthetic. Only pin behaviour that is correct. When behaviour looks wrong, add an `it.todo` instead of pinning it, and leave the fix open: don't pin values that only hold until a todo is fixed.

## The environment

- jsdom runs with scripting on (`runScripts: "dangerously"`), so `<noscript>` parses as text, as it does in Chrome. Inline page `<script>` elements in your HTML run too, and share the global with `content.js`; Chrome would isolate them. Nothing external is fetched: scripts, stylesheets, images and iframes stay empty.
- `content.js` runs through `vm.Script` after the load event (`run_at: document_idle`). That gives classic-script semantics: top-level functions become globals on `window`, top-level `const` and `let` do not, and stack traces name `content.js`. Prefer `send()` to calling functions directly, because the overhaul may rename them.
- `vi.useFakeTimers()` also drives the page's `setTimeout`, provided you install it before the code schedules the timer.
- jsdom has no `CSS.escape`, `IntersectionObserver`, `ResizeObserver`, `PerformanceObserver`, `requestIdleCallback`, `structuredClone` or `fetch`, which Chrome has. Code that uses them throws a `ReferenceError` here; stub what you need in the test.

## Polyfills and their limits

Each polyfill fills a gap jsdom has that `content.js` needs. They are approximations, not layout.

| API | Needed for | Approximation |
| --- | --- | --- |
| `HTMLElement.innerText` | word counts, main-content choice, schema signals | Follows Chrome's line structure, using jsdom's computed style: block-level boxes (floats, absolute and fixed boxes, flex and grid items included) start a new line, `<p>` adds a blank line, `<br>` is `"\n"`, table cells are separated by `"\t"` and rows by `"\n"`. It skips `display: none` (stylesheet rules included), `visibility: hidden` text, `<textarea>`, media fallback content, SVG `<title>`, `<desc>` and `<metadata>`, and a closed `<details>` apart from its first `<summary>`. An element that is not rendered, or not in the document, returns its `textContent`. Not modelled: `text-transform`, `white-space: pre`, and some spaces Chrome keeps, such as those around an image or a form field. |
| `Element.getBoundingClientRect` | above the fold, background-image size, position fallback | `data-test-rect="x,y,width,height"` (viewport coordinates) on the element itself, otherwise 0×0 at 0,0. Ancestors and scrolling have no effect. A malformed value throws. |
| `Element.scrollHeight` | page height for the position fallback | the element's own `data-test-rect` height, otherwise 0 (put it on `<body>`) |
| `HTMLImageElement.width/height` | displayed size, `downscaled` | `data-test-rect` width and height when present (Chrome gives the content box), otherwise jsdom's value: the attribute, or 0 |
| `window.innerWidth/innerHeight` | above the fold | `options.viewport` |
| `window.matchMedia` | reduced motion and other media checks | matches only the queries `options.media` sets to `true`, ignoring case and spaces; listeners never fire |
| `Element.scrollIntoView` | `HIGHLIGHT` | a no-op; spy on it with `vi.spyOn(page.window.Element.prototype, "scrollIntoView")` |
| `HTMLImageElement.loading` | lazy detection | reflects the attribute: `"lazy"` in any case, otherwise `"eager"` |
| `performance.getEntriesByType` | image bytes, `oversized` | `options.resourceEntries` for `"resource"`, `[]` for anything else |

`data-test-rect` attributes are part of the HTML, so they add a little to `htmlLen` and lower `textRatio` slightly.

## Not emulated: set these up in the test

- **Image loading.** jsdom never decodes images, so any `<img>` with a `src` has `complete === false` and `naturalWidth/Height === 0`, like an image still loading in Chrome. To simulate a loaded or a broken image (or a 2x screen), define those properties with the `setup` option, for example `Object.defineProperty(w.HTMLImageElement.prototype, "naturalWidth", { get() { return 320; } })` and `w.devicePixelRatio = 2`.
- **`img.currentSrc`** is `""` unless `setup` defines it, because jsdom does not pick from `srcset`. `content.js` then uses `img.src`, while Chrome may report the candidate it picked.

## The popup harness

`tests/helpers/popup-harness.js` loads the real `popup.html`, `theme-boot.js` and `popup.js` into a jsdom test file (`// @vitest-environment jsdom`), with a `chrome` stub and the demo fixture. One popup per test file, because `popup.js` is a module and runs once.

| Option | Default | What it sets |
|---|---|---|
| `panel` | `false` | behave as the side panel (`getViews` doesn't list the window) |
| `activeTab` | `null` | a tab saved from an earlier visit (`"technical"`, `"ai"` …) |
| `local` | `{}` | more `chrome.storage.local` data, e.g. `{ whatsNew: { from: "1.0.0" } }` |
| `onpage` | `{}` | fields to change in the demo page's `ANALYZE_ONPAGE` answer |
| `unreadable` | `""` | a Chrome error text, to act as a tab Needle can't read |

It returns `{ markedBeforePopupJs, storage }` once the On-page tab shows something. Wait for later content (the AI tab) with `vi.waitFor`.
- **Scrolled pages.** Set `page.window.scrollY` and give viewport-relative rects: an element above the viewport has a negative y.
- **Position fallback.** It only runs when the page has a height, so put a `data-test-rect` on `<body>`. Without one, links and images outside any landmark come back `"other"`, where Chrome places them by position (the edge page's tracking pixel is `"header"` in Chrome). Never pin `"other"` without setting that rect.
- **CSS.** jsdom ignores `@media` rules, specificity and `!important`: the rule that comes last wins, and content hidden only inside a media query still counts as visible. Chrome resolves all of these.
- **Background images.** jsdom computes `""` for a `background` shorthand with a position and size (`center/cover`), several layers, or a gradient plus `url()`, even in an inline style. Use a plain `background-image: url(/…)` in a rule or an inline style.
- **Computed `url()` values.** `getComputedStyle` keeps `url()` as written, so `content.js` resolves it against `location.href`; Chrome resolves it against the `<base href>`. Under a `<base href>`, use absolute background URLs, or root-relative ones when the base has the page's origin.
