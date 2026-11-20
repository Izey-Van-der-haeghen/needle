import { describe, it, expect } from "vitest";
import { classifyIntent } from "../lib/intent.js";

describe("classifyIntent", () => {
  it("returns null for empty keyword", () => {
    expect(classifyIntent("")).toBe(null);
  });

  it("classifies 'how to' as informational", () => {
    const r = classifyIntent("how to bake bread");
    expect(r.intent).toBe("informational");
  });

  it("classifies 'best X' as commercial", () => {
    const r = classifyIntent("best running shoes");
    expect(r.intent).toBe("commercial");
  });

  it("classifies 'buy X' as transactional", () => {
    const r = classifyIntent("buy iphone 15");
    expect(r.intent).toBe("transactional");
  });

  it("classifies Dutch 'kopen' as transactional", () => {
    const r = classifyIntent("iphone kopen");
    expect(r.intent).toBe("transactional");
  });

  it("classifies Dutch 'beste' as commercial", () => {
    const r = classifyIntent("beste laptop 2025");
    expect(r.intent).toBe("commercial");
  });

  it("classifies 'fietsherstelling kost' as transactional", () => {
    const r = classifyIntent("fietsherstelling kost");
    expect(r.intent).toBe("transactional");
  });

  it("returns low confidence for unknown words", () => {
    const r = classifyIntent("randomword");
    expect(r.confidence).toBe("low");
  });

  it("SERP results boost transactional signal", () => {
    const serp = [
      { url: "https://shop.com/product/x", title: "Buy X", snippet: "Best price" },
      { url: "https://shop.com/koop", title: "X kopen", snippet: "Goedkoop" },
    ];
    const r = classifyIntent("widget", serp);
    expect(["transactional", "commercial"]).toContain(r.intent);
  });
});

describe("classifyIntent — whole words", () => {
  it("does not read 'of' inside 'offer' or 'top' inside 'laptop' as commercial", async () => {
    const { classifyIntent: c } = await import("../lib/intent.js");
    expect(c("offer letter template").intent).not.toBe("commercial");
    expect(c("laptop stand").scores.commercial).toBe(0);
  });
  it("knows common French buying words", async () => {
    const { classifyIntent: c } = await import("../lib/intent.js");
    expect(c("prix vélo électrique").intent).toBe("transactional");
  });
});
