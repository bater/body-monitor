import { describe, it, expect } from "vitest";
import { lookupFood, FOOD_DB_SIZE } from "./food-db";

describe("lookupFood", () => {
  it("bundles a non-trivial Taiwan food table", () => {
    expect(FOOD_DB_SIZE).toBeGreaterThan(1000);
  });

  it("matches a plain food name to official per-100g values", () => {
    const m = lookupFood("白飯");
    expect(m?.name).toBe("白飯");
    expect(m?.protein100).toBeCloseTo(3.1, 1);
    expect(m?.kcal100).toBe(183);
  });

  it("matches via an alias (雞胸肉 → 去皮清肉)", () => {
    const m = lookupFood("雞胸肉");
    expect(m).not.toBeNull();
    expect(m!.protein100).toBeGreaterThan(20); // lean chicken breast
  });

  it("matches when the query embeds a cooking method (烤鮭魚 → 鮭魚)", () => {
    expect(lookupFood("烤鮭魚")?.name).toContain("鮭魚");
  });

  it("matches a shorter query inside a longer name (豆漿)", () => {
    expect(lookupFood("豆漿")?.name).toBe("豆漿");
  });

  it("prefers the more generic (shorter) name on ties", () => {
    // both 北蕉 and longer banana names carry alias 香蕉; generic one wins
    expect(lookupFood("香蕉")?.name.length).toBeLessThanOrEqual(3);
  });

  it("returns null for single-character and unknown queries", () => {
    expect(lookupFood("蛋")).toBeNull();
    expect(lookupFood("zzzzz不存在的食物")).toBeNull();
  });
});
