import { describe, expect, it } from "vitest";
import { hexToRgb, PALETTE_PAIRS, parseRgba } from "./palettes";

describe("palette pairs", () => {
  it("registers the expected Advance themes with distinct ids", () => {
    const ids = PALETTE_PAIRS.flatMap((pair) => [pair.light.id, pair.dark.id]);
    expect(ids).toEqual(["advance-cream", "advance-indigo"]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const pair of PALETTE_PAIRS) {
      expect(pair.light).toMatchObject({
        name: "Advance Cream",
        appearance: "light",
      });
      expect(pair.dark).toMatchObject({
        name: "Advance Indigo",
        appearance: "dark",
      });
      expect(pair.light.appearance).toBe("light");
      expect(pair.dark.appearance).toBe("dark");
    }
  });

  it("provides complete Paseo hex colors for every contribution", () => {
    const expectedKeys = [
      "background",
      "foreground",
      "raised",
      "control",
      "border",
      "accent",
      "mutedForeground",
      "ring",
    ];
    const hexColor = /^#[0-9a-f]{6}$/i;

    for (const contribution of PALETTE_PAIRS.flatMap((pair) => [
      pair.light,
      pair.dark,
    ])) {
      expect(Object.keys(contribution.colors)).toEqual(expectedKeys);
      for (const color of Object.values(contribution.colors)) {
        expect(color).toMatch(hexColor);
      }
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
