// Paths into a plain object such as the popup's saved popupState. A path is an array of keys,
// e.g. ["marketByHost", "www.example.com"] (host names contain dots, so no "a.b" strings here).

/**
 * The value at `parts`, or undefined when a step is missing.
 * @param {Object} obj
 * @param {string[]} parts
 */
const getIn =(obj, parts) => parts.reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);

/**
 * Set the value at `parts`, creating objects on the way. `undefined` removes the last key.
 * @param {Object} obj - changed in place
 * @param {string[]} parts
 * @param {*} value
 */
export function setIn(obj, parts, value) {
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!o[parts[i]] || typeof o[parts[i]] !== "object") o[parts[i]] = {};
    o = o[parts[i]];
  }
  if (value === undefined) delete o[parts[parts.length - 1]];
  else o[parts[parts.length - 1]] = value;
}

/**
 * A copy of `base` with the values of `paths` taken from `from` (a path missing in `from` is removed).
 * Neither input is changed, and the result shares no objects with them.
 * @param {Object} base
 * @param {Object} from
 * @param {string[][]} paths
 * @returns {Object}
 */
export function withPaths(base, from, paths) {
  const out = JSON.parse(JSON.stringify(base || {}));
  for (const p of paths) {
    const v = getIn(from, p);
    setIn(out, p, v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  }
  return out;
}
