import { describe, it, expect } from "vitest";
import { isLocalUrl, isSafeHttpUrl } from "../lib/url-safety.js";

describe("isLocalUrl", () => {
  it.each([
    "http://localhost/", "http://127.0.0.1:8080/", "http://10.0.0.5/", "http://172.20.1.1/", "http://192.168.1.1/admin",
    "http://169.254.169.254/latest", "http://[::1]/", "http://router.local/", "http://nas.lan/", "http://0.0.0.0/"
  ])("treats %s as local", (u) => expect(isLocalUrl(u)).toBe(true));

  it.each(["https://example.com/", "http://172.32.0.1/", "https://8.8.8.8/", "not a url"])("treats %s as not local", (u) => expect(isLocalUrl(u)).toBe(false));
});

describe("isSafeHttpUrl", () => {
  it("accepts http(s) only", () => {
    expect(isSafeHttpUrl("https://e.com")).toBe(true);
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:image/png;base64,x")).toBe(false);
  });
});
