/**
 * Is a URL listed in the site's XML sitemaps? Follows sitemap indexes, reading
 * at most `maxFiles` files, and compares URLs without #fragment, trailing slash
 * or host case.
 */

const norm = (u) => {
  try {
    const x = new URL(u.trim());
    x.hash = "";
    return (x.protocol + "//" + x.host.toLowerCase() + x.pathname.replace(/\/$/, "") + x.search);
  } catch {
    return String(u || "").trim();
  }
};

/** Pull <loc> values out of a sitemap or sitemap index. */
export function readLocs(xml) {
  return [...String(xml || "").matchAll(/<loc[^>]*>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)]
    .map((m) => m[1].replace(/&amp;/g, "&"));
}

/**
 * @param {string} pageUrl
 * @param {string[]} startUrls - sitemaps from robots.txt, or /sitemap.xml
 * @param {(reqs: Array<{url: string, maxBytes?: number}>) => Promise<Array<{ok: boolean, status: number, text?: string}>>} fetcher
 * @param {{maxFiles?: number}} [opts]
 * @returns {Promise<{found: boolean, sitemap: string|null, filesRead: number, unread: number, complete: boolean, unreadable: boolean}>}
 *   unread: files that answered with an error or could not be fetched; unreadable: none could be read at all.
 */
export async function findInSitemaps(pageUrl, startUrls, fetcher, { maxFiles = 15 } = {}) {
  const target = norm(pageUrl);
  const queue = [...new Set(startUrls)];
  const seen = new Set();
  let filesRead = 0;
  let unread = 0;
  while (queue.length && filesRead < maxFiles) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const [r] = await fetcher([{ url, maxBytes: 10 * 1024 * 1024 }]);
    filesRead++;
    if (!r?.ok || !r.text) { unread++; continue; }
    const isIndex = /<sitemapindex[\s>]/i.test(r.text);
    const locs = readLocs(r.text);
    if (isIndex) queue.push(...locs.filter((l) => !seen.has(l)));
    else if (locs.some((l) => norm(l) === target)) return { found: true, sitemap: url, filesRead, unread, complete: true, unreadable: false };
  }
  return { found: false, sitemap: null, filesRead, unread, complete: queue.length === 0 && unread === 0, unreadable: filesRead > 0 && unread === filesRead };
}
