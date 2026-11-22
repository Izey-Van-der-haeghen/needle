// robots.txt, sitemaps, URL keys, hreflang alternates and the server HTML against the page
// after JavaScript (review of 1.0.2: rules C1, C2, B2, B3, C26, A4; edge cases 19, 21, 30).
import { describe, it, expect, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import { isAllowedByRobots, parseRobots, robotsSitemaps, agentToken } from "../lib/robots.js";
import { analyzeAIAccess } from "../lib/geo.js";
import { analyzeTechnical, extractWordCount, rawSnapshot, serverIndexingTags } from "../lib/technical.js";
import { computeIndexability, computeHealthScore } from "../lib/popup-compute.js";
import { collectFindings } from "../lib/findings.js";
import { findInSitemaps, readLocs, sitemapKind, sitemapEntries } from "../lib/sitemap-check.js";
import { urlKey, exactUrlKey } from "../lib/urls.js";
import { checkHreflangCluster } from "../lib/hreflang-cluster.js";
import { loadContentScript, html } from "./helpers/content-harness.js";

const allowed = (txt, path, ua = "googlebot") => isAllowedByRobots(txt, path, ua).allowed;

describe("robots.txt groups: only a rule ends the list of user agents", () => {
  it("a Crawl-delay line between two user-agent lines keeps them in one group", () => {
    expect(allowed("User-agent: GPTBot\nCrawl-delay: 5\nUser-agent: OAI-SearchBot\nDisallow: /", "/x", "GPTBot")).toBe(false);
    const ai = analyzeAIAccess({ text: "User-agent: GPTBot\nCrawl-delay: 2\nUser-agent: OAI-SearchBot\nDisallow: /" }, "/");
    expect(ai.bots.find((b) => b.ua === "GPTBot").allowed).toBe(false);
  });

  it("a Sitemap line between two user-agent lines keeps them in one group (Google's example)", () => {
    expect(allowed("User-agent: googlebot\nSitemap: https://e.com/s.xml\nUser-agent: bingbot\nDisallow: /", "/x")).toBe(false);
  });

  it("a rule still ends the group, so a later user-agent starts a new one", () => {
    const txt = "User-agent: googlebot\nDisallow: /a\nUser-agent: bingbot\nDisallow: /";
    expect(allowed(txt, "/x")).toBe(true);
    expect(parseRobots(txt).map((g) => g.uas)).toEqual([["googlebot"], ["bingbot"]]);
  });
});

describe("robots.txt user agents: the product token counts", () => {
  it("Googlebot/2.1 and googlebot* are googlebot", () => {
    expect(allowed("User-agent: Googlebot/2.1\nDisallow: /\n\nUser-agent: *\nAllow: /", "/x")).toBe(false);
    expect(allowed("User-agent: googlebot*\nDisallow: /", "/x")).toBe(false);
  });

  it("googlebot-news stays another crawler, and * followed by text is every crawler", () => {
    expect(allowed("User-agent: Googlebot-News\nDisallow: /", "/x")).toBe(true);
    expect(agentToken("* all bots")).toBe("*");
    expect(agentToken("GPTBot/1.1 (+https://openai.com/gptbot)")).toBe("gptbot");
  });
});

describe("robots.txt lines are read as Google's parser reads them", () => {
  it("accepts a space instead of the colon, on a line of two words", () => {
    expect(allowed("User-agent: *\nDisallow /private", "/private")).toBe(false);
    expect(allowed("User-agent *\nDisallow /private", "/private")).toBe(false);
    // Three words: no field and value to tell apart, so the line is ignored.
    expect(allowed("User-agent: *\nDisallow / private", "/private")).toBe(true);
  });

  it("accepts the frequent typos Google accepts", () => {
    expect(allowed("User-agent: *\nDissallow: /private", "/private")).toBe(false);
    expect(allowed("Useragent: googlebot\nDisalow: /private", "/private")).toBe(false);
  });

  it("counts the 500 KiB limit in bytes, not characters", () => {
    // 200 Ki characters of 3 bytes each is 600 KiB: the Disallow after it is past the limit.
    const pad = "# " + "€".repeat(200 * 1024) + "\n";
    expect(allowed("User-agent: *\nDisallow: /a\n" + pad + "Disallow: /b", "/a")).toBe(false);
    expect(allowed("User-agent: *\nDisallow: /a\n" + pad + "Disallow: /b", "/b")).toBe(true);
  });

  it("reads Sitemap lines with any spacing and case, but not in comments", () => {
    expect(robotsSitemaps("SITEMAP:https://a.com/a.xml\r\n  sitemap : https://a.com/b.xml\n# Sitemap: https://a.com/c.xml\nSitemap: https://a.com/d.xml # main"))
      .toEqual(["https://a.com/a.xml", "https://a.com/b.xml", "https://a.com/d.xml"]);
  });
});

describe("robots.txt that can't be read (B3)", () => {
  const page = { url: "https://e.com/p", canonical: "https://e.com/p", robots: "", title: "A title that is long enough", description: "d".repeat(130),
    headings: [{ level: 1, text: "H" }], viewport: "width=device-width", lang: "en", mainContentWordCount: 800, images: [], links: { details: [] },
    schema: [], og: { title: "t", image: "https://e.com/i.jpg" }, hreflang: [] };
  const readable = { status: 200, headers: {}, robotsTxt: { ok: true, status: 200, sitemaps: [], pathAllowed: { allowed: true, rule: null } }, sitemap: { ok: true } };
  const failed = { ...readable, robotsTxt: { ok: false, status: 0, error: "Could not connect", sitemaps: [], pathAllowed: null } };

  it("a failed request is a note: the verdict stays Indexable and the score doesn't drop", () => {
    const v = computeIndexability(page, failed);
    expect(v).toMatchObject({ level: "good", verdict: "Indexable" });
    expect(v.issues).toEqual([expect.objectContaining({ msg: "Needle could not read robots.txt (Could not connect)" })]);
    expect(v.issues[0].hint).toMatch(/redirects to another domain/);
    expect(computeHealthScore(page, failed).score).toBe(computeHealthScore(page, readable).score);
    // The same weight as in Fix this first.
    expect(collectFindings({ onpage: page, tech: failed }).find((f) => f.id.startsWith("robots"))).toMatchObject({ id: "robots-unchecked", severity: "low" });
  });

  it("a server error or 429 still turns the verdict amber, as Google pauses crawling", () => {
    for (const status of [503, 429]) {
      const v = computeIndexability(page, { ...readable, robotsTxt: { ok: false, status, sitemaps: [], pathAllowed: null } });
      expect(v.level).toBe("warn");
      expect(v.issues[0].msg).toBe(`robots.txt could not be read (HTTP ${status})`);
    }
  });
});

describe("sitemaps Google accepts are not reported missing (B2)", () => {
  const PAGE = "https://www.example.com/p";
  const onpage = { url: PAGE, canonical: PAGE, title: "T", description: "", headings: [], links: { details: [] }, images: [], schema: [] };
  const fetcher = (pages) => async (reqs) => reqs.map((r) => {
    const p = pages[r.url];
    if (p === "cors") return { ok: false, status: 0, url: r.url, error: "Could not connect" };
    if (!p) return { ok: false, status: 404, url: r.url, headers: {}, text: "" };
    return { ok: true, status: 200, url: r.url, headers: p.headers || {}, text: p.text };
  });
  const audit = async (robots, files) => analyzeTechnical(PAGE, fetcher({
    [PAGE]: { text: "<p>x</p>" },
    "https://www.example.com/robots.txt": { headers: { "content-type": "text/plain" }, text: robots },
    ...files
  }));
  const sitemapFinding = (tech) => collectFindings({ onpage, tech }).find((f) => f.id === "sitemap");

  it("a sitemap on another host is 'not checked', not missing", async () => {
    const tech = await audit("Sitemap: https://cdn.example.net/sitemap.xml", { "https://cdn.example.net/sitemap.xml": "cors" });
    expect(tech.sitemap).toMatchObject({ ok: false, unchecked: true, reason: "on another site, not checked" });
    expect(sitemapFinding(tech)).toBeUndefined();
  });

  it("a .xml.gz that arrives compressed is 'not checked', not missing", async () => {
    const tech = await audit("Sitemap: https://www.example.com/sitemap.xml.gz", {
      "https://www.example.com/sitemap.xml.gz": { headers: { "content-type": "application/x-gzip" }, text: "\x1f�\b\0\0\0\0\0" }
    });
    expect(tech.sitemap).toMatchObject({ ok: false, unchecked: true, reason: "compressed (.gz), not checked" });
    expect(sitemapFinding(tech)).toBeUndefined();
  });

  it("RSS, Atom and text sitemaps are valid, with their URLs counted", async () => {
    const rss = '<?xml version="1.0"?><rss version="2.0"><channel><link>https://www.example.com/</link><item><link>https://www.example.com/a</link></item><item><link>https://www.example.com/b</link></item></channel></rss>';
    const atom = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><link href="https://www.example.com/"/><entry><link rel="alternate" href="https://www.example.com/a"/></entry></feed>';
    const text = "https://www.example.com/a\nhttps://www.example.com/b\nhttps://www.example.com/c\n";
    for (const [file, body, format, count] of [["feed.xml", rss, "rss", 2], ["atom.xml", atom, "atom", 1], ["urls.txt", text, "text", 3]]) {
      const tech = await audit(`Sitemap: https://www.example.com/${file}`, { [`https://www.example.com/${file}`]: { text: body } });
      expect(tech.sitemap).toMatchObject({ ok: true, format, urlCount: count, isIndex: false });
      expect(sitemapFinding(tech)).toBeUndefined();
    }
  });

  it("an HTML page or a broken listed sitemap is still reported, naming the file", async () => {
    let tech = await audit("", { "https://www.example.com/sitemap.xml": { headers: { "content-type": "text/html" }, text: "<!doctype html><html><title>404</title></html>" } });
    expect(sitemapFinding(tech)).toMatchObject({ title: "No valid sitemap found", examples: ["https://www.example.com/sitemap.xml: not a sitemap (HTML or empty)"] });
    // A listed sitemap that answers 404 counts for more than one Needle can't read.
    tech = await audit("Sitemap: https://www.example.com/gone.xml\nSitemap: https://cdn.example.net/s.xml", { "https://cdn.example.net/s.xml": "cors" });
    expect(tech.sitemap).toMatchObject({ ok: false, url: "https://www.example.com/gone.xml", reason: "HTTP 404" });
    expect(sitemapFinding(tech)).toBeDefined();
  });

  it("a page of URLs that isn't a .txt or text/plain file is not taken for a text sitemap", () => {
    expect(sitemapKind("https://a.com/x\n", "https://a.com/sitemap", "text/html")).toBeNull();
    expect(sitemapKind("<html><body>https://a.com/x</body></html>", "https://a.com/s.txt", "text/plain")).toBeNull();
  });

  it("'Is this page in the sitemap?' reads RSS, Atom and text sitemaps too", async () => {
    const files = {
      "https://e.com/feed.xml": '<rss><channel><link>https://e.com/</link><item><title>A</title><link><![CDATA[https://e.com/a?x=1&amp;y=2]]></link></item></channel></rss>',
      "https://e.com/atom.xml": '<feed xmlns="http://www.w3.org/2005/Atom"><entry><link rel="enclosure" href="https://e.com/a.mp3"/><link href="https://e.com/b"/></entry></feed>',
      "https://e.com/urls.txt": "﻿https://e.com/c\r\nhttps://e.com/d\r\n"
    };
    const f = async (reqs) => reqs.map((r) => (files[r.url] ? { ok: true, status: 200, text: files[r.url], headers: {} } : { ok: false, status: 404 }));
    expect(await findInSitemaps("https://e.com/a?x=1&y=2", ["https://e.com/feed.xml"], f)).toMatchObject({ found: true });
    expect(await findInSitemaps("https://e.com/b", ["https://e.com/atom.xml"], f)).toMatchObject({ found: true });
    expect(await findInSitemaps("https://e.com/d/", ["https://e.com/urls.txt"], f)).toMatchObject({ found: true });
    // The channel's own link is the site, not a listed page; an enclosure is a file.
    expect(sitemapEntries(files["https://e.com/feed.xml"], "rss")).toEqual(["https://e.com/a?x=1&y=2"]);
    expect(sitemapEntries(files["https://e.com/atom.xml"], "atom")).toEqual(["https://e.com/b"]);
  });
});

describe("URL keys and sitemap matching (edge 21)", () => {
  it("escape case, an empty ? and a trailing dot on the host don't make another URL", () => {
    expect(urlKey("https://a.com/caf%c3%a9")).toBe(urlKey("https://a.com/café"));
    expect(urlKey("https://a.com/s?q=%c3%a9")).toBe(urlKey("https://a.com/s?q=%C3%A9"));
    expect(urlKey("https://www.example.be/fr?")).toBe(urlKey("https://www.example.be/fr"));
    expect(urlKey("https://a.com./x")).toBe(urlKey("https://a.com/x"));
  });

  it("a slash inside the query is part of the URL; the path's trailing slash and the root's are not", () => {
    expect(urlKey("https://a.com/login?next=/")).not.toBe(urlKey("https://a.com/login?next="));
    expect(urlKey("https://a.com/fr/")).toBe("https://a.com/fr");
    expect(urlKey("HTTPS://WWW.Example.BE:443/#x")).toBe("https://www.example.be");
    expect(urlKey("https://a.com/?q=1")).toBe("https://a.com/?q=1");
  });

  it("exactUrlKey keeps the trailing slash apart", () => {
    expect(exactUrlKey("https://a.com/fr")).not.toBe(exactUrlKey("https://a.com/fr/"));
    expect(exactUrlKey("https://A.com./fr/?#x")).toBe("https://a.com/fr/");
  });

  it("sitemap <loc> values decode every XML entity once", () => {
    expect(readLocs("<urlset><url><loc>https://a.com/l&apos;atelier?a=1&amp;b=2&#38;c=&#x33;</loc></url><url><loc>https://a.com/x?q=&amp;lt;</loc></url></urlset>"))
      .toEqual(["https://a.com/l'atelier?a=1&b=2&c=3", "https://a.com/x?q=&lt;"]);
  });

  it("a sitemap with lower-case escapes lists the page", async () => {
    const f = async () => [{ ok: true, status: 200, text: "<urlset><url><loc>https://a.com/caf%c3%a9/</loc></url></urlset>" }];
    expect(await findInSitemaps("https://a.com/caf%C3%A9/", ["https://a.com/sitemap.xml"], f)).toMatchObject({ found: true });
  });
});

describe("served HTML without a <body> tag (edge 30)", () => {
  it("counts only the page text, not the <title>", () => {
    expect(extractWordCount("<!doctype html><html><head><title>One two three four</title></head><p>five six</p></html>")).toBe(2);
    expect(extractWordCount("<!doctype html><title>One two three four</title><p>five six</p>")).toBe(2);
    // With a <body> tag nothing changes.
    expect(extractWordCount("<html><head><title>One two</title></head><body><p>three</p></body></html>")).toBe(1);
  });
});

describe("hreflang alternates (C26)", () => {
  const parse = (h) => new JSDOM(h).window.document;
  const alt = (back = "https://e.com/en/", canonical = "https://e.com/fr/") =>
    `<link rel="canonical" href="${canonical}"><link rel="alternate" hreflang="en" href="${back}"><link rel="alternate" hreflang="fr" href="https://e.com/fr/">`;
  const run = (pageUrl, hreflang, answer) => checkHreflangCluster(pageUrl, hreflang, async (url) => ({ status: 200, url, html: alt(), headers: {}, ...answer(url) }), parse);
  const EN = "https://e.com/en/";
  const pair = [{ lang: "en", href: EN }, { lang: "fr", href: "https://e.com/fr/" }];

  it("reads an alternate's X-Robots-Tag header, as Google does", async () => {
    const [row] = await run(EN, pair, () => ({ headers: { "x-robots-tag": "noindex" } }));
    expect(row).toMatchObject({ noindex: true, problems: ["noindex (X-Robots-Tag header)"] });
    const [other] = await run(EN, pair, () => ({ headers: { "x-robots-tag": "bingbot: noindex" } }));
    expect(other).toMatchObject({ noindex: false, problems: [] });
  });

  it("an alternate that redirects to add the trailing slash is flagged", async () => {
    const [row] = await run(EN, [{ lang: "en", href: EN }, { lang: "fr", href: "https://e.com/fr" }], () => ({ url: "https://e.com/fr/" }));
    expect(row.problems).toEqual(["redirects to https://e.com/fr/ (the trailing slash differs)"]);
  });

  it("a canonical or return link that differs only by the trailing slash is flagged", async () => {
    const [row] = await run(EN, pair, () => ({ html: alt("https://e.com/en", "https://e.com/fr") }));
    expect(row.selfCanonical).toBe(false);
    expect(row.returnLink).toBe(true);
    expect(row.problems).toEqual(["canonical points to https://e.com/fr (the trailing slash differs)", "links back to https://e.com/en (the trailing slash differs)"]);
  });

  it("return links are compared with the page's own hreflang spelling", async () => {
    // Audited at /en, but the page and its alternates agree on /en/: nothing to flag.
    const [row] = await run("https://e.com/en", pair, () => ({}));
    expect(row.problems).toEqual([]);
  });

  it("a return link with other escape case still links back", async () => {
    const rows = await checkHreflangCluster("https://a.com/caf%c3%a9", [{ lang: "fr", href: "https://a.com/fr/" }], async (url) => ({
      status: 200, url, html: '<link rel="canonical" href="https://a.com/fr/"><link rel="alternate" hreflang="nl" href="https://a.com/café">'
    }), parse);
    expect(rows[0].problems).toEqual([]);
  });
});

describe("server HTML: robots metas and canonical (A4)", () => {
  it("reads the robots and googlebot metas anywhere and the first canonical in <head>", () => {
    const served = `<!doctype html><html><head>
      <base href="/shop/">
      <META NAME="ROBOTS" CONTENT=" noindex, follow ">
      <link rel="preload canonical" href="item?id=1&amp;ref=a">
      <link rel="canonical" href="/second">
      </head><body><meta name="googlebot" content='nosnippet'><link rel="canonical" href="/in-body"></body></html>`;
    expect(serverIndexingTags(served, "https://e.com/p")).toEqual({ robots: "noindex, follow, googlebot: nosnippet", canonical: "https://e.com/shop/item?id=1&ref=a" });
  });

  it("ignores tags in comments, scripts, templates and noscript, which are no elements in the page", () => {
    const served = `<head><!-- <meta name="robots" content="noindex"> -->
      <script>document.write('<meta name="robots" content="noindex"><link rel="canonical" href="/x">')</script>
      <noscript><meta name="robots" content="noindex"></noscript>
      <template><meta name="robots" content="noindex"></template>
      <meta name="description" content="robots noindex"></head>`;
    expect(serverIndexingTags(served, "https://e.com/p")).toEqual({ robots: "", canonical: "" });
  });

  // The same HTML must give the same answer in content.js (the page in the tab), or every
  // difference would look like a change made by JavaScript.
  const opened = [];
  afterEach(() => { while (opened.length) opened.pop().window.close(); });
  const analyse = async (page, url) => {
    const loaded = await loadContentScript(page, { url });
    opened.push(loaded);
    return loaded.send({ type: "ANALYZE_ONPAGE" });
  };

  it("reads a page exactly as content.js reads it", async () => {
    const url = "https://www.example.be/fr-be/atelier/";
    const page = html(
      '<p>Text</p><meta name="googlebot" content="noarchive"><link rel="canonical" href="/elsewhere">',
      '<base href="https://www.example.be/fr-be/"><meta name="Robots" content="max-snippet:50"><noscript><meta name="robots" content="noindex"></noscript><link rel="canonical" href="atelier/?a=1&amp;b=2">'
    );
    const tab = await analyse(page, url);
    expect(serverIndexingTags(page, url)).toEqual({ robots: tab.robots, canonical: tab.canonical });
  });

  const URL_ = "https://www.example.be/nl-be/fiets/";
  const served = html("<h1>Fiets</h1><p>Tekst</p>", '<meta name="robots" content="noindex"><link rel="canonical" href="https://www.example.be/nl-be/">');
  // An inline script that removes the noindex and changes the canonical, as some single-page apps do.
  const changed = served.replace("</body>", `<script>
    document.querySelector('meta[name="robots"]').remove();
    document.querySelector('link[rel="canonical"]').href = "${URL_}";
  </script></body>`);
  const tech = (over = {}) => ({ status: 200, headers: {}, redirected: false, robotsTxt: { ok: true, sitemaps: [], pathAllowed: { allowed: true, rule: null } }, sitemap: { ok: true }, raw: rawSnapshot(served, URL_), ...over });

  it("flags a noindex and a canonical that JavaScript changes", async () => {
    const onpage = await analyse(changed, URL_);
    expect(onpage.robots).toBe("");
    const findings = collectFindings({ onpage, tech: tech() });
    expect(findings.find((f) => f.id === "noindex-js")).toMatchObject({ severity: "critical", title: "Server HTML says noindex; JavaScript removes it" });
    // noindex from the server shortens the list as a meta noindex does: the canonical waits in leftOut.
    expect(findings.find((f) => f.id === "canonical-js")).toBeUndefined();
    expect(findings.leftOut.find((f) => f.id === "canonical-js")).toMatchObject({
      severity: "high",
      title: "The canonical in the server HTML differs from the rendered one",
      why: expect.stringContaining(`The server HTML names https://www.example.be/nl-be/; after JavaScript the page names ${URL_}.`)
    });
  });

  it("says nothing when the page matches the server HTML, or still has the noindex", async () => {
    const same = collectFindings({ onpage: await analyse(served, URL_), tech: tech() }).map((f) => f.id);
    expect(same).toContain("noindex-meta");
    expect(same).not.toContain("noindex-js");
    expect(same).not.toContain("canonical-js");
    // Campaign parameters and a relative spelling are the same canonical.
    const onpage = { ...(await analyse(changed, URL_)), canonical: "https://www.example.be/nl-be/?utm_source=x" };
    expect(collectFindings({ onpage, tech: tech() }).map((f) => f.id)).not.toContain("canonical-js");
  });

  it("compares only when the server answered this URL with 200", async () => {
    const onpage = await analyse(changed, URL_);
    for (const over of [{ status: 403 }, { redirected: true, finalUrl: "https://www.example.be/nl/fiets/" }, { raw: null }]) {
      const ids = collectFindings({ onpage, tech: tech(over) }).map((f) => f.id);
      expect(ids).not.toContain("noindex-js");
      expect(ids).not.toContain("canonical-js");
    }
  });
});
