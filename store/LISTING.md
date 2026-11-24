# Chrome Web Store listing: Needle

Copy these into the developer dashboard. Everything here is English, the only language of the listing.

## Store listing tab

**Name** (from the manifest, 33/75 characters)
Needle: all-in-one SEO & GEO tool

**Summary** (from the manifest, 129/132 characters)
Audit any page for SEO, GEO and AEO in one click: meta tags, headings, links, images, schema, robots.txt, speed and AI readiness.

**Category**
Developer Tools

**Language**
English

**Description**

Needle shows what search engines and AI assistants see on any web page, and what to fix. Open it on a page and you get a verdict first, with the details one click away.

One tool for classic SEO and for optimising for AI search, whatever you call it: GEO (generative engine optimisation), AEO (answer engine optimisation), LLMO (large language model optimisation) or AI SEO. Needle checks what lets AI search, such as ChatGPT search, Claude, Perplexity and Google's AI Overviews, reach and quote a page.

ON-PAGE
• Indexability verdict: HTTP status, redirects, robots meta and googlebot tags, X-Robots-Tag, robots.txt and canonical, each with a plain-language fix
• Title and meta description with character count, pixel width and a Google result preview
• Heading outline with skipped levels, shown on the page if you want
• Links by page region (header, menu, breadcrumb, main content, sidebar, footer), nofollow, sponsored and ugc, plus an optional check of every link
• Content images: missing alt text, large files, lazy loading above the fold, missing width and height, unclear file names
• Structured data: JSON-LD checked against Google's required and recommended properties, microdata and RDFa types listed, with suggestions for what to add
• Hreflang validation, Open Graph and X card previews, word counts

TECHNICAL
• Server answer, response headers, HTTPS, HSTS and mixed content
• robots.txt matched the way Google does (RFC 9309) and the XML sitemap
• The server's HTML compared with the page after JavaScript, so you see what crawlers without JavaScript miss
• Snippet controls (nosnippet, max-snippet, data-nosnippet) that limit quotes in search and AI Overviews

AI SEARCH
• Which AI search bots, training bots and user-fetch bots your robots.txt allows, and which ones actually affect AI answers
• Trust signals (author, dates, sources, organisation) and how easy the page is to quote
• llms.txt, for information

SPEED AND KEYWORDS (optional)
• Google PageSpeed Insights for mobile and desktop, with real-user Core Web Vitals and their 25-week trend (free Google API key)
• Your own Bing Webmaster Tools data for the page: clicks, impressions, queries, last crawl (free Bing API key)
• Keywords a page ranks for, a site's organic traffic and Google's top 20 for a keyword, through your own DataForSEO account (pay per use, cost shown before every lookup)
• Side-by-side comparison with competitor pages (Google positions with DataForSEO)

FOR WRITERS
• Readability with the formula for the page's language (English, Dutch, French, German)
• Most used words and phrases, and where a keyword appears: title, description, headings, URL, first 100 words, alt text

AI AND INTERNATIONAL
• With your DataForSEO account: whether Google shows an AI Overview for a search, which pages it cites, and whether your page is one of them
• Hreflang cluster check: each alternate's status, canonical, noindex and return link (up to 20)
• Is the page in the XML sitemap? Do the http, https, www and non-www versions end on one URL?
• What changed since your last audit of a page

WORK THE WAY YOU LIKE
• Popup or side panel that follows your tabs; right-click menu to audit a page or compare a linked page

HAND IT OFF
• "Fix this first": the problems from every check in one list, most important first, shown on the page in one click
• Copy all issues as a Markdown list for a developer or writer, or as a ready-made prompt for your AI assistant
• Download an HTML audit report, export comparisons as CSV or Markdown, copy links, images and results as a table

PRIVATE BY DEFAULT
Needle has no server, no analytics and no ads. It installs with no access to websites and reads a page only when you open it there (or, while it is open in the side panel, each tab you switch to and each page you open in it). Results stay in your browser. It contacts Google, Bing or DataForSEO only when you start a check that says so, and asks for access to other websites only when a feature needs it.

Free and open source (MIT). No account needed for the on-page, technical and AI checks. Source code: github.com/Izey-Van-der-haeghen/needle

WHAT'S NEW IN 1.0.2
• Rules checked against Google's own documentation: fewer false alarms in structured data, robots.txt, sitemaps, hreflang, images and headings
• Pages in Japanese, Chinese and Thai are no longer called thin, and words with accents or soft hyphens stay whole
• AI tab: Claude-User, Applebot and DuckAssistBot are checked, and Bing's noarchive is flagged for Copilot
• A page set to noindex gets a shorter list, and shows what it left out
• A link that opens the reader's language version counts as working
• Clearer messages when a page can't be read, for example without internet
• Labels that are only information now have an outline, so they don't look like something to fix
Every change, version by version: github.com/Izey-Van-der-haeghen/needle/blob/main/CHANGELOG.md

> Replace this section with each new version (the store has no separate field for release notes). The lines are the same as `WHATS_NEW` in `lib/whats-new.js`, which the extension shows after an update.

**Screenshots**: 1280 × 800, see `store/screenshots/`.
**Small promo tile**: 440 × 280, `store/promo-440x280.png`.

## Privacy tab

**Single purpose**
Needle audits the web page in the current tab for search engine optimisation (SEO) and AI search readiness, and shows what to fix.

**Permission justifications**

- `activeTab`: Needle reads only the tab the user opens it on, at that moment, to audit that page.
- `scripting`: inject Needle's page reader into that tab on demand, request that site's own files (the page as the server sends it, robots.txt, the sitemap, llms.txt) from inside the tab, and highlight headings, links or problems on the page when the user asks.
- `storage`: keep audit results (5 minutes to 12 hours), the user's history of audited pages, snapshots for "what changed", settings and the user's own API credentials on the device.
- `sidePanel`: show Needle in Chrome's side panel when the user turns that on in Settings, so it can stay open next to the page and follow the tab the user switches to.
- `contextMenus`: add "Audit this page with Needle" and "Compare this link's page with Needle" to the right-click menu.
- Host permissions (optional, requested at runtime): `https://*/*` and `http://*/*` are requested only when the user starts a feature that must reach other websites: checking whether the page's links work, loading competitor pages and hreflang alternates, measuring image file sizes on other servers, comparing the http/https and www versions of a site, and letting the side panel follow the user's tabs. For the DataForSEO and Bing Webmaster Tools APIs, Needle asks only for `https://api.dataforseo.com/*` or `https://ssl.bing.com/*`, when the user saves or uses their own login or key. The extension works without them.

**Remote code**: No. All code is in the package.

**Data usage** (tick these)
- Website content: yes. Page text, headings, links, images and metadata of the audited page are processed locally; the page address is sent to Google (PageSpeed Insights, Chrome UX Report), Microsoft Bing Webmaster Tools or DataForSEO only when the user starts one of those checks.
- Web history: yes. A local list of the last 50 audited pages (address, title, score, time), stored on the device only. The address of the audited page goes to Google, Microsoft Bing or DataForSEO only when the user starts one of those checks.
- Authentication information: yes. The user's own DataForSEO login, Google API key and Bing Webmaster Tools API key, stored on the device and sent only to those services.
- All other categories: no.

**Certifications** (tick all three)
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL**: https://izey.dev/needle/privacy/

## Support and links

- Support email (Account tab): hello@izey.dev
- Homepage URL: https://github.com/Izey-Van-der-haeghen/needle
- Support URL: https://github.com/Izey-Van-der-haeghen/needle/issues

## Distribution tab

- Visibility: Public.
- Regions: all.
- Pricing: free.

## Notes for the reviewer (Test instructions → Additional instructions, max 500 characters)

Username and password: leave empty.

No login needed. Open any public web page and click the Needle toolbar button: the On-page, Technical and AI tabs work without an account. Optional, not needed for review: speed test and trend (own Google key), Bing data (own Bing key), keyword and SERP lookups (own DataForSEO account). Site access is optional and asked for at runtime only by link checks, Compare, image sizes, the hreflang and www checks and the side panel following tabs; Bing and DataForSEO ask only for their API host.
