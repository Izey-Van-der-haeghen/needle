/**
 * Does a URL point at this computer or a private network (router admin pages,
 * NAS, intranet)? Page-chosen URLs (links, images, sitemap lines) to such hosts
 * are not requested unless the audited page is itself local.
 * shortcut: literal hosts only; DNS names that resolve to LAN addresses still pass.
 * @param {string} url
 * @returns {boolean}
 */
export function isLocalUrl(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  host = host.replace(/^\[|\]$/g, "").replace(/\.$/, ""); // "localhost." is localhost
  // An IPv4 address written as IPv6 (::ffff:192.168.1.1, which the URL parser turns into
  // ::ffff:c0a8:101) is that IPv4 address.
  const mapped = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) {
    const [hi, lo] = [parseInt(mapped[1], 16), parseInt(mapped[2], 16)];
    host = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  if (host === "localhost" || /\.(localhost|local|internal|lan|home\.arpa)$/.test(host)) return true;
  if (host === "0.0.0.0" || host === "::1" || host === "::") return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0;
  }
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return true;
  return false;
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
