# Changelog

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
- **Title and description:** a width close to Google's limit that still fits is shown neutrally as "near the limit"; only a width that gets cut off is marked as a problem.

## 1.0.0 (20 November 2026)

First public release.

- On-page, technical and AI search checks for the page in the current tab, with an indexability verdict and a checklist score.
- "Fix this first": every problem in one list, most important first, shown on the page in one click, and copied for a developer or as a prompt for an AI assistant.
- An AI tab: AI search, training and user-fetch bots in robots.txt, trust signals and how easy the page is to quote.
- With your own keys: PageSpeed Insights, the Core Web Vitals trend (Chrome UX Report), Bing Webmaster Tools and DataForSEO.
- Popup or side panel, right-click menu, keyboard shortcuts, light and dark theme, HTML report, CSV and Markdown exports.
