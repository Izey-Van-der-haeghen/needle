# Changelog

## Unreleased

- **Accessibility:** the popup has one main heading, and its tabs sit in a navigation landmark, so screen-reader users can jump to both. When a pressed button goes away (Got it, Allow access), focus moves to the active tab or to what the button started; each result is announced once, in a short sentence; two-step buttons wait as long as you need; focus rings are no longer cut at the edge; the selected tab stays visible in Windows contrast themes; the side panel shows the page address on its own line.
- **Screen readers:** the sitemap, versions and alternates checks, the "Search Google" key notice and every permission notice say their result, in the words the screen shows; each JSON-LD block has its own name.
- **Compare:** without permission for DataForSEO, Compare shows the same "Allow DataForSEO" button as the other tools, and compares again after it. "Recent pages" is called History everywhere.
- **Report:** uses the popup's words (link regions, "Structured data", "not found"), calls a robots.txt that answers 404 "none (everything allowed)", and writes sizes with thousands separators.
- **Long words and addresses:** a page title, heading or address without spaces no longer makes the Google preview, the side panel or the report scroll sideways; the side panel's History, theme and Settings buttons stay put when Download appears.
- **True results:** the http/https/www check says when versions didn't answer or answered with an error, instead of "Versions end on different URLs"; the Images card says when it lists only the first 100; a page address ending in a bare "?" no longer gets "The canonical points to another URL"; Compare without a DataForSEO login offers Open Settings instead of a red error, and tells screen readers everything it found in one sentence.
- **robots.txt:** for Googlebot, "Allow: /dir/index.html" also allows /dir/, as Google's own parser does.
- **Addresses as people read them:** also in the redirect and canonical explanations, the report's images, hreflang and social cards, and the top-bar tooltip; characters that could make an address look like another stay encoded. File names keep the letters of Japanese, Hindi, Thai, Korean and other scripts.
- **Fewer coral buttons:** "Open Settings" in the key notices, "Look up keywords" and every "Allow …" button inside a tab are secondary, so each tab keeps one main action (the side panel's full-tab access notice keeps its coral button).
- **Fixed:** an empty keyword no longer says "Could not connect". Large images near the end of a long page are checked (they counted as footer). "Check again" under the lazy-image note keeps a finished link check. A settings import checks each value on its own and never mixes half an image size with the stored one. Esc also clears the "marked on the page" line.
- **Any language:** addresses on screen and in the report show their letters (Région, not R%C3%A9gion), while links, copies and the examples under Fix this first keep the raw address; Compare file names keep non-Latin keywords; right-to-left text in the report keeps its punctuation in place.
- **AI tab:** Applebot follows Googlebot's rules when robots.txt doesn't name Applebot, as Apple documents.
- **Clearer and more accurate texts:** the welcome note says the side panel reads the tabs you switch to; Settings says "Look up again" is billed again; title and description limits are named as Needle's measures, not Google's, and the findings say a title "may be" cut off; the speed-test key, the robots.txt server-error and Bing nocache texts match the vendors' own pages; one name each for "Hide on page", the checklist score and Mobile.
- **Privacy policy:** links the Limited Use requirements directly and lists everything a change snapshot keeps.
- **For developers:** tests hold the manifest to the five promised permissions, optional access to websites and no remote code; `npm run lint:extension` runs Mozilla's addons-linter, read for Chrome, here and in GitHub Actions. A test fills every tab and the report with HTML injection attempts from a page, and requires that all of it stays text. The page scan no longer lowercases the whole page text for nothing, and unused code is gone.

## 1.0.2 (22 November 2026)

- **Labels:** labels that are information only ("near the limit", "note", "not scored", "external", "nofollow", "not found" …) have their own outlined look, so they no longer look like a "Low" finding.
- **Side panel:** the side panel shows its own layout from the first frame, instead of the popup's for a moment.
- **Settings:** "Test key" and "Test connection" run once at a time.
- **Report:** the report uses the same colour names and values as Needle itself.
- **Link check:** shows its progress ("12 of 40 checked"), so a slow website doesn't make it look stuck. A link that opens the reader's language version (for example `/fr-fr/…`) counts as working, instead of "redirects, link straight to the final URL". A link that is slow once gets a second try before it is reported as timed out.
- **Noindex pages:** while a page asks not to be indexed, Fix this first leaves out what only matters in search results and shows how many it left out, also in the report and the copy for a developer.
- **Title and description:** once the width is measured, the width gives the verdict ("cut off in Google results") and the character count is information, in the popup and the report.
- **Robots directives:** `max-snippet:-1` (no limit) is no longer shown as a warning.
- **Images on high-density screens:** a file the browser picks from `srcset` for a 2x screen (640 px for a photo shown 300 px wide) is no longer called "much larger than shown". A file far larger than any screen needs is still flagged. The Images card says when a lazy image hasn't loaded yet.
- **Privacy:** "Clear history" also forgets the country and language picked per website. The privacy policy and Settings describe the side panel, the transfers and the links to other tools more precisely.
- **AI tab, dates:** a page's published and modified dates show the day as the page wrote it. A midnight time with an offset (`2026-11-21T00:00:00+01:00`) no longer shows as the day before.
- **What's new:** after an update, Needle says what changed until you click "Got it", with a link to this changelog. Settings has a "What's new" link next to the version.
- **Clearer messages:** when a tab can't be read (no internet, the Chrome Web Store, no access yet), Needle says why in plain words, once, instead of Chrome's own error text. Without internet, the server check and the link check say so too. Compare and the other tools no longer show "Failed to fetch".
- **Rules checked against Google's documentation:**
  - Structured data: FAQ, HowTo and sitelinks search box markup no longer counts as a rich-result requirement (Google stopped showing them); JobPosting is no longer suggested from words on the page; WebSite needs `name` and is suggested on the home page only; Offer accepts `priceSpecification`; contact and address fields are recommended, not required; background videos get no VideoObject suggestion; `@graph` as one object, empty blocks and full `https://schema.org/` types are read correctly; microdata counts in the score.
  - Indexing: a passed `unavailable_after` date counts as noindex; a noindex in the server HTML that JavaScript removes, or a canonical JavaScript changes, is flagged; a missing canonical no longer makes the verdict amber; rules for other crawlers (`bingbot: nosnippet`) don't count for Google; a robots.txt Needle can't read no longer lowers the verdict.
  - robots.txt is read the way Google's parser reads it (groups, `Googlebot/2.1`, common typos, the 500 KiB limit in bytes).
  - Sitemaps on another host, gzip, RSS, Atom and text sitemaps no longer give "No valid sitemap".
  - hreflang: only ISO language and country codes pass (with a hint for `gb` or `jp`); a missing x-default is a recommendation; alternates with a noindex header or another trailing slash are flagged.
  - Headings: an H1 inside `aria-hidden` still counts; several H1s are low priority.
  - Images: Discover advice only on articles, and it checks `max-image-preview:large`; "shown larger than the file" uses the real file width; SVGs are never blurry; phone and camera file names count as unclear; images sized by CSS `aspect-ratio` have dimensions.
- **AI tab:** Anthropic says its bots follow robots.txt, so a blocked Claude-User counts. Applebot and DuckAssistBot are checked too. Bing's `noarchive` and `nocache` are flagged for Copilot answers. External citations count links in the main content only, and question headings are found in Dutch, French, German, Spanish, Italian and other scripts.
- **Any language:** words are counted in Japanese, Chinese and Thai; soft hyphens, joiners and combining marks stay inside their word; an emoji counts as one character.
- **Checklist score:** a "Technical basics" check (viewport, https, mixed content), broken images count, content depth asks for more than a thin page only, and hreflang is scored on correctness.
- **Side panel:** after the page reloads, the side panel audits it again, and a fresh audit shows when it was made with a Refresh button. A side panel and a popup open at once no longer overwrite each other's settings. A campaign link (`?utm_…`) is the same page for the speed test, the keyword lookup, CrUX, Bing, the sitemap check and history.
- **Noindex pages:** Fix this first, the report and the copy for a developer list the findings left out.
- **Copy for a developer:** tags show as code on GitHub and GitLab.
- **Checked on real sites:** Bing's own `<meta name="bingbot">` is read (for Copilot, not for Google); a heading that is only a logo is named by its text alternative; text hidden inside a heading is left out; an H1 that is only hidden gets one finding instead of also "No H1 heading"; an empty breadcrumb container no longer suggests BreadcrumbList; a sitemap that refuses Needle's request is "not checked" instead of missing; author and dates count only on article pages.

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
