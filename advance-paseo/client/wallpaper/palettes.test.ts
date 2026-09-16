import { describe, expect, it } from "vitest";
import { hexToRgb, PALETTE_PAIRS, parseRgba } from "./palettes";

describe("palette pairs", () => {
  it("registers one light/dark pair with distinct ids", () => {
    const ids = PALETTE_PAIRS.flatMap((pair) => [pair.light.id, pair.dark.id]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const pair of PALETTE_PAIRS) {
      expect(pair.light.appearance).toBe("light");
      expect(pair.dark.appearance).toBe("dark");
    }
  });
});

describe("color helpers", () => {
  it("parses hex and rgba values", () => {
    expect(hexToRgb("#FAFAFC")).toEqual([250, 250, 252]);
    expect(parseRgba("rgba(18, 20, 26, 0.58)")).toEqual([18, 20, 26, 0.58]);
    expect(parseRgba("rgb(255, 255, 255)")).toEqual([255, 255, 255, 1]);
    expect(parseRgba("transparent")).toBeNull();
    expect(parseRgba("var(--colors-surface0)")).toBeNull();
  });
});
