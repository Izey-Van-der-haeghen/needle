/**
 * Does a URL point at this computer or a private network (router admin pages,
 * NAS, intranet)? Page-chosen URLs (links, images, sitemap lines) to such hosts
 * are not requested unless the audited page is itself local.
 * A web address with a one-word host (http://intranet/, http://nas/) counts as local: see
 * isOneWordHost. Other DNS names that resolve to LAN addresses (192.168.1.1.nip.io,
 * localtest.me) still pass: an extension can't resolve a name before it fetches.
 * @param {string} url
 * @returns {boolean}
 */
export function isLocalUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (oneWordWebHost(u)) return true;
  let host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, ""); // "localhost." is localhost
  // An IPv4 address written as IPv6 (::ffff:192.168.1.1, which the URL parser turns into
  // ::ffff:c0a8:101, or the old ::192.168.1.1, which becomes ::c0a8:101) is that IPv4 address.
  const mapped = host.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) {
    const [hi, lo] = [parseInt(mapped[1], 16), parseInt(mapped[2], 16)];
    host = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  if (host === "localhost" || /\.(localhost|local|internal|lan|home\.arpa)$/.test(host)) return true;
  if (host === "0.0.0.0" || host === "::1" || host === "::") return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    // 100.64.0.0/10 is shared address space (carrier-grade NAT, Tailscale): never a public website.
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0 || (a === 100 && b >= 64 && b <= 127);
  }
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return true;
  return false;
}

/**
 * Is the host of a web address one word, with no dot (http://intranet/, https://nas:5001/,
 * http://yourwebsite/)? Such a name only resolves on the user's own network, never on the
 * public web. localhost is left out: it is this computer. Only http and https count, since
 * file://server/share/, chrome://settings/ and chrome-extension://<id>/ name no web server.
 * @param {string} url
 * @returns {boolean}
 */
export function isOneWordHost(url) {
  try { return oneWordWebHost(new URL(url)); } catch { return false; }
}

/** @param {URL} u */
function oneWordWebHost(u) {
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  // IPv6 literals have colons and IPv4 addresses have dots ("localhost." is localhost).
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  return host !== "localhost" && !host.includes(".") && !host.includes(":");
}

/**
 * Is a value a safe http(s) URL to put in an href, src or CSS url()?
 * @param {*} s
 * @returns {boolean}
 */
export function isSafeHttpUrl(s) {
  if (!s || typeof s !== "string") return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
