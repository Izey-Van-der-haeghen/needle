# Needle

All-in-one SEO and GEO tool for Chrome, for classic search and for AI search (GEO, AEO, LLMO). Open it on any page to see what search engines and AI assistants see: meta tags, headings, links, images, structured data, hreflang, robots.txt, sitemap, JavaScript rendering, page speed and AI search readiness. Each check says what is wrong and how to fix it.

Needle installs with no access to websites. It reads a page only when you open it on that page, keeps its results in your browser, and contacts another service only when you start a check that says so.

## What it checks

**On-page**
- Indexability verdict (HTTP status, redirects, X-Robots-Tag, meta robots and googlebot, robots.txt, canonical) and an on-page checklist score
- Title and meta description with character and pixel width, and a Google result preview
- Headings tree with skipped levels; show them on the page
- Links by region (header, menu, breadcrumb, main content, sidebar, footer), nofollow/ugc/sponsored, and an optional check of every link
- Content images: missing alt, file size, lazy loading above the fold, oversized files, unclear file names
- Structured data (JSON-LD, microdata, RDFa) checked against Google's required and recommended properties, with suggestions
- Hreflang validation, content length, Open Graph and X card previews

**Technical**
- Server answer, headers, HTTPS and HSTS
- robots.txt (RFC 9309 matching, Googlebot's group) and XML sitemap
- Server HTML compared with the page after JavaScript

**AI search (GEO)**
- Which AI search, training and user-fetch bots robots.txt allows
- Trust signals (author, dates, sources, organisation) and how easy the page is to quote
- llms.txt, for information

**Speed and keywords** (optional)
- Google PageSpeed Insights for mobile and desktop, with real-user Core Web Vitals (needs a free Google API key)
- Keywords the page ranks for and the site's organic traffic, Google top 20 for a keyword, and competitor comparison with Google positions, through your own [DataForSEO](https://dataforseo.com) account (pay per use)

**Fix this first**: one list of every problem from every check, most important first, with why and how; mark them all on the page; copy them for a developer or as a prompt for an AI assistant.

**Your own data** (optional, free keys): the Core Web Vitals trend from the Chrome UX Report, and clicks, queries and crawl info from Bing Webmaster Tools. Settings shows where to find each key.

**For writers**: readability for English, Dutch, French and German; most used words and phrases; where a keyword appears.

**AI and international**: AI Overview presence and cited sources (with DataForSEO), hreflang cluster check, sitemap inclusion, http/https/www consistency, and what changed since your last audit.

**Exports**: an HTML audit report, a comparison as CSV or Markdown, and copy buttons for titles, headings and data.

## Get it

- Chrome Web Store: coming soon.
- Source code: https://github.com/Izey-Van-der-haeghen/needle
- Questions and bugs: [GitHub issues](https://github.com/Izey-Van-der-haeghen/needle/issues) or hello@izey.dev

## Install for testing

1. Run `npm install` once, then `npm test` to check that everything passes.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose this folder.
3. Pin Needle in the toolbar, open any web page and click the Needle button (or press Alt+Shift+N).

After changing files, click the reload icon on Needle's card in `chrome://extensions`.

## Permissions

| Permission | Why |
|---|---|
| `activeTab`, `scripting` | Read the tab you open Needle on, and highlight headings or links there when you ask. |
| `storage` | Keep results, history, settings and API credentials on this device. |
| `sidePanel`, `contextMenus` | Optional side panel mode, and "Audit with Needle" / "Compare" in the right-click menu. No install warning. |
| Access to websites (optional) | Off until you turn it on. Needed to check links, load competitor pages, measure image files and reach the DataForSEO API. |

There is no content script on every page, no background tracking and no server. See [privacy.html](privacy.html).

## Development

- Plain JavaScript ES modules, no build step. Tests run with [Vitest](https://vitest.dev); `content.js` runs in jsdom through `tests/helpers/content-harness.js`.
- `npm test`: run the test suite.
- `npm run package`: build `dist/needle-<version>.zip` for the Chrome Web Store. It packs an allow-list of files and refuses to build when a placeholder or a forbidden word is left in them.
- `npm run icons`: redraw the icons (needs Python with Pillow).

```
manifest.json        Manifest V3, minimal permissions
background.js        Service worker: paid lookups, link checks, image sizes, cache
content.js           Injected on demand: reads the page, highlights headings and links
popup.html/js/css    The popup
options.html/js/css  Settings
privacy.html         Privacy policy (also linked from Settings)
base.css             Shared colour tokens and components (light and dark)
lib/                 Analysis modules (robots, technical, GEO, schema, hreflang, export…)
tests/               Vitest suites and fixture pages
tools/               Packaging and icon scripts
dev/preview/         Opens the popup in a normal browser tab with a stubbed chrome API
```

## Contributing

Issues and pull requests are welcome. Please keep to what Needle stands for: no new permissions without a clear need, nothing sent anywhere without the user starting it, plain language in the interface, and a test for every fix (`npm test`).

## Licence

MIT, see [LICENSE](LICENSE). The fonts in `fonts/` keep their own SIL Open Font License.

## Credits

Typefaces: [Atkinson Hyperlegible Next](https://github.com/googlefonts/atkinson-hyperlegible-next) and [Martian Mono](https://github.com/evilmartians/mono), both under the SIL Open Font License 1.1 (see `fonts/`).
