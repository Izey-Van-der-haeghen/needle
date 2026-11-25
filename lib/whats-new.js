import { REPO_URL } from "./links.js";

/** The full list of changes, on GitHub. */
export const CHANGELOG_URL = `${REPO_URL}/blob/main/CHANGELOG.md`;

/**
 * What a user notices in each version, in a few plain lines. CHANGELOG.md has everything.
 * Add an entry for every new version (a test checks the manifest's version has one).
 */
export const WHATS_NEW = {
  "1.0.3": [
    "Screen readers hear every result in the words on the screen, and each button has its own name.",
    "Long words, long addresses and right-to-left text no longer push the side panel or the report sideways, also at 200% zoom.",
    "Addresses show their letters (Région, bücher.example); characters that could disguise an address stay encoded.",
    "The http/https/www check says when versions didn't answer, instead of calling them different.",
    "Compare offers \"Allow DataForSEO\" or \"Open Settings\" when Google positions need them, and keeps its result after reopening.",
    "One main button per tab, and Settings turns Save coral only while something is unsaved.",
    "robots.txt: \"Allow: /dir/index.html\" also allows /dir/, as Google's own parser does.",
    "Safer with hostile pages: page text can't add HTML, huge or deeply nested files no longer slow Needle down, and nothing on your local network is requested."
  ],
  "1.0.2": [
    "Rules checked against Google's own documentation: fewer false alarms in structured data, robots.txt, sitemaps, hreflang, images and headings.",
    "Pages in Japanese, Chinese and Thai are no longer called thin, and words with accents or soft hyphens stay whole.",
    "AI tab: Claude-User, Applebot and DuckAssistBot are checked, and Bing's noarchive is flagged for Copilot.",
    "A page set to noindex gets a shorter list, and shows what it left out.",
    "A link that opens the reader's language version counts as working.",
    "Clearer messages when a page can't be read, for example without internet.",
    "Labels that are only information now have an outline, so they don't look like something to fix."
  ],
  "1.0.1": [
    "Responsive images are judged by the file the browser loaded, so they're no longer flagged as too large.",
    "Fewer false alarms in structured data, the AI tab and hreflang. Campaign links (?utm_…) count as the same page.",
    "Text files such as /llms.txt get a short note instead of a full audit."
  ]
};

/** Compare "1.0.10" and "1.0.2" as versions, not as text. */
function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * The note to show after an update: every version newer than the one the user had, newest
 * first, with its lines. null after a fresh install or when nothing changed.
 * @param {string} version - the version now installed
 * @param {string} [previousVersion] - from chrome.runtime.onInstalled
 * @returns {{version: string, from: string, sections: Array<{version: string, items: string[]}>}|null}
 */
export function whatsNewFor(version, previousVersion) {
  if (!previousVersion || compareVersions(version, previousVersion) <= 0) return null;
  const sections = Object.keys(WHATS_NEW)
    .filter((v) => compareVersions(v, previousVersion) > 0 && compareVersions(v, version) <= 0)
    .sort((a, b) => compareVersions(b, a))
    .map((v) => ({ version: v, items: WHATS_NEW[v] }));
  return { version, from: previousVersion, sections };
}
