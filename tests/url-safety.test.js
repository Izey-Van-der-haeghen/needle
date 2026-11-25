import { describe, it, expect } from "vitest";
import { isLocalUrl, isOneWordHost, isSafeHttpUrl } from "../lib/url-safety.js";

describe("isLocalUrl", () => {
  it.each([
    "http://localhost/", "http://127.0.0.1:8080/", "http://10.0.0.5/", "http://172.20.1.1/", "http://192.168.1.1/admin",
    "http://169.254.169.254/latest", "http://[::1]/", "http://router.local/", "http://nas.lan/", "http://0.0.0.0/"
  ])("treats %s as local", (u) => expect(isLocalUrl(u)).toBe(true));

  it.each(["https://example.com/", "http://172.32.0.1/", "https://8.8.8.8/", "not a url"])("treats %s as not local", (u) => expect(isLocalUrl(u)).toBe(false));

  // A one-word name only resolves on the user's own network; the shared address space
  // 100.64.0.0/10 (carrier-grade NAT, Tailscale) is never a public website; ::a.b.c.d is a.b.c.d.
  it.each([
    "http://intranet/", "http://intranet./x", "https://nas:5001/", "http://100.64.0.1/", "http://100.127.255.254/",
    "http://[::127.0.0.1]/", "http://[::192.168.1.1]/admin", "http://[::c0a8:101]/", "http://[::a00:5]/"
  ])("treats %s as local", (u) => expect(isLocalUrl(u)).toBe(true));

  // Public IPv6 literals have no dot either: the one-word rule must not catch them. The rule is for
  // web addresses only: a file page (also one on a network share), chrome:// and chrome-extension://
  // name no web server, so such a page doesn't count as a local page.
  it.each([
    "http://[2606:4700:4700::1111]/", "http://[2001:4860:4860::8888]/", "http://[::8.8.8.8]/",
    "http://100.63.255.255/", "http://100.128.0.1/", "https://example.com./", "file:///Users/me/page.html",
    "file://server/share/page.html", "chrome://settings/", "chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html"
  ])("treats %s as not local", (u) => expect(isLocalUrl(u)).toBe(false));
});

describe("isOneWordHost", () => {
  it.each([
    "http://yourwebsite/", "https://linkedin/company/x", "http://www/", "http://intranet./x", "HTTPS://NAS:5001/"
  ])("%s has a one-word host", (u) => expect(isOneWordHost(u)).toBe(true));

  // localhost is this computer, IP addresses are numbers (2130706433 is 127.0.0.1), and only web addresses count.
  it.each([
    "http://localhost/", "http://localhost./", "http://[::1]/", "http://2130706433/", "http://192.168.1.1/",
    "https://example.com/", "file://server/share/page.html", "chrome://settings/", "ftp://nas/", "not a url"
  ])("%s has no one-word host", (u) => expect(isOneWordHost(u)).toBe(false));
});

describe("isSafeHttpUrl", () => {
  it("accepts http(s) only", () => {
    expect(isSafeHttpUrl("https://e.com")).toBe(true);
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:image/png;base64,x")).toBe(false);
  });
});
