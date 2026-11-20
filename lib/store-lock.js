/**
 * The popup, the side panel, the settings page and the background worker all
 * read and rewrite the same storage entries (cache, history, snapshots). A Web
 * Lock is shared by every page of the extension, so two writers never overwrite
 * each other's changes. Where Web Locks are missing (tests), fn just runs.
 * @template T
 * @param {string} name
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withStoreLock(name, fn) {
  const locks = globalThis.navigator?.locks;
  return locks?.request ? locks.request(`needle:${name}`, fn) : fn();
}
