import { describe, it, expect, vi } from "vitest";
import { checkHostVariants } from "../lib/variants.js";

describe("checkHostVariants", () => {
  it("is consistent when all four variants end on one URL", async () => {
    const f = vi.fn(async () => ({ status: 200, url: "https://www.e.com/", body: null }));
    const r = await checkHostVariants("https://www.e.com/page", f);
    expect(f.mock.calls.map((c) => c[0])).toEqual(["http://e.com/", "http://www.e.com/", "https://e.com/", "https://www.e.com/"]);
    expect(r).toMatchObject({ consistent: true, target: "https://www.e.com/" });
  });

  it("flags a variant that stays on http or doesn't answer", async () => {
    const f = vi.fn(async (url) => {
      if (url === "http://e.com/") return { status: 200, url: "http://e.com/" };
      if (url === "https://e.com/") throw new Error("certificate error");
      return { status: 200, url: "https://www.e.com/" };
    });
    const r = await checkHostVariants("https://www.e.com/", f);
    expect(r.consistent).toBe(false);
    expect(r.variants.find((v) => v.url === "https://e.com/").error).toBe("certificate error");
  });

  it("checks only http and https for a subdomain other than www", async () => {
    const f = vi.fn(async (url) => ({ status: 200, url: "https://shop.e.com/" }));
    await checkHostVariants("https://shop.e.com/x", f);
    expect(f.mock.calls.map((c) => c[0])).toEqual(["http://shop.e.com/", "https://shop.e.com/"]);
  });
});
