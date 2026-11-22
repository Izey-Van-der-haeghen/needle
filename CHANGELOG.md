# Changelog

## 1.0.2 (not yet released)

- **Labels:** labels that are information only ("near the limit", "note", "not scored", "external", "nofollow", "not found" …) have their own outlined look, so they no longer look like a "Low" finding.
- **Side panel:** the side panel shows its own layout from the first frame, instead of the popup's for a moment.
- **Settings:** "Test key" and "Test connection" run once at a time.
- **Report:** the report uses the same colour names and values as Needle itself.
- **Link check:** a link that opens the reader's language version (for example `/fr-fr/…`) counts as working, instead of "redirects, link straight to the final URL". A link that is slow once gets a second try before it is reported as timed out.
- **Noindex pages:** while a page asks not to be indexed, Fix this first leaves out what only matters in search results and shows how many it left out, also in the report and the copy for a developer.
- **Title and description:** once the width is measured, the width gives the verdict ("cut off in Google results") and the character count is information, in the popup and the report.
- **Robots directives:** `max-snippet:-1` (no limit) is no longer shown as a warning.
- **What's new:** after an update, Needle says once what changed, with a link to this changelog. Settings has a "What's new" link next to the version.
- **Clearer messages:** when a tab can't be read (no internet, the Chrome Web Store, no access yet), Needle says why in plain words, once, instead of Chrome's own error text. Without internet, the server check says so too.

## 1.0.1 (21 November 2026)

- **Images:** the size check measures the file the browser loaded from `srcset`, so responsive images are no longer flagged "much larger than shown". The main-image check counts the largest `srcset` file.
- **AI tab, site entity:** Needle looks for the Person or Organization that runs the site. An employer (`worksFor`), school, client, brand or topic named in the structured data no longer counts as the site's own organisation.
- **Structured data:** software without ratings is no longer reported as missing a required property. A note explains that the star-rating rich result needs real ratings or reviews.
- **Pages that aren't HTML:** a text file, XML or image opened in a tab (such as `/llms.txt`) shows "This isn't an HTML page" instead of an audit full of false alarms.
- **AI score:** the AI tab and the report now say what the AI readiness score subtracts. Data tables are shown for information only and no longer cost points, since most pages need none.
- **Structured data, nested items:** an item nested as the page's `mainEntity` (for example a WebApplication inside a WebPage, or the questions of an FAQPage) gets the same checks as a top-level block.
- **Structured data, suggestions:** Article is no longer suggested on a profile, about or contact page. A home page with a Person (a personal site) no longer gets an Organization suggestion; without either, the suggestion is "Organization or Person".
- **Hreflang:** after "Check the alternates", alternates with problems (no return link, an error, a redirect, noindex) appear in Fix this first.
- **Language chooser:** a page that is its own x-default and links to every language version no longer gets "Only N words of main content".
- **Title and description:** a width close to Google's limit that still fits is shown neutrally as "near the limit"; only a width that gets cut off is marked as a problem. The findings, the score and the report follow the pixel width as well.
- **Campaign links:** a page opened with `?utm_…`, `gclid` or `fbclid` is the same page. It no longer looks "canonicalized away", and its hreflang links are not reported as broken.
- **Hreflang:** "Check the alternates" says when only the first 20 were checked, runs once at a time, and shows each URL as the page wrote it. Language codes stay on one line in the tables.
- **Structured data:** a Q&A question may have suggested answers only, and an image may name its file in `contentUrl`. With several nested items, each message names the item it is about.
- **Images:** the "Exact size" rule in Settings compares the largest file in `srcset`, and a `srcset` without spaces after its commas is read correctly.
- **Wording and polish:**
  - Network failures read "could not connect" instead of "Failed to fetch".
  - The side panel no longer jumps when the server check returns.
  - Refresh and "Try again" keep keyboard focus.
  - Link URLs are easier to read.

## 1.0.0 (20 November 2026)

First public release.

- On-page, technical and AI search checks for the page in the current tab, with an indexability verdict and a checklist score.
- "Fix this first": every problem in one list, most important first, shown on the page in one click, and copied for a developer or as a prompt for an AI assistant.
- An AI tab: AI search, training and user-fetch bots in robots.txt, trust signals and how easy the page is to quote.
- With your own keys: PageSpeed Insights, the Core Web Vitals trend (Chrome UX Report), Bing Webmaster Tools and DataForSEO.
- Popup or side panel, right-click menu, keyboard shortcuts, light and dark theme, HTML report, CSV and Markdown exports.
