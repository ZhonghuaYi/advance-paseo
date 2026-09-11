import { describe, expect, it } from "vitest";
import {
  ALL_DARK_MARKERS,
  ALL_LIGHT_MARKERS,
  hexToRgb,
  MIKU_PAIR,
  NEUTRAL_PAIR,
  PALETTE_PAIRS,
} from "./palettes";

describe("palette pairs", () => {
  it("registers two light/dark pairs with distinct ids", () => {
    const ids = PALETTE_PAIRS.flatMap((pair) => [pair.light.id, pair.dark.id]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const pair of PALETTE_PAIRS) {
      expect(pair.light.appearance).toBe("light");
      expect(pair.dark.appearance).toBe("dark");
    }
  });

  it("derives markers from each palette's own surfaces", () => {
    for (const pair of [MIKU_PAIR, NEUTRAL_PAIR]) {
      expect(pair.lightMarkers).toContainEqual(hexToRgb(pair.light.colors.background));
      expect(pair.darkMarkers).toContainEqual(hexToRgb(pair.dark.colors.background));
    }
  });

  it("keeps light and dark marker families disjoint", () => {
    for (const light of ALL_LIGHT_MARKERS) {
      expect(ALL_DARK_MARKERS).not.toContainEqual(light);
    }
  });

  it("keeps marker hues distinct between palette pairs", () => {
    for (const miku of [...MIKU_PAIR.lightMarkers, ...MIKU_PAIR.darkMarkers]) {
      expect([...NEUTRAL_PAIR.lightMarkers, ...NEUTRAL_PAIR.darkMarkers]).not.toContainEqual(miku);
    }
  });
});
