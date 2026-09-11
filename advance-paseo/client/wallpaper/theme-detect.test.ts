import { describe, expect, it } from "vitest";
import {
  classifyLuminanceMode,
  classifyMarkerMode,
  relativeLuminance,
  type SurfaceSample,
} from "./theme-detect";
import { hexToRgb, MIKU_DARK_COLORS, MIKU_LIGHT_COLORS } from "./palettes";

const OPAQUE = 1;

function sampleOf(hex: string, weight = 1, alpha = OPAQUE): SurfaceSample {
  const [red, green, blue] = hexToRgb(hex);
  return { color: [red, green, blue, alpha], weight };
}

describe("relativeLuminance", () => {
  it("maps pure white to 1 and pure black to 0", () => {
    expect(relativeLuminance([255, 255, 255, 1])).toBeCloseTo(1, 5);
    expect(relativeLuminance([0, 0, 0, 1])).toBeCloseTo(0, 5);
  });

  it("treats mid-gray as dark territory", () => {
    // WCAG linearization places #808080 near 0.216, well under the 0.5 line.
    expect(relativeLuminance([128, 128, 128, 1])).toBeLessThan(0.5);
  });
});

describe("classifyLuminanceMode", () => {
  it("classifies white surfaces as light", () => {
    expect(classifyLuminanceMode([sampleOf("#FFFFFF", 4)])).toBe("light");
  });

  it("classifies dark surfaces as dark", () => {
    expect(classifyLuminanceMode([sampleOf(MIKU_DARK_COLORS.background, 4)])).toBe("dark");
  });

  it("weights large surfaces over small ones", () => {
    const samples = [
      sampleOf("#0E1013", 4), // big dark shell
      sampleOf("#FFFFFF", 1), // small white card
    ];
    expect(classifyLuminanceMode(samples)).toBe("dark");
  });

  it("ignores translucent surfaces entirely", () => {
    expect(classifyLuminanceMode([sampleOf("#FFFFFF", 4, 0.5)])).toBeNull();
  });

  it("returns null without samples", () => {
    expect(classifyLuminanceMode([])).toBeNull();
  });
});

describe("classifyMarkerMode", () => {
  it("detects the Miku light palette", () => {
    expect(classifyMarkerMode([sampleOf(MIKU_LIGHT_COLORS.background, 4)])).toBe("light");
  });

  it("detects the Miku dark palette", () => {
    expect(classifyMarkerMode([sampleOf(MIKU_DARK_COLORS.background, 4)])).toBe("dark");
  });

  it("ignores colors near, but outside, the marker tolerance", () => {
    const [red, green, blue] = hexToRgb(MIKU_LIGHT_COLORS.background);
    expect(
      classifyMarkerMode([{ color: [red - 40, green, blue, OPAQUE], weight: 4 }]),
    ).toBeNull();
  });

  it("resolves mixed evidence by weight", () => {
    const samples = [
      sampleOf(MIKU_DARK_COLORS.raised, 1),
      sampleOf(MIKU_LIGHT_COLORS.background, 4),
    ];
    expect(classifyMarkerMode(samples)).toBe("light");
  });

  it("returns null for unrelated themes", () => {
    expect(classifyMarkerMode([sampleOf("#808080", 4)])).toBeNull();
  });
});
