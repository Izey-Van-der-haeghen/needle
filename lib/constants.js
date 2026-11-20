/** How much of the server HTML the Technical tab shows. */
export const HTML_SNIPPET_BYTES = 5000;

/** Deadline for ordinary requests (headers and body together). */
export const FETCH_TIMEOUT_MS = 30 * 1000;
/** PageSpeed Insights runs Lighthouse on Google's side and takes longer. */
export const PSI_TIMEOUT_MS = 90 * 1000;

/** Most results kept in the local cache. */
export const CACHE_MAX_ENTRIES = 100;
// Chrome gives an extension 10 MB of local storage; history, snapshots and settings need the rest.
export const CACHE_MAX_BYTES = 4 * 1024 * 1024;
